import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import { AlertError, ALERT_SEVERITIES, RISK_CODES, alertLocalMode, projectAlert, riskHash, reviewState, validateAlertGeneration, validateAlertPolicy, validateAlertReview,
  type AlertSnapshot, type AlertReviewEvent, type TransactionRiskResult } from '@lmps/risk';
import { createDatabase, type Database } from './index.js';
import { validateFrozenTransactionRisk } from './transaction-risks.js';

type Queryable = Pick<PoolClient, 'query'>;
export interface AlertView {
  alert_id: string; snapshot_sha256: string; snapshot: AlertSnapshot; assessment: TransactionRiskResult; created_at: string; recorded_by: string;
  history: AlertReviewEvent[]; state: 'open' | 'acknowledged' | 'reviewed'; version: number; outcome: 'suspicious' | 'legitimate' | 'unknown' | null;
}
const selectAlert = `SELECT a.alert_id::text,a.workspace_key,a.assessment_run_id::text,a.policy_id,a.policy_version,a.policy_sha256,a.snapshot,a.snapshot_sha256,a.severity,a.recorded_by,
  to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  r.snapshot AS risk_snapshot,r.snapshot_sha256 AS risk_snapshot_sha256,p.policy,p.policy_sha256 AS stored_policy_sha256,
  coalesce(h.history,'[]'::jsonb) AS history
  FROM platform.local_alerts a JOIN platform.local_transaction_risks r ON (r.workspace_key,r.run_id)=(a.workspace_key,a.assessment_run_id)
  JOIN platform.local_alert_policies p ON (p.workspace_key,p.policy_id,p.policy_version)=(a.workspace_key,a.policy_id,a.policy_version)
  LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('request_id',request_id::text,'expected_version',expected_version,'action',action,'outcome',outcome,'note',note,
    'version',version,'actor_subject',actor_subject,'actor_role',actor_role,'occurred_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY version) AS history
    FROM platform.local_alert_reviews WHERE workspace_key=a.workspace_key AND alert_id=a.alert_id) h ON true`;
function storage(error: unknown): never { if (error instanceof AlertError) throw error; throw new AlertError('ALERT_STORAGE_UNAVAILABLE'); }
function identity(workspace: string, id?: string) {
  alertLocalMode();
  if (typeof workspace !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(workspace)
    || (id !== undefined && (typeof id !== 'string' || !ALERT_UUID.test(id)))) throw new AlertError('INVALID_ALERT_INPUT');
}
// Recompute both frozen proofs before returning any stored evidence or reviewer notes.
export function validateAlertRow(row: Record<string, unknown>, workspace: string): AlertView {
  try {
    const frozen = validateFrozenTransactionRisk(row.risk_snapshot, row.risk_snapshot_sha256 as string);
    const policy = validateAlertPolicy(row.policy), projected = projectAlert(frozen.result, policy).snapshot;
    if (row.workspace_key !== workspace || frozen.result.workspace_key !== workspace || row.assessment_run_id !== frozen.result.run_id
      || typeof row.alert_id !== 'string' || !ALERT_UUID.test(row.alert_id) || !projected || !isDeepStrictEqual(projected, row.snapshot)
      || row.snapshot_sha256 !== riskHash(projected) || row.policy_sha256 !== riskHash(policy) || row.stored_policy_sha256 !== row.policy_sha256
      || row.policy_id !== policy.policy_id || row.policy_version !== policy.version || row.severity !== projected.severity
      || row.recorded_by !== 'lmps_intake' || typeof row.created_at !== 'string' || new Date(row.created_at).toISOString() !== row.created_at) throw new Error();
    const history = structuredClone(row.history) as AlertReviewEvent[], state = reviewState(history);
    return { alert_id: row.alert_id, snapshot_sha256: row.snapshot_sha256 as string, snapshot: projected, assessment: frozen.result,
      created_at: row.created_at, recorded_by: row.recorded_by, history, ...state };
  } catch { throw new AlertError('ALERT_STORAGE_UNAVAILABLE'); }
}
export async function readLocalAlert(database: Queryable, workspace: string, id: string): Promise<AlertView | null> {
  identity(workspace, id);
  try {
    const row = (await database.query(selectAlert + ' WHERE a.workspace_key=$1 AND a.alert_id=$2', [workspace, id])).rows[0];
    return row ? validateAlertRow(row, workspace) : null;
  } catch (error) { return storage(error); }
}
export interface AlertQuery { after?: string; limit?: number; state?: 'open' | 'acknowledged' | 'reviewed'; severity?: string; risk_code?: string }
// shortcut: UUID pages are a live view; add snapshot/time ordering when stable analyst timelines are required.
export async function listLocalAlerts(database: Queryable, workspace: string, query: AlertQuery) {
  identity(workspace, query.after); const limit = query.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 || Object.keys(query).some(k => !['after', 'limit', 'state', 'severity', 'risk_code'].includes(k))
    || (query.state !== undefined && !['open', 'acknowledged', 'reviewed'].includes(query.state))
    || (query.severity !== undefined && !ALERT_SEVERITIES.includes(query.severity as typeof ALERT_SEVERITIES[number]))
    || (query.risk_code !== undefined && !RISK_CODES.includes(query.risk_code as typeof RISK_CODES[number]))) throw new AlertError('INVALID_ALERT_INPUT');
  try {
    const result = await database.query(selectAlert + ` WHERE a.workspace_key=$1 AND a.alert_id>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      AND ($3::text IS NULL OR a.severity=$3) AND ($4::text IS NULL OR a.snapshot->'selected_risk_types' ? $4)
      AND ($5::text IS NULL OR CASE coalesce(jsonb_array_length(h.history),0) WHEN 0 THEN 'open' WHEN 1 THEN 'acknowledged' ELSE 'reviewed' END=$5)
      ORDER BY a.alert_id LIMIT $6`, [workspace, query.after ?? null, query.severity ?? null, query.risk_code ?? null, query.state ?? null, limit + 1]);
    const rows = result.rows.slice(0, limit).map(row => validateAlertRow(row, workspace));
    return { items: rows, pagination: 'live_committed_view_uuid_order' as const, next_cursor: result.rows.length > limit ? rows.at(-1)!.alert_id : null };
  } catch (error) { return storage(error); }
}
async function transaction<T>(database: Database, action: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined, active = false;
  try {
    client = await database.pool.connect(); await client.query('BEGIN'); active = true;
    const result = await action(client); await client.query('COMMIT'); active = false; return result;
  } catch (error) {
    if (active && client) { try { await client.query('ROLLBACK'); } catch { /* Discard below. */ } }
    return storage(error);
  } finally { client?.release(true); }
}
// The caller owns the transaction, including any fenced job checkpoint.
export async function generateLocalAlertInTransaction(client: PoolClient, input: unknown) {
  const request = validateAlertGeneration(input), policy = request.policy;
  const key = [request.workspace_key, request.assessment_run_id, policy.policy_id, policy.version];
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,33))', [key.join(':')]);
  const row = (await client.query('SELECT snapshot,snapshot_sha256 FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', key.slice(0, 2))).rows[0];
  if (!row) throw new AlertError('ALERT_ASSESSMENT_NOT_FOUND');
  const assessment = validateFrozenTransactionRisk(row.snapshot, row.snapshot_sha256).result;
  if (assessment.workspace_key !== request.workspace_key || assessment.run_id !== request.assessment_run_id) throw new AlertError('ALERT_STORAGE_UNAVAILABLE');
  await client.query(`INSERT INTO platform.local_alert_policies(workspace_key,policy_id,policy_version,policy,policy_sha256)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [request.workspace_key, policy.policy_id, policy.version, JSON.stringify(policy), riskHash(policy)]);
  const stored = (await client.query('SELECT policy,policy_sha256 FROM platform.local_alert_policies WHERE workspace_key=$1 AND policy_id=$2 AND policy_version=$3', [request.workspace_key, policy.policy_id, policy.version])).rows[0];
  if (!stored || riskHash(stored.policy) !== stored.policy_sha256) throw new AlertError('ALERT_STORAGE_UNAVAILABLE');
  if (!isDeepStrictEqual(stored.policy, policy)) throw new AlertError('ALERT_POLICY_CONFLICT');
  const projected = projectAlert(assessment, policy);
  if (!projected.snapshot) return { status: 'skipped' as const, reason_code: projected.reason_code, alert_id: null };
  const saved = (await client.query('SELECT alert_id::text FROM platform.local_alerts WHERE workspace_key=$1 AND assessment_run_id=$2 AND policy_id=$3 AND policy_version=$4', key)).rows[0];
  if (saved) {
    if (!await readLocalAlert(client, request.workspace_key, saved.alert_id)) throw new AlertError('ALERT_STORAGE_UNAVAILABLE');
    return { status: 'duplicate' as const, reason_code: 'ALERT_CREATED' as const, alert_id: saved.alert_id as string };
  }
  const inserted = (await client.query(`INSERT INTO platform.local_alerts(workspace_key,assessment_run_id,policy_id,policy_version,policy_sha256,snapshot,snapshot_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING alert_id::text`, [...key, riskHash(policy), JSON.stringify(projected.snapshot), riskHash(projected.snapshot)])).rows[0];
  if (!inserted || !ALERT_UUID.test(inserted.alert_id)) throw new AlertError('ALERT_STORAGE_UNAVAILABLE');
  return { status: 'inserted' as const, reason_code: 'ALERT_CREATED' as const, alert_id: inserted.alert_id as string };
}
export function createLocalAlerts(dsn: string) {
  alertLocalMode(); const database = createDatabase(dsn, 'intake');
  return { close: database.close, async generate(input: unknown) {
    const request = validateAlertGeneration(input);
    return transaction(database, client => generateLocalAlertInTransaction(client, request));
  } };
}
export function createAlertReviews(dsn: string) {
  alertLocalMode(); const database = createDatabase(dsn, 'reviewer');
  return { close: database.close, onApplicationShutdown: database.close, async review(workspace: string, id: string, actor: string, input: unknown) {
    identity(workspace, id); const command = validateAlertReview(input);
    if (typeof actor !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(actor)) throw new AlertError('INVALID_ALERT_INPUT');
    return transaction(database, async client => {
      if (!await readLocalAlert(client, workspace, id)) throw new AlertError('ALERT_NOT_FOUND');
      let result;
      try { result = (await client.query('SELECT inserted FROM platform.review_local_alert($1,$2,$3,$4,$5,$6,$7,$8)',
        [workspace, id, command.expected_version, command.request_id, command.action, command.outcome, command.note, actor])).rows[0]; }
      catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'P3209') throw new AlertError('ALERT_REVIEW_CONFLICT');
        if (code === 'P3204') throw new AlertError('ALERT_NOT_FOUND');
        if (code === 'P3200') throw new AlertError('INVALID_ALERT_INPUT');
        throw error;
      }
      const view = await readLocalAlert(client, workspace, id);
      const event = view?.history.find(event => event.request_id === command.request_id);
      if (!result || typeof result.inserted !== 'boolean' || !view || !event || event.actor_subject !== actor
        || !isDeepStrictEqual({ request_id: event.request_id, expected_version: event.expected_version, action: event.action, outcome: event.outcome, note: event.note }, command)) throw new AlertError('ALERT_STORAGE_UNAVAILABLE');
      return { status: result.inserted ? 'inserted' as const : 'duplicate' as const, view };
    });
  } };
}
