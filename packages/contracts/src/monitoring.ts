/** Monitoring v1 is a bounded, read-only local pilot. Recorded time is not payment time. */
export const MONITORING_VERSION = 'local-monitoring-1' as const;
export const MONITORING_LIMIT = 500;
export const MONITORING_STATUSES = ['unknown', 'pending', 'succeeded', 'failed', 'reversed', 'partially_reversed'] as const;
export const MONITORING_DIMENSIONS = ['fraud', 'mule_network', 'aml'] as const;
export const MONITORING_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const MONITORING_ASSESSMENTS = ['complete', 'partial', 'unavailable', 'not_evaluated', 'not_applicable', 'not_assessed'] as const;
export interface MonitoringFilters {
  namespace: string | null; currency: string | null; status: string | null;
  dimension: typeof MONITORING_DIMENSIONS[number] | null; severity: typeof MONITORING_SEVERITIES[number] | null;
  pattern: string | null; from: string | null; to: string | null; timezone: 'Asia/Vientiane' | 'UTC';
}
export interface MonitoringSummary {
  version: typeof MONITORING_VERSION; provenance: 'local_synthetic'; execution_mode: 'test';
  canonical_emission: false; workspace_key: string; as_of: string;
  consistency: 'request_repeatable_read'; time_basis: 'latest_revision_recorded_at';
  filters: MonitoringFilters;
  counts: { transactions: number; assessed: number; not_assessed: number; flagged: number; alerts: number };
  assessment_statuses: Record<typeof MONITORING_ASSESSMENTS[number], number>;
  dimensions: Record<typeof MONITORING_DIMENSIONS[number], number>;
  currencies: Array<{ currency: string; transactions: number }>;
  availability: { source_lag_seconds: null; institution_filter: 'unverified'; account_identity: 'unverified'; continuous_intake: 'not_attested' };
  limits: { transactions: number; alerts: number; scope_complete: true };
}
export const MONITORING_MODES = ['transactions', 'assessed', 'not_assessed', 'flagged', 'alerts'] as const;
export const MONITORING_SORTS = ['recorded_desc', 'recorded_asc', 'id_asc', 'id_desc', 'severity_desc', 'amount_asc', 'amount_desc'] as const;
export type MonitoringMode = typeof MONITORING_MODES[number];
export interface MonitoringRecord {
  record_key: string; kind: 'transaction' | 'alert'; namespace: string; transaction_id: string; revision_number: number;
  amount: string; currency: string; transaction_status: string; recorded_at: string; alert_id: string | null;
  alert: null | { severity: typeof MONITORING_SEVERITIES[number]; patterns: string[]; snapshot_sha256: string; policy: { policy_id: string; version: string; sha256: string } };
  risk: null | {
    run_id: string; core_sha256: string; status: Exclude<typeof MONITORING_ASSESSMENTS[number], 'not_assessed'>;
    recorded_at: string; as_of: string | null; severity: typeof MONITORING_SEVERITIES[number] | null; patterns: string[];
    dimensions: Record<typeof MONITORING_DIMENSIONS[number], { status: 'available' | 'unavailable' | 'not_evaluated'; value: number | null }>;
  };
}
export interface MonitoringEvidence {
  record: MonitoringRecord; transaction_revision: string; revision_sha256: string; revision_recorded_at: string; observed_at: string; occurred_at: string | null;
  source: null | { capture_id: string; source_generation: string; event_key: string; snapshot_sha256: string; evidence_sha256: string };
  window: null | { seconds: number; baseline_windows: number; coverage_start: string | null; coverage_complete: boolean | null };
}
export interface MonitoringReadSnapshot {
  summary: MonitoringSummary; transactions: MonitoringRecord[]; alerts: MonitoringRecord[]; evidence: Record<string, MonitoringEvidence>;
  network?: import('./monitoring-network.js').NetworkTransfer[];
}
export interface MonitoringFeed {
  version: 'local-monitoring-feed-1'; summary: MonitoringSummary; rows: MonitoringRecord[];
}
export interface MonitoringSession {
  version: 'local-monitoring-records-1'; snapshot_id: string; expires_at: string; summary: MonitoringSummary;
}
export interface MonitoringTrends {
  version: 'local-monitoring-trends-1'; snapshot_id: string; expires_at: string; summary: MonitoringSummary; rows: MonitoringRecord[];
}
export interface MonitoringRecordsQuery {
  mode: MonitoringMode; q: string; sort: typeof MONITORING_SORTS[number]; limit: number; after: string | null;
}
export interface MonitoringRecordsPage extends MonitoringSession {
  query: MonitoringRecordsQuery; total: number; scope_total: number; page: number;
  next_cursor: string | null; previous_cursor: string | null; rows: MonitoringRecord[];
}
export function parseMonitoringRecordsQuery(v: unknown): MonitoringRecordsQuery {
  if (!object(v) || Object.keys(v).some(k => !['mode', 'q', 'sort', 'limit', 'after'].includes(k))
    || Object.values(v).some(x => typeof x !== 'string' || !x || x.trim() !== x)) throw new MonitoringInputError();
  const mode = v.mode ?? 'transactions', q = v.q ?? '', sort = v.sort ?? 'recorded_desc', limit = v.limit ?? '25', after = v.after ?? null;
  if (!MONITORING_MODES.includes(mode as MonitoringMode) || !MONITORING_SORTS.includes(sort as MonitoringRecordsQuery['sort'])
    || typeof q !== 'string' || !/^[A-Za-z0-9._:-]{0,128}$/.test(q) || typeof limit !== 'string' || !['10', '25', '50'].includes(limit)
    || after !== null && (typeof after !== 'string' || after.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(after))) throw new MonitoringInputError();
  return { mode: mode as MonitoringMode, q, sort: sort as MonitoringRecordsQuery['sort'], limit: Number(limit), after: after as string | null };
}
export class MonitoringInputError extends Error {
  constructor() { super('Invalid monitoring filters.'); this.name = 'MonitoringInputError'; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = ['namespace', 'currency', 'status', 'dimension', 'severity', 'pattern', 'from', 'to', 'timezone'];
export function monitoringTime(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3}|\.\d{6})?Z$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
}
const micros = (v: string) => BigInt(Date.parse(v.slice(0, 19) + 'Z')) * 1000n + BigInt((v.split('.')[1]?.slice(0, -1) ?? '').padEnd(6, '0'));
/** Unknown, repeated, whitespace-padded or client-supplied tenant/snapshot keys are rejected. */
export function parseMonitoringFilters(input: unknown): MonitoringFilters {
  const fail = (): never => { throw new MonitoringInputError(); };
  if (!object(input) || Object.keys(input).some(key => !keys.includes(key))) return fail();
  for (const v of Object.values(input)) if (typeof v !== 'string' || !v || v.trim() !== v || v.length > 128) return fail();
  const get = (k: string) => input[k] === undefined ? null : input[k] as string;
  const namespace = get('namespace'), currency = get('currency'), status = get('status');
  const dimension = get('dimension'), severity = get('severity'), pattern = get('pattern');
  const from = get('from'), to = get('to'), timezone = get('timezone') ?? 'Asia/Vientiane';
  if (namespace !== null && !/^synthetic_[a-z0-9_]{1,40}$/.test(namespace)
    || currency !== null && !/^[A-Z]{3}$/.test(currency)
    || status !== null && !MONITORING_STATUSES.includes(status as typeof MONITORING_STATUSES[number])
    || dimension !== null && !MONITORING_DIMENSIONS.includes(dimension as typeof MONITORING_DIMENSIONS[number])
    || severity !== null && !MONITORING_SEVERITIES.includes(severity as typeof MONITORING_SEVERITIES[number])
    || pattern !== null && !/^(FRAUD|MULE|AML)_[A-Z_]{1,60}$/.test(pattern)
    || !['Asia/Vientiane', 'UTC'].includes(timezone)
    || (from === null) !== (to === null)
    || from !== null && (!monitoringTime(from) || !monitoringTime(to) || micros(from) >= micros(to)
      || micros(to) - micros(from) > 31n * 86400000000n)) return fail();
  return { namespace, currency, status, dimension: dimension as MonitoringFilters['dimension'], severity: severity as MonitoringFilters['severity'], pattern,
    from, to, timezone: timezone as MonitoringFilters['timezone'] };
}
/** Response checks are independent of storage and cannot turn absent telemetry into zero. */
export function isMonitoringSummary(v: unknown): v is MonitoringSummary {
  if (!object(v) || Object.keys(v).sort().join(',') !== 'as_of,assessment_statuses,availability,canonical_emission,consistency,counts,currencies,dimensions,execution_mode,filters,limits,provenance,time_basis,version,workspace_key'
    || v.version !== MONITORING_VERSION || v.provenance !== 'local_synthetic' || v.execution_mode !== 'test' || v.canonical_emission !== false
    || typeof v.workspace_key !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(v.workspace_key) || !monitoringTime(v.as_of)
    || v.consistency !== 'request_repeatable_read' || v.time_basis !== 'latest_revision_recorded_at' || !object(v.filters)) return false;
  try {
    const parsed = parseMonitoringFilters(Object.fromEntries(Object.entries(v.filters).filter(([, x]) => x !== null)));
    if (Object.keys(v.filters).length !== keys.length || keys.some(k => parsed[k as keyof MonitoringFilters] !== (v.filters as Record<string, unknown>)[k])) return false;
  } catch { return false; }
  const counts = (x: unknown, fields: readonly string[]): x is Record<string, number> => object(x)
    && Object.keys(x).length === fields.length && fields.every(k => Object.hasOwn(x, k) && Number.isSafeInteger(x[k]) && (x[k] as number) >= 0 && (x[k] as number) <= MONITORING_LIMIT);
  if (!counts(v.counts, ['transactions', 'assessed', 'not_assessed', 'flagged', 'alerts'])
    || !counts(v.assessment_statuses, MONITORING_ASSESSMENTS) || !counts(v.dimensions, MONITORING_DIMENSIONS)) return false;
  const c = v.counts;
  if (c.assessed! + c.not_assessed! !== c.transactions || c.flagged! > c.assessed!
    || Object.values(v.assessment_statuses).reduce((a, b) => a + b, 0) !== c.transactions || v.assessment_statuses.not_assessed !== c.not_assessed
    || Object.values(v.dimensions).some(n => n > c.flagged!)) return false;
  if (!Array.isArray(v.currencies) || v.currencies.length > MONITORING_LIMIT) return false;
  let total = 0, previous = '';
  for (const row of v.currencies) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'currency,transactions' || typeof row.currency !== 'string'
      || !/^[A-Z]{3}$/.test(row.currency) || row.currency <= previous || !Number.isSafeInteger(row.transactions) || (row.transactions as number) <= 0) return false;
    previous = row.currency; total += row.transactions as number;
  }
  return total === c.transactions && object(v.availability) && Object.keys(v.availability).length === 4
    && v.availability.source_lag_seconds === null && v.availability.institution_filter === 'unverified'
    && v.availability.account_identity === 'unverified' && v.availability.continuous_intake === 'not_attested'
    && object(v.limits) && Object.keys(v.limits).length === 3 && v.limits.transactions === MONITORING_LIMIT
    && v.limits.alerts === MONITORING_LIMIT && v.limits.scope_complete === true;
}
