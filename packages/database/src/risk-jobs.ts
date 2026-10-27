import { enqueueApprovedRiskJob } from './risk-policy-jobs.js';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import { JOB_ERRORS, MAX_JOB_ATTEMPTS, MAX_JOB_INPUT_BYTES, type RiskJobErrorCode, type RiskJobInput } from '@lmps/contracts/risk-job';
import { alertLocalMode, PolicyError, riskHash, validateRiskRequest, validateAlertPolicy, validateRiskObservation, type RiskObservation } from '@lmps/risk';
import { createDatabase } from './index.js';
import { evaluateTransactionRiskInTransaction, readRiskObservation } from './transaction-risks.js';
import { generateLocalAlertInTransaction } from './alerts.js';

export class RiskJobError extends Error {
  constructor(readonly code: RiskJobErrorCode) { super(code); this.name = 'RiskJobError'; }
}
export function validateRiskJobInput(input: unknown): RiskJobInput {
  try {
    alertLocalMode();
    const v = structuredClone(input) as RiskJobInput;
    if (!v || Object.keys(v).sort().join(',') !== 'alert_policy,execution_mode,format,job_ref,provenance,risk_request,workspace_key'
      || v.format !== 1 || v.provenance !== 'local_synthetic' || v.execution_mode !== 'test' || v.workspace_key !== 'synthetic_local'
      || typeof v.job_ref !== 'string' || !ALERT_UUID.test(v.job_ref) || Buffer.byteLength(JSON.stringify(v)) > MAX_JOB_INPUT_BYTES) throw new Error();
    const risk_request = validateRiskRequest(v.risk_request), alert_policy = validateAlertPolicy(v.alert_policy);
    if (risk_request.run_id !== v.job_ref) throw new Error();
    return { ...v, risk_request, alert_policy };
  } catch { throw new RiskJobError('JOB_INVALID_INPUT'); }
}
export function riskJobInputHash(input: RiskJobInput) {
  const { run_id: _run, ...risk_request } = input.risk_request;
  const { job_ref: _job, ...rest } = input;
  return riskHash({ ...rest, risk_request });
}
function ref(id: string) { alertLocalMode(); if (typeof id !== 'string' || !ALERT_UUID.test(id)) throw new RiskJobError('JOB_INVALID_INPUT'); }
export interface RiskJobClaim { job_ref: string; attempt_number: number; lease_token: string }
function claimValue(input: RiskJobClaim) {
  ref(input?.job_ref); ref(input?.lease_token);
  if (!Number.isInteger(input.attempt_number) || input.attempt_number < 1 || input.attempt_number > MAX_JOB_ATTEMPTS) throw new RiskJobError('JOB_INVALID_INPUT');
  return [input.job_ref, input.attempt_number, input.lease_token];
}
function evidence(row: Record<string, any>): { manifest: RiskJobInput; observation: RiskObservation } {
  try {
    const manifest = validateRiskJobInput(row.manifest), observation = validateRiskObservation(row.observation);
    if (manifest.job_ref !== row.job_ref || !isDeepStrictEqual(manifest, row.manifest) || riskHash(manifest) !== row.manifest_sha256
      || riskJobInputHash(manifest) !== row.input_sha256 || riskHash(observation) !== row.observation_sha256) throw new Error();
    return { manifest, observation };
  } catch { throw new RiskJobError('JOB_STORAGE_UNAVAILABLE'); }
}
export async function enqueueRiskJobInTransaction(client: PoolClient, input: unknown) {
  const manifest = validateRiskJobInput(input), hash = riskJobInputHash(manifest);
        // Serialize registration before reading source: the first frozen observation survives all aliases/retries.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,34))', [hash]);
        const existing = (await client.query(`SELECT * FROM platform.local_risk_jobs WHERE workspace_key='synthetic_local' AND (job_ref=$1 OR input_sha256=$2)`, [manifest.job_ref, hash])).rows;
        if (existing.length) {
          if (existing.length !== 1 || existing[0].input_sha256 !== hash) throw new RiskJobError('JOB_INPUT_CONFLICT');
          evidence(existing[0]); return { status: 'duplicate' as const, job_ref: existing[0].job_ref as string };
        }
        const observation = await readRiskObservation(client, manifest.risk_request);
        const inserted = await client.query(`INSERT INTO platform.local_risk_jobs(job_ref,workspace_key,input_sha256,manifest,manifest_sha256,observation,observation_sha256)
          VALUES($1,'synthetic_local',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING job_ref`, [manifest.job_ref, hash, JSON.stringify(manifest), riskHash(manifest), JSON.stringify(observation), riskHash(observation)]);
        if (inserted.rowCount !== 1) throw new RiskJobError('JOB_INPUT_CONFLICT');
        return { status: 'inserted' as const, job_ref: manifest.job_ref };
}
// Bounded one-shot workers, with at most eight attempts; an operator/scheduler invokes work again when due.
export function createRiskJobs(dsn: string) {
  alertLocalMode(); const database = createDatabase(dsn, 'intake');
  async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined, active = false;
    try {
      client = await database.pool.connect(); await client.query('BEGIN'); active = true;
      const value = await fn(client); await client.query('COMMIT'); active = false; return value;
    } catch (error) {
      if (client && active) { try { await client.query('ROLLBACK'); } catch { /* Discard below. */ } }
      if (error instanceof RiskJobError || error instanceof PolicyError) throw error;
      const code = (error as { code?: string }).code;
      throw new RiskJobError(['RISK_POLICY_CONFLICT', 'RISK_RUN_CONFLICT', 'ALERT_POLICY_CONFLICT'].includes(code ?? '') ? code as RiskJobErrorCode : 'JOB_STORAGE_UNAVAILABLE');
    } finally { client?.release(true); }
  }
  async function lock(client: PoolClient, claim: RiskJobClaim) {
    const row = (await client.query(`SELECT * FROM platform.local_risk_jobs WHERE job_ref=$1 AND attempt_number=$2 AND lease_token=$3
      AND workspace_key='synthetic_local' AND status='running' AND lease_until>clock_timestamp() FOR UPDATE`, claimValue(claim))).rows[0];
    if (!row) throw new RiskJobError('JOB_STALE_LEASE');
    return row;
  }
  async function checkpoint(client: PoolClient, claim: RiskJobClaim, done: boolean, alertId: string | null = null, result: string | null = null) {
    const updated = await client.query(`UPDATE platform.local_risk_jobs SET stage=$4,status=$5,assessment_run_id=job_ref,alert_id=$6,result_code=$7,
      lease_token=CASE WHEN $8 THEN NULL ELSE lease_token END,lease_until=CASE WHEN $8 THEN NULL ELSE clock_timestamp()+interval '10 seconds' END,
      error_code=NULL,updated_at=clock_timestamp() WHERE job_ref=$1 AND attempt_number=$2 AND lease_token=$3 AND status='running' AND lease_until>clock_timestamp()`,
    [...claimValue(claim), done ? 'done' : 'alert', done ? 'completed' : 'running', alertId, result, done]);
    if (updated.rowCount !== 1) throw new RiskJobError('JOB_STALE_LEASE');
    if (done) {
      const attempt = await client.query(`UPDATE platform.local_risk_job_attempts SET status='completed',finished_stage='done',finished_at=clock_timestamp()
        WHERE job_ref=$1 AND attempt_number=$2 AND lease_token=$3 AND status='running'`, claimValue(claim));
      if (attempt.rowCount !== 1) throw new RiskJobError('JOB_STALE_LEASE');
    }
  }
  return {
    close: database.close,
    async enqueue(input: unknown) {
      return transaction(client => enqueueRiskJobInTransaction(client, input));
    },
    async enqueueApproved(input: unknown, selection: unknown) {
      return transaction(client => enqueueApprovedRiskJob(client, input, selection));
    },
    async claim(id?: string): Promise<{ status: 'claimed'; claim: RiskJobClaim } | { status: 'idle' } | { status: 'exhausted'; job_ref: string }> {
      if (id !== undefined) ref(id);
      return transaction(async client => {
        const job = (await client.query(`SELECT * FROM platform.local_risk_jobs WHERE workspace_key='synthetic_local' AND ($1::uuid IS NULL OR job_ref=$1)
          AND ((status IN ('pending','retry_wait') AND next_attempt_at<=clock_timestamp()) OR (status='running' AND lease_until<=clock_timestamp()))
          ORDER BY created_at,job_ref LIMIT 1 FOR UPDATE SKIP LOCKED`, [id ?? null])).rows[0];
        if (!job) return { status: 'idle' };
        if (job.status === 'running') {
          await client.query(`UPDATE platform.local_risk_job_attempts SET status='interrupted',finished_stage=$3,error_code='JOB_LEASE_EXPIRED',finished_at=clock_timestamp()
            WHERE job_ref=$1 AND attempt_number=$2 AND status='running'`, [job.job_ref, job.attempt_number, job.stage]);
        }
        if (job.attempt_number >= MAX_JOB_ATTEMPTS) {
          await client.query(`UPDATE platform.local_risk_jobs SET status='failed',lease_token=NULL,lease_until=NULL,next_attempt_at=NULL,error_code='JOB_LEASE_EXPIRED',updated_at=clock_timestamp() WHERE job_ref=$1`, [job.job_ref]);
          return { status: 'exhausted', job_ref: job.job_ref as string };
        }
        const row = (await client.query(`UPDATE platform.local_risk_jobs SET status='running',attempt_number=attempt_number+1,lease_token=gen_random_uuid(),
          lease_until=clock_timestamp()+interval '10 seconds',next_attempt_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE job_ref=$1 RETURNING job_ref,attempt_number,lease_token,stage`, [job.job_ref])).rows[0];
        await client.query(`INSERT INTO platform.local_risk_job_attempts(workspace_key,job_ref,attempt_number,lease_token,started_stage) VALUES('synthetic_local',$1,$2,$3,$4)`, [row.job_ref, row.attempt_number, row.lease_token, row.stage]);
        return { status: 'claimed', claim: { job_ref: row.job_ref, attempt_number: row.attempt_number, lease_token: row.lease_token } };
      });
    },
    async advance(claim: RiskJobClaim) {
      claimValue(claim);
      return transaction(async client => {
        const job = await lock(client, claim), frozen = evidence(job);
        if (job.stage === 'assessment') {
          const risk = await evaluateTransactionRiskInTransaction(client, frozen.manifest.risk_request, frozen.observation);
          await checkpoint(client, claim, false);
          return { stage: 'alert' as const, assessment_status: risk.result.assessment_status };
        }
        if (job.stage !== 'alert') throw new RiskJobError('JOB_STORAGE_UNAVAILABLE');
        const alert = await generateLocalAlertInTransaction(client, { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local',
          assessment_run_id: job.job_ref, policy: frozen.manifest.alert_policy });
        await checkpoint(client, claim, true, alert.alert_id, alert.reason_code);
        return { stage: 'done' as const, result_code: alert.reason_code, alert_id: alert.alert_id };
      });
    },
    async fail(claim: RiskJobClaim, code: RiskJobErrorCode) {
      claimValue(claim); if (!JOB_ERRORS.includes(code)) throw new RiskJobError('JOB_INVALID_INPUT');
      return transaction(async client => {
        const job = await lock(client, claim), retry = code === 'JOB_STORAGE_UNAVAILABLE' && job.attempt_number < MAX_JOB_ATTEMPTS;
        const status = retry ? 'retry_wait' : 'failed';
        const result = await client.query(`UPDATE platform.local_risk_jobs SET status=$4,error_code=$5,lease_token=NULL,lease_until=NULL,
          next_attempt_at=CASE WHEN $6 THEN clock_timestamp()+make_interval(secs=>least(60,power(2,attempt_number-1))::int) ELSE NULL END,
          updated_at=clock_timestamp() WHERE job_ref=$1 AND attempt_number=$2 AND lease_token=$3 AND lease_until>clock_timestamp()`, [...claimValue(claim), status, code, retry]);
        if (result.rowCount !== 1) throw new RiskJobError('JOB_STALE_LEASE');
        const attempt = await client.query(`UPDATE platform.local_risk_job_attempts SET status=$4,finished_stage=$5,error_code=$6,finished_at=clock_timestamp()
          WHERE job_ref=$1 AND attempt_number=$2 AND lease_token=$3 AND status='running'`, [...claimValue(claim), status, job.stage, code]);
        if (attempt.rowCount !== 1) throw new RiskJobError('JOB_STALE_LEASE');
        return { status };
      });
    },
  };
}
