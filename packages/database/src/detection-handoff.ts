import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AlertPolicy } from '@lmps/contracts/local-alert';
import { DETECTION_STATES, parseDetectionFilters, type DetectionFilters, type DetectionHealth, type DetectionWorkerStatus } from '@lmps/contracts/detection-health';
import { alertLocalMode, riskHash, validateAlertPolicy, type TransactionRiskResult } from '@lmps/risk';
import { createDatabase } from './index.js';
import { createRiskJobs, riskJobInputHash, validateRiskJobInput, RiskJobError } from './risk-jobs.js';
import { enqueueApprovedRiskJob } from './risk-policy-jobs.js';
import { policyVersion } from './risk-policies.js';
import { validateTransactionRevision } from './transaction-revisions.js';
import { validateFrozenTransactionRisk } from './transaction-risks.js';

export class DetectionError extends Error {
  constructor(readonly code: 'DETECTION_INVALID_QUERY' | 'DETECTION_UNAVAILABLE' | 'DETECTION_SCOPE_TOO_LARGE' | 'DETECTION_RETRY_CONFLICT' = 'DETECTION_UNAVAILABLE') { super(code); }
}
const time = (value: Date | string) => new Date(value).toISOString();
type Policy = DetectionHealth['policies'][number] & { alert_policy: AlertPolicy | null };
async function policies(client: Pick<PoolClient, 'query'>, filters: DetectionFilters): Promise<Policy[]> {
  const result = await client.query(`SELECT b.*,v.policy,v.state,v.revision,v.created_by,v.submitted_by,v.approved_by,v.created_at,
    t.job_ref::text,t.bytes,t.variants FROM platform.local_risk_policy_bindings b
    JOIN platform.local_risk_policy_versions v USING(workspace_key,policy_id,policy_version,policy_sha256)
    LEFT JOIN LATERAL (
      SELECT (array_agg(j.job_ref ORDER BY j.created_at,j.job_ref))[1] AS job_ref,
        max(octet_length(j.manifest::text)) AS bytes,count(DISTINCT j.manifest->'alert_policy')::int AS variants
      FROM platform.local_risk_job_policy_bindings p JOIN platform.local_risk_jobs j USING(workspace_key,job_ref)
      WHERE p.workspace_key=b.workspace_key AND p.namespace=b.namespace AND p.currency=b.currency
        AND p.generation=b.generation AND p.policy_id=b.policy_id AND p.policy_version=b.policy_version AND p.policy_sha256=b.policy_sha256
    ) t ON true WHERE b.workspace_key='synthetic_local' AND ($1::text IS NULL OR b.namespace=$1) AND ($2::text IS NULL OR b.currency=$2)
    ORDER BY b.namespace,b.currency LIMIT 101`, [filters.namespace, filters.currency]);
  if (result.rows.length > 100 || result.rows.some(row => row.bytes > 1024 * 1024)) throw new DetectionError('DETECTION_SCOPE_TOO_LARGE');
  const output: Policy[] = [];
  for (const row of result.rows) {
    const version = policyVersion(row);
    if (version.state !== 'approved' || version.policy.currency !== row.currency || version.policy_sha256 !== row.policy_sha256) throw new DetectionError();
    let alertPolicy: AlertPolicy | null = null;
    if (row.variants === 1 && row.job_ref) {
      const saved = (await client.query('SELECT manifest,manifest_sha256,input_sha256 FROM platform.local_risk_jobs WHERE workspace_key=$1 AND job_ref=$2', ['synthetic_local', row.job_ref])).rows[0];
      const manifest = validateRiskJobInput(saved?.manifest);
      if (riskHash(manifest) !== saved.manifest_sha256 || riskJobInputHash(manifest) !== saved.input_sha256
        || riskHash(manifest.risk_request.policy) !== row.policy_sha256 || manifest.risk_request.target.namespace !== row.namespace) throw new DetectionError();
      alertPolicy = validateAlertPolicy(manifest.alert_policy);
    }
    output.push({ namespace: row.namespace, currency: row.currency, generation: row.generation, policy_id: row.policy_id,
      policy_version: row.policy_version, status: row.variants > 1 ? 'policy_ambiguous' : alertPolicy ? 'ready' : 'waiting_alert_policy', alert_policy: alertPolicy });
  }
  return output;
}
export async function readDetectionHealth(pool: Pool, workspace: string, filters: DetectionFilters, worker: DetectionWorkerStatus): Promise<DetectionHealth> {
  alertLocalMode();
  const normalized = parseDetectionFilters(Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null)));
  if (!/^synthetic_[a-z0-9_]{1,40}$/.test(workspace)) throw new DetectionError('DETECTION_INVALID_QUERY');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const asOf = time((await client.query('SELECT transaction_timestamp() AS at')).rows[0].at);
    const configured = workspace === 'synthetic_local' ? await policies(client, normalized) : [];
    const selected = await client.query(`WITH latest AS (
      SELECT DISTINCT ON(namespace,transaction_id) * FROM platform.local_transaction_revisions WHERE workspace_key=$1
      AND ($2::text IS NULL OR namespace=$2) ORDER BY namespace,transaction_id,revision_number DESC
    ) SELECT l.*,r.run_id::text,r.bytes FROM latest l LEFT JOIN LATERAL (
      SELECT run_id,octet_length(snapshot::text) AS bytes FROM platform.local_transaction_risks
      WHERE workspace_key=$1 AND (namespace,transaction_id,revision_number)=(l.namespace,l.transaction_id,l.revision_number)
      ORDER BY recorded_at DESC,run_id DESC LIMIT 1
    ) r ON true WHERE ($3::text IS NULL OR l.payload->>'currency'=$3) ORDER BY l.namespace,l.transaction_id LIMIT 501`, [workspace, normalized.namespace, normalized.currency]);
    if (selected.rows.length > 500 || selected.rows.reduce((sum, row) => sum + (row.bytes ?? 0), Buffer.byteLength(JSON.stringify(selected.rows))) > 8 * 1024 * 1024) throw new DetectionError('DETECTION_SCOPE_TOO_LARGE');
    const frozen = await client.query('SELECT run_id::text,snapshot,snapshot_sha256 FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=ANY($2::uuid[])', [workspace, selected.rows.flatMap(row => row.run_id ? [row.run_id] : [])]);
    const byRun = new Map(frozen.rows.map(row => [row.run_id, row]));
    const jobs = await client.query(`SELECT DISTINCT ON(j.namespace,j.transaction_id,j.revision_number) j.job_ref::text,j.namespace,j.transaction_id,j.revision_number,
      j.status,j.stage,j.attempt_number,j.updated_at,j.next_attempt_at,j.assessment_run_id::text,j.alert_id::text,j.error_code,
      CASE WHEN j.status='running' AND j.lease_until<=transaction_timestamp() THEN 'interrupted' ELSE j.status END AS effective_status
      FROM platform.local_risk_jobs j JOIN jsonb_to_recordset($2::jsonb) t(namespace text,transaction_id text,revision_number integer)
      ON (j.namespace,j.transaction_id,j.revision_number)=(t.namespace,t.transaction_id,t.revision_number) WHERE j.workspace_key=$1
      ORDER BY j.namespace,j.transaction_id,j.revision_number,j.created_at DESC,j.job_ref DESC`, [workspace, JSON.stringify(selected.rows.map(row => ({ namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number })))]);
    const jobMap = new Map(jobs.rows.map(row => [JSON.stringify([row.namespace, row.transaction_id, row.revision_number]), row]));
    const counts = { ...Object.fromEntries(DETECTION_STATES.map(state => [state, 0])), transactions: selected.rows.length, with_assessment: 0, missing_inputs: 0 } as DetectionHealth['counts'];
    const rows: DetectionHealth['rows'] = [];
    for (const row of selected.rows) {
      const revision = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: workspace,
        expected_revision: row.revision_number - 1, transaction: row.payload, ...(row.publication ? { publication: row.publication } : {}) });
      let assessment: TransactionRiskResult | null = null;
      if (row.run_id) {
        const stored = byRun.get(row.run_id), value = validateFrozenTransactionRisk(stored.snapshot, stored.snapshot_sha256);
        if (value.observation.revision_sha256 !== null) {
          if (value.observation.revision_sha256 !== riskHash(revision) || value.result.target.namespace !== row.namespace || value.result.target.transaction_id !== row.transaction_id
            || value.result.target.revision_number !== row.revision_number || value.result.workspace_key !== workspace) throw new DetectionError();
          assessment = value.result;
        }
      }
      const job = jobMap.get(JSON.stringify([row.namespace, row.transaction_id, row.revision_number]));
      const policy = configured.find(policy => policy.namespace === row.namespace && policy.currency === row.payload.currency);
      const reasons = assessment ? [...new Set(assessment.findings.filter(finding => finding.status === 'unavailable' || finding.status === 'not_evaluated').map(finding => finding.reason_code))] : [];
      const state = job ? job.effective_status : assessment ? 'assessed' : !row.publication ? 'not_normalized' : !policy ? 'waiting_policy' : policy.status === 'ready' ? 'ready' : policy.status;
      if (!DETECTION_STATES.includes(state)) throw new DetectionError();
      counts[state as keyof typeof counts]++; if (assessment) counts.with_assessment++; if (!row.publication || reasons.length || assessment?.assessment_status === 'unavailable') counts.missing_inputs++;
      rows.push({ namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number, currency: row.payload.currency,
        state, recorded_at: time(row.recorded_at), assessment_run_id: assessment?.run_id ?? job?.assessment_run_id ?? null,
        assessment_status: assessment?.assessment_status ?? null, reasons, job_ref: job?.job_ref ?? null, stage: job?.stage ?? null,
        attempt_number: job?.attempt_number ?? 0, updated_at: job ? time(job.updated_at) : null, next_attempt_at: job?.next_attempt_at ? time(job.next_attempt_at) : null,
        alert_id: job?.alert_id ?? null, error_code: job?.error_code ?? null,
        retryable: job?.status === 'retry_wait' && job.error_code === 'JOB_STORAGE_UNAVAILABLE' && job.attempt_number < 8 && time(job.next_attempt_at) > asOf });
    }
    await client.query('COMMIT');
    return { version: 'local-detection-health-1', provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, workspace_key: workspace, as_of: asOf,
      consistency: 'request_repeatable_read', filters: normalized, counts, rows,
      worker: workspace === 'synthetic_local' ? worker : { ...worker, configured: false, enabled: false, state: 'disabled', last_completed_at: null, last_enqueued: null, last_processed: null }, limit: 500,
      policies: configured.map(({ alert_policy: _policy, ...value }) => value),
      availability: { source_lag_seconds: null, account_identity: 'unverified', source_connectivity: 'not_attested' } };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error instanceof DetectionError) throw error;
    throw new DetectionError();
  } finally { client.release(true); }
}
export function createDetectionHandoff(dsn: string) {
  const database = createDatabase(dsn, 'intake'), jobs = createRiskJobs(dsn);
  return {
    async close() { await jobs.close(); await database.close(); },
    async handoff(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DetectionError('DETECTION_INVALID_QUERY');
      const client = await database.pool.connect(); let inserted = 0, attempted = 0;
      try {
        const configured = await policies(client, { namespace: null, currency: null });
        for (const policy of configured.filter(policy => policy.status === 'ready')) {
          if (attempted >= limit) break;
          const candidates = await client.query(`SELECT l.namespace,l.transaction_id,l.revision_number FROM (
            SELECT DISTINCT ON(transaction_id) * FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_local' AND namespace=$1
            ORDER BY transaction_id,revision_number DESC
          ) l WHERE l.payload->>'currency'=$2 AND l.publication IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM platform.local_risk_jobs j WHERE j.workspace_key=l.workspace_key AND (j.namespace,j.transaction_id,j.revision_number)=(l.namespace,l.transaction_id,l.revision_number))
            AND NOT EXISTS(SELECT 1 FROM platform.local_transaction_risks r WHERE r.workspace_key=l.workspace_key AND (r.namespace,r.transaction_id,r.revision_number)=(l.namespace,l.transaction_id,l.revision_number)
              AND r.snapshot->'observation'->>'revision_sha256' IS NOT NULL)
            ORDER BY l.recorded_at,l.transaction_id LIMIT $3`, [policy.namespace, policy.currency, limit - attempted]);
          for (const target of candidates.rows) {
            attempted++;
            await client.query('BEGIN');
            try {
              const job = randomUUID();
              const receipt = await enqueueApprovedRiskJob(client, { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', job_ref: job,
                risk_request: { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', run_id: job, target, policy: null, context: null },
                alert_policy: policy.alert_policy }, { namespace: policy.namespace, currency: policy.currency, policy_id: policy.policy_id, policy_version: policy.policy_version, expected_generation: policy.generation });
              await client.query('COMMIT'); if (receipt.status === 'inserted') inserted++;
            } catch (error) { await client.query('ROLLBACK'); throw error; }
          }
        }
        return inserted;
      } catch { throw new DetectionError(); } finally { client.release(true); }
    },
    async work(limit = 5) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new DetectionError('DETECTION_INVALID_QUERY');
      let processed = 0;
      for (let index = 0; index < limit; index++) {
        const result = await jobs.claim(); if (result.status === 'idle') break;
        if (result.status === 'exhausted') { processed++; continue; }
        try { const step = await jobs.advance(result.claim); if (step.stage === 'alert') await jobs.advance(result.claim); }
        catch (error) {
          if (error instanceof RiskJobError && error.code === 'JOB_STALE_LEASE') continue;
          await jobs.fail(result.claim, error instanceof RiskJobError ? error.code : 'JOB_STORAGE_UNAVAILABLE');
        }
        processed++;
      }
      return processed;
    },
    async retry(workspace: string, id: string, attempt: number, updatedAt: string) {
      if (workspace !== 'synthetic_local' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
        || !Number.isInteger(attempt) || attempt < 1 || attempt >= 8 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) throw new DetectionError('DETECTION_INVALID_QUERY');
      try {
        const row = (await database.pool.query(`UPDATE platform.local_risk_jobs SET next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE workspace_key=$1 AND job_ref=$2 AND status='retry_wait' AND error_code='JOB_STORAGE_UNAVAILABLE' AND attempt_number=$3
            AND date_trunc('milliseconds',updated_at)=$4::timestamptz AND next_attempt_at>clock_timestamp()
          RETURNING job_ref::text,attempt_number,updated_at,next_attempt_at`, [workspace, id, attempt, updatedAt])).rows[0];
        if (!row) throw new DetectionError('DETECTION_RETRY_CONFLICT');
        return { workspace_key: workspace, job_ref: row.job_ref, attempt_number: row.attempt_number, status: 'retry_wait' as const, updated_at: time(row.updated_at), next_attempt_at: time(row.next_attempt_at) };
      } catch (error) { if (error instanceof DetectionError) throw error; throw new DetectionError(); }
    },
  };
}
