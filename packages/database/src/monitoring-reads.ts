import type { Pool, PoolClient } from 'pg';
import { performance } from 'node:perf_hooks';
import { MONITORING_VERSION, MONITORING_LIMIT, MONITORING_ASSESSMENTS, MONITORING_DIMENSIONS,
  parseMonitoringFilters, isMonitoringSummary, type MonitoringFilters, type MonitoringSummary, type MonitoringReadSnapshot, type MonitoringRecord, type MonitoringEvidence } from '@lmps/contracts/monitoring';
import { riskHash, type TransactionRiskResult } from '@lmps/risk';
import { validateTransactionRevision } from './transaction-revisions.js';
import { validateFrozenTransactionRisk } from './transaction-risks.js';
import { readLocalAlert } from './alerts.js';
import type { NetworkTransfer } from '@lmps/contracts/monitoring-network';
import type { RiskContext } from '@lmps/contracts/transaction-risk';

export class MonitoringReadError extends Error {
  constructor(readonly code: 'MONITORING_UNAVAILABLE' | 'MONITORING_SCOPE_TOO_LARGE' = 'MONITORING_UNAVAILABLE') { super(code); }
}
const targetKey = (namespace: string, id: string, revision: number) => JSON.stringify([namespace, id, revision]);
/** The pilot scans at most 500 latest revisions / 8 MiB of evidence in one snapshot.
 * No partial totals are published. Institution identity and real source readiness are not inferred. */
export async function readMonitoringSummary(pool: Pool, workspace: string, filters: MonitoringFilters): Promise<MonitoringSummary> {
  return (await readMonitoringSnapshot(pool, workspace, filters)).summary;
}
export async function readMonitoringSnapshot(pool: Pool, workspace: string, filters: MonitoringFilters): Promise<MonitoringReadSnapshot> {
  if (!/^synthetic_[a-z0-9_]{1,40}$/.test(workspace)) throw new MonitoringReadError();
  const normalized = parseMonitoringFilters(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== null)));
  let client: PoolClient | undefined;
  const started = performance.now();
  const deadline = () => { if (performance.now() - started > 5000) throw new MonitoringReadError(); };
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const asOf: string = (await client.query(`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`)).rows[0].at;
    const selected = await client.query(`WITH latest AS (
      SELECT DISTINCT ON(namespace,transaction_id) namespace,transaction_id,revision_number,payload,publication,recorded_at
      FROM platform.local_transaction_revisions WHERE workspace_key=$1
        AND ($2::text IS NULL OR namespace=$2)
      ORDER BY namespace,transaction_id,revision_number DESC
    ) SELECT l.*,to_char(l.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision_at,r.run_id::text,r.evidence_bytes,r.risk_at
      FROM latest l LEFT JOIN LATERAL (
        SELECT run_id,octet_length(snapshot::text) AS evidence_bytes,
          to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS risk_at FROM platform.local_transaction_risks
        WHERE workspace_key=$1 AND (namespace,transaction_id,revision_number)=(l.namespace,l.transaction_id,l.revision_number)
          AND recorded_at<=$7::timestamptz ORDER BY recorded_at DESC,run_id DESC LIMIT 1
      ) r ON true
      WHERE ($3::text IS NULL OR l.payload->>'currency'=$3) AND ($4::text IS NULL OR l.payload->>'transaction_status'=$4)
        AND ($5::timestamptz IS NULL OR l.recorded_at >= $5) AND ($6::timestamptz IS NULL OR l.recorded_at < $6)
        AND l.recorded_at <= $7::timestamptz
      ORDER BY l.namespace,l.transaction_id LIMIT $8`,
    [workspace, normalized.namespace, normalized.currency, normalized.status, normalized.from, normalized.to, asOf, MONITORING_LIMIT + 1]);
    // Check sizes in PostgreSQL before transferring potentially large frozen snapshots.
    if (selected.rows.length > MONITORING_LIMIT || Buffer.byteLength(JSON.stringify(selected.rows))
      + selected.rows.reduce((n, row) => n + (row.evidence_bytes ?? 0), 0) > 8 * 1024 * 1024)
      throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE');
    deadline();
    const frozenRows = await client.query(`SELECT run_id::text,snapshot,snapshot_sha256 FROM platform.local_transaction_risks
      WHERE workspace_key=$1 AND run_id=ANY($2::uuid[])`, [workspace, selected.rows.flatMap(row => row.run_id === null ? [] : [row.run_id])]);
    const frozenById = new Map(frozenRows.rows.map(row => [row.run_id, row]));
    const result: MonitoringSummary = {
      version: MONITORING_VERSION, provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false,
      workspace_key: workspace, as_of: asOf, consistency: 'request_repeatable_read', time_basis: 'latest_revision_recorded_at', filters: normalized,
      counts: { transactions: 0, assessed: 0, not_assessed: 0, flagged: 0, alerts: 0 },
      assessment_statuses: Object.fromEntries(MONITORING_ASSESSMENTS.map(s => [s, 0])) as MonitoringSummary['assessment_statuses'],
      dimensions: { fraud: 0, mule_network: 0, aml: 0 }, currencies: [],
      availability: { source_lag_seconds: null, institution_filter: 'unverified', account_identity: 'unverified', continuous_intake: 'not_attested' },
      limits: { transactions: MONITORING_LIMIT, alerts: MONITORING_LIMIT, scope_complete: true },
    };
    const currencies = new Map<string, number>(), targets: Array<{ namespace: string; transaction_id: string; revision_number: number }> = [];
    const snapshot: MonitoringReadSnapshot = { summary: result, transactions: [], alerts: [], evidence: {}, network: [] };
    const transactionEvidence = new Map<string, MonitoringEvidence>();
    const makeRisk = (a: TransactionRiskResult | null, at: string): MonitoringRecord['risk'] => a ? {
      run_id: a.run_id, core_sha256: riskHash(a), status: a.assessment_status, recorded_at: at, as_of: a.as_of,
      severity: [...a.findings].filter(f => f.status === 'triggered').map(f => f.severity!).sort((x, y) => ['low', 'medium', 'high', 'critical'].indexOf(y) - ['low', 'medium', 'high', 'critical'].indexOf(x))[0] ?? null,
      patterns: a.risk_types, dimensions: Object.fromEntries(MONITORING_DIMENSIONS.map((dim, i) => {
        const score = a[(['fraud_score', 'mule_network_score', 'aml_suspicion_score'] as const)[i]!];
        return [dim, { status: score.status, value: score.value }];
      })) as NonNullable<MonitoringRecord['risk']>['dimensions'],
    } : null;
    const keyFor = (kind: string, namespace: string, id: string, revision: number, alert: string | null = null) => Buffer.from(JSON.stringify([kind, namespace, id, revision, alert])).toString('base64url');
    const windowFor = (request: { policy: { window_seconds: number; baseline_windows: number } | null; context: { coverage_start: string; coverage_complete: boolean } | null }): MonitoringEvidence['window'] => request.policy ? {
      seconds: request.policy.window_seconds, baseline_windows: request.policy.baseline_windows,
      coverage_start: request.context?.coverage_start ?? null, coverage_complete: request.context?.coverage_complete ?? null,
    } : null;
    const keys = new Set<string>();
    const triggered = (assessment: TransactionRiskResult | null) => assessment?.findings.filter(f => f.status === 'triggered') ?? [];
    const matching = (assessment: TransactionRiskResult | null) => triggered(assessment).filter(f =>
      (normalized.dimension === null || f.dimension === normalized.dimension) && (normalized.pattern === null || f.code === normalized.pattern)
      && (normalized.severity === null || f.severity === normalized.severity));
    const riskFiltered = normalized.dimension !== null || normalized.pattern !== null || normalized.severity !== null;
    for (const row of selected.rows) {
      deadline();
      const revision = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: workspace,
        expected_revision: row.revision_number - 1, transaction: row.payload, ...(row.publication === null ? {} : { publication: row.publication }) });
      const tx = revision.transaction;
      if (tx.transaction_id !== row.transaction_id || tx.source_reference.namespace !== row.namespace) throw new Error();
      let assessment: TransactionRiskResult | null = null;
      let reversedAmount: string | null = null;
      if (row.run_id !== null) {
        const frozen = frozenById.get(row.run_id);
        if (!frozen) throw new Error();
        const validated = validateFrozenTransactionRisk(frozen.snapshot, frozen.snapshot_sha256);
        reversedAmount = validated.observation.reversed_amount;
        if (validated.observation.revision_sha256 !== null && validated.observation.revision_sha256 !== riskHash(revision)) throw new Error();
        assessment = validated.result;
        if (assessment.workspace_key !== workspace || assessment.run_id !== row.run_id || assessment.target.namespace !== row.namespace
          || assessment.target.transaction_id !== row.transaction_id || assessment.target.revision_number !== row.revision_number) throw new Error();
        if (revision.publication && assessment.source_semantics !== 'unverified') throw new Error();
        // A legitimate missing-target run from before intake cannot cover the revision that arrived later.
        if (validated.observation.revision_sha256 === null) assessment = null;
      }
      if (riskFiltered && matching(assessment).length === 0) continue;
      result.counts.transactions++;
      if (assessment) { result.counts.assessed++; result.assessment_statuses[assessment.assessment_status]++; }
      else { result.counts.not_assessed++; result.assessment_statuses.not_assessed++; }
      if (triggered(assessment).length) result.counts.flagged++;
      for (const dim of MONITORING_DIMENSIONS) if (triggered(assessment).some(f => f.dimension === dim)) result.dimensions[dim]++;
      currencies.set(tx.currency, (currencies.get(tx.currency) ?? 0) + 1);
      const target = { namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number };
      targets.push(target); keys.add(targetKey(target.namespace, target.transaction_id, target.revision_number));
      const record: MonitoringRecord = { record_key: keyFor('transaction', row.namespace, row.transaction_id, row.revision_number), kind: 'transaction',
        namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number, amount: tx.amount,
        currency: tx.currency, transaction_status: tx.transaction_status, recorded_at: row.revision_at, alert_id: null, alert: null, risk: makeRisk(assessment, row.risk_at) };
      const p = revision.publication;
      const evidence: MonitoringEvidence = { record, transaction_revision: tx.transaction_revision, revision_sha256: riskHash(revision),
        revision_recorded_at: row.revision_at, observed_at: tx.observed_at, occurred_at: tx.occurred_at, source: p ? { capture_id: p.capture_id, source_generation: p.source.source_generation,
          event_key: p.source.event_key, snapshot_sha256: p.snapshot_sha256, evidence_sha256: p.evidence_sha256 } : null,
        window: assessment ? windowFor(frozenById.get(row.run_id)!.snapshot.request) : null };
      snapshot.transactions.push(record); snapshot.evidence[record.record_key] = evidence;
      const context: RiskContext | null = assessment ? frozenById.get(row.run_id)!.snapshot.request.context : null;
      const transfer: NetworkTransfer = { record_key: record.record_key, namespace: record.namespace, transaction_id: record.transaction_id,
        revision_number: record.revision_number, currency: record.currency, net_amount: '0.00', occurred_at: tx.occurred_at,
        sender: null, receiver: null, reason: 'NO_BOUND_ASSESSMENT' };
      if (assessment) {
        transfer.reason = 'IDENTITY_UNVERIFIED';
        if (context?.identity_status === 'synthetic_declared') {
          const events = context.events.filter(event => event.namespace === row.namespace && event.transaction_id === row.transaction_id
            && Date.parse(event.available_at) <= Date.parse(context.as_of));
          const latest = events.toSorted((left, right) => right.revision_number - left.revision_number)[0];
          transfer.reason = 'TARGET_NOT_IN_HISTORY';
          if (latest) {
            transfer.reason = 'CONTEXT_CONFLICT';
            if (latest.revision_number === row.revision_number && latest.amount === tx.amount && latest.reversed_amount === reversedAmount
              && latest.currency === tx.currency && latest.status === tx.transaction_status && Date.parse(latest.occurred_at) <= Date.parse(context.as_of)
              && (tx.occurred_at === null || Date.parse(latest.occurred_at) === Date.parse(tx.occurred_at))
              && context.binding.revision_sha256 === evidence.revision_sha256) {
              const cents = (amount: string) => BigInt(amount.replace('.', ''));
              const net = latest.status === 'succeeded' || latest.status === 'partially_reversed' ? cents(latest.amount) - cents(latest.reversed_amount) : 0n;
              transfer.reason = net > 0n ? null : 'NO_EXECUTED_VALUE';
              if (net > 0n) { transfer.sender = latest.sender; transfer.receiver = latest.receiver; transfer.occurred_at = latest.occurred_at; transfer.net_amount = `${net / 100n}.${String(net % 100n).padStart(2, '0')}`; }
            }
          }
        }
      }
      snapshot.network!.push(transfer);
      transactionEvidence.set(targetKey(row.namespace, row.transaction_id, row.revision_number), evidence);
    }
    // Alerts are immutable snapshots for the selected current revisions, including older runs on that same revision.
    // Review/Case state is deliberately not a monitoring prerequisite or filter.
    const alerts = await client.query(`SELECT a.alert_id::text,
      to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS risk_at,
      jsonb_build_object('policy', jsonb_build_object('window_seconds', r.snapshot->'request'->'policy'->'window_seconds',
        'baseline_windows',r.snapshot->'request'->'policy'->'baseline_windows'),
        'context',CASE WHEN r.snapshot->'request'->'context'='null'::jsonb THEN NULL ELSE
          jsonb_build_object('coverage_start',r.snapshot->'request'->'context'->'coverage_start',
            'coverage_complete',r.snapshot->'request'->'context'->'coverage_complete') END) AS window_request FROM platform.local_alerts a
      JOIN platform.local_transaction_risks r ON (r.workspace_key,r.run_id)=(a.workspace_key,a.assessment_run_id)
      JOIN jsonb_to_recordset($2::jsonb) AS t(namespace text,transaction_id text,revision_number integer)
        ON (r.namespace,r.transaction_id,r.revision_number)=(t.namespace,t.transaction_id,t.revision_number)
      WHERE a.workspace_key=$1 AND a.created_at<=$3::timestamptz ORDER BY a.alert_id LIMIT $4`,
    [workspace, JSON.stringify(targets), asOf, MONITORING_LIMIT + 1]);
    if (alerts.rows.length > MONITORING_LIMIT) throw new MonitoringReadError('MONITORING_SCOPE_TOO_LARGE');
    for (const row of alerts.rows) {
      deadline();
      const remaining = Math.max(1, Math.floor(5000 - (performance.now() - started)));
      await client.query(`SET LOCAL statement_timeout='${remaining}ms'`);
      const alert = await readLocalAlert(client, workspace, row.alert_id);
      if (!alert || !keys.has(targetKey(alert.assessment.target.namespace, alert.assessment.target.transaction_id, alert.assessment.target.revision_number))) throw new Error();
      if (riskFiltered && !matching(alert.assessment).some(f => alert.snapshot.selected_risk_types.includes(f.code))) continue;
      result.counts.alerts++;
      const a = alert.assessment, base = transactionEvidence.get(targetKey(a.target.namespace, a.target.transaction_id, a.target.revision_number))!;
      const record: MonitoringRecord = { ...base.record, record_key: keyFor('alert', a.target.namespace, a.target.transaction_id, a.target.revision_number, alert.alert_id),
        kind: 'alert', recorded_at: alert.created_at, alert_id: alert.alert_id, risk: makeRisk(a, row.risk_at),
        alert: { severity: alert.snapshot.severity, patterns: alert.snapshot.selected_risk_types, snapshot_sha256: alert.snapshot_sha256,
          policy: { policy_id: alert.snapshot.policy.policy_id, version: alert.snapshot.policy.version, sha256: riskHash(alert.snapshot.policy) } } };
      snapshot.alerts.push(record); snapshot.evidence[record.record_key] = { ...base, record, window: windowFor(row.window_request) };
    }
    result.currencies = [...currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, transactions]) => ({ currency, transactions }));
    deadline();
    if (!isMonitoringSummary(result)) throw new Error();
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch { /* Discard the connection below. */ }
    if (error instanceof MonitoringReadError) throw error;
    throw new MonitoringReadError();
  } finally { client?.release(true); }
}
