import { performance } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { normalizeSynthetic } from '@lmps/contracts/synthetic-normalization';
import { parseTimelineTarget, type MonitoringTimeline, type TimelineTarget } from '@lmps/contracts/monitoring-timeline';
import { riskHash } from '@lmps/risk';
import { validateTransactionRevision } from './transaction-revisions.js';
import { validateFrozenTransactionRisk, type FrozenTransactionRisk } from './transaction-risks.js';
import { validateAlertRow } from './alerts.js';
import { MonitoringReadError } from './monitoring-reads.js';

export async function readMonitoringTimeline(pool: Pool, workspace: string, target: TimelineTarget): Promise<MonitoringTimeline> {
  parseTimelineTarget(target);
  if (!/^synthetic_[a-z0-9_]{1,40}$/.test(workspace)) throw new MonitoringReadError();
  const client = await pool.connect(), started = performance.now();
  const check = () => { if (performance.now() - started > 5000) throw new MonitoringReadError(); };
  const tooLarge = (): never => { throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE'); };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const asOf = (await client.query(`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`)).rows[0].at;
    const args = [workspace, target.namespace, target.transaction_id];
    const metadata = await client.query(`SELECT revision_number,octet_length(payload::text)+coalesce(octet_length(publication::text),0) AS bytes
      FROM platform.local_transaction_revisions WHERE (workspace_key,namespace,transaction_id)=($1,$2,$3) ORDER BY revision_number LIMIT 101`, args);
    const riskMeta = await client.query(`SELECT run_id::text,octet_length(snapshot::text) AS bytes FROM platform.local_transaction_risks
      WHERE (workspace_key,namespace,transaction_id)=($1,$2,$3) ORDER BY recorded_at,run_id LIMIT 101`, args);
    const alertMeta = await client.query(`SELECT a.alert_id::text,octet_length(a.snapshot::text) AS bytes FROM platform.local_alerts a
      JOIN platform.local_transaction_risks r ON (r.workspace_key,r.run_id)=(a.workspace_key,a.assessment_run_id)
      WHERE (r.workspace_key,r.namespace,r.transaction_id)=($1,$2,$3) ORDER BY a.created_at,a.alert_id LIMIT 101`, args);
    if ([metadata, riskMeta, alertMeta].some(result => result.rows.length > 100)
      || [...metadata.rows, ...riskMeta.rows, ...alertMeta.rows].reduce((sum, row) => sum + row.bytes, 0) > 8 * 1024 * 1024) tooLarge();
    check();
    const result: MonitoringTimeline = { version: 'local-monitoring-timeline-1', provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false,
      workspace_key: workspace, target, as_of: asOf, consistency: 'request_repeatable_read', time_basis: 'recorded_at', revisions: [], assessments: [], alerts: [],
      coverage: { revisions: 0, assessment_runs: 0, assessed_revisions: 0, missing_assessments: 0, alerts: 0, revision_history_complete: true },
      limits: { revisions: 100, assessments: 100, alerts: 100, scope_complete: true },
      availability: { account_identity: 'unverified', payment_time: 'unverified', source_connectivity: 'not_attested' } };
    const revisions = await client.query(`SELECT revision_number,payload,publication,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM platform.local_transaction_revisions WHERE (workspace_key,namespace,transaction_id)=($1,$2,$3) ORDER BY revision_number`, args);
    for (const row of revisions.rows) {
      check();
      const revision = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: workspace,
        expected_revision: row.revision_number - 1, transaction: row.payload, ...(row.publication ? { publication: row.publication } : {}) });
      const transaction = revision.transaction, normalized = revision.publication ? normalizeSynthetic(revision.publication.normalization_input) : null;
      const candidate = normalized?.state === 'known' ? normalized.candidate : null;
      const reversed = candidate ? candidate.cumulative_reversed_amount ?? '0.00' : null;
      const units = (amount: string) => BigInt(amount.replace('.', ''));
      const net = candidate && reversed !== null ? ['succeeded', 'partially_reversed', 'reversed'].includes(candidate.transaction_status) ? units(candidate.amount) - units(reversed) : 0n : null;
      const previous = result.revisions.at(-1);
      const source = revision.publication ? { capture_id: revision.publication.capture_id, snapshot_sha256: revision.publication.snapshot_sha256,
        evidence_sha256: revision.publication.evidence_sha256, event_key: revision.publication.source.event_key } : null;
      const current = { revision_number: row.revision_number, recorded_at: row.at, observed_at: transaction.observed_at, occurred_at: null,
        amount: transaction.amount, currency: transaction.currency, status: transaction.transaction_status, revision_sha256: riskHash(revision),
        reversal_code: revision.publication?.normalization_input.reversal_code ?? null, reversed_amount: reversed,
        executed_amount: net === null ? null : `${net / 100n}.${String(net % 100n).padStart(2, '0')}`,
        normalization: normalized?.state ?? 'not_normalized', reasons: normalized?.reason_codes ?? ['NORMALIZATION_UNAVAILABLE'], changes: [], source } as MonitoringTimeline['revisions'][number];
      current.changes = previous ? (['amount', 'currency', 'status', 'reversed_amount', 'reversal_code', 'observed_at'] as const).filter(field => previous[field] !== current[field]) : [];
      result.revisions.push(current);
    }
    const byRevision = new Map(result.revisions.map(row => [row.revision_number, row])), frozenByRun = new Map<string, { value: FrozenTransactionRisk; hash: string }>();
    const risks = await client.query(`SELECT run_id::text,namespace,transaction_id,revision_number,snapshot,snapshot_sha256,
      to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM platform.local_transaction_risks
      WHERE workspace_key=$1 AND run_id=ANY($2::uuid[]) ORDER BY recorded_at,run_id`, [workspace, riskMeta.rows.map(row => row.run_id)]);
    for (const row of risks.rows) {
      check();
      const value = validateFrozenTransactionRisk(row.snapshot, row.snapshot_sha256), revision = byRevision.get(row.revision_number), request = value.request;
      if (request.workspace_key !== workspace || request.run_id !== row.run_id || request.target.namespace !== target.namespace
        || request.target.transaction_id !== target.transaction_id || request.target.revision_number !== row.revision_number) throw new MonitoringReadError();
      const bound = value.observation.revision_sha256 !== null;
      if (bound && (!revision || value.observation.revision_sha256 !== revision.revision_sha256)) throw new MonitoringReadError();
      frozenByRun.set(row.run_id, { value, hash: row.snapshot_sha256 });
      result.assessments.push({ recorded_at: row.at, bound, core_sha256: riskHash(value.result), result: value.result,
        window: request.policy ? { seconds: request.policy.window_seconds, baseline_windows: request.policy.baseline_windows,
          coverage_start: request.context?.coverage_start ?? null, coverage_complete: request.context?.coverage_complete ?? null } : null });
    }
    const alerts = await client.query(`SELECT a.*,p.policy,p.policy_sha256 AS stored_policy_sha256,
      to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM platform.local_alerts a JOIN platform.local_alert_policies p ON (p.workspace_key,p.policy_id,p.policy_version)=(a.workspace_key,a.policy_id,a.policy_version)
      WHERE a.workspace_key=$1 AND a.alert_id=ANY($2::uuid[]) ORDER BY a.created_at,a.alert_id`, [workspace, alertMeta.rows.map(row => row.alert_id)]);
    for (const row of alerts.rows) {
      check(); const risk = frozenByRun.get(row.assessment_run_id);
      if (!risk) throw new MonitoringReadError();
      const alert = validateAlertRow({ ...row, risk_snapshot: risk.value, risk_snapshot_sha256: risk.hash, created_at: new Date(row.at).toISOString(), history: [] }, workspace);
      result.alerts.push({ alert_id: alert.alert_id, assessment_run_id: alert.assessment.run_id, revision_number: alert.assessment.target.revision_number,
        recorded_at: row.at, severity: alert.snapshot.severity, patterns: alert.snapshot.selected_risk_types, snapshot_sha256: alert.snapshot_sha256,
        policy: { policy_id: alert.snapshot.policy.policy_id, version: alert.snapshot.policy.version, sha256: riskHash(alert.snapshot.policy) } });
    }
    const assessed = new Set(result.assessments.filter(row => row.bound).map(row => row.result.target.revision_number));
    result.coverage = { revisions: result.revisions.length, assessment_runs: result.assessments.length, assessed_revisions: assessed.size,
      missing_assessments: result.revisions.length - assessed.size, alerts: result.alerts.length,
      revision_history_complete: result.revisions.every((row, index) => row.revision_number === index + 1) };
    check(); await client.query('COMMIT'); return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error instanceof MonitoringReadError) throw error;
    throw new MonitoringReadError();
  } finally { client.release(true); }
}
