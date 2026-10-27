import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';

/** Supplied fixture pools only; validation grants no review or training authority. */
export const QA_SAMPLING_VERSION = 'synthetic-qa-sampling-1';
export const MAX_QA_POOL_BYTES = 4 * 1024 * 1024;
export const MAX_QA_ROWS = 10000;
export const MAX_QA_SELECTED = 1000;
export const MAX_QA_REPORT_BYTES = 1024 * 1024;
export const QA_SAMPLING_BOUNDARY = Object.freeze({ provenance: 'local_synthetic', execution_mode: 'test',
  simulation_only: true, enforcement: false, production_ready: false } as const);
export type QaSamplingBoundary = typeof QA_SAMPLING_BOUNDARY;
export interface QaSamplingCaller extends QaSamplingBoundary { workspace_id: string; client_id: string }
export type QaAlertStatus = 'alert' | 'non_alert';
export interface QaSamplingEvidence { evidence_id: string; available_at: string }
export interface QaSamplingRow { fixture_id: string; stratum_id: string; alert_status: QaAlertStatus; evidence: QaSamplingEvidence[] }
export interface QaSamplingPool extends QaSamplingBoundary {
  contract_version: typeof QA_SAMPLING_VERSION; pool_id: string; row_count: number; rows: QaSamplingRow[];
}
export interface QaSamplingStratum { stratum_id: string; alert_status: QaAlertStatus; requested_count: number }
export interface QaSamplingPolicy extends QaSamplingBoundary {
  contract_version: typeof QA_SAMPLING_VERSION; policy_id: string; policy_version: string;
  as_of: string; seed: string; strata: QaSamplingStratum[];
}
export interface QaSamplingStratumResult extends QaSamplingStratum {
  status: 'missing' | 'insufficient' | 'satisfied'; pool_count: number; eligible_count: number;
  excluded_future_evidence_count: number; selected_count: number;
  fraction: { numerator: number; denominator: number }; selected: QaSamplingRow[];
}
export interface QaSamplingResult extends QaSamplingBoundary {
  contract_version: typeof QA_SAMPLING_VERSION; caller: QaSamplingCaller;
  pool_id: string; pool_hash: string; policy_hash: string; policy: QaSamplingPolicy;
  population_claims: false; row_count: number; selected_count: number; strata: QaSamplingStratumResult[];
}
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
// Absolute end assertion also rejects a trailing newline (JavaScript `$` permits one).
const id = { type: 'string', pattern: '^synthetic_[A-Za-z0-9_.:-]{1,70}(?![\\s\\S])', maxLength: 80 };
const timestamp = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$', format: 'date-time', maxLength: 24 };
const count = (maximum: number) => ({ type: 'integer', minimum: 0, maximum });
const array = (items: object, maxItems: number) => ({ type: 'array', items, maxItems });
const boundary = Object.fromEntries(Object.entries(QA_SAMPLING_BOUNDARY).map(([k, v]) => [k, { const: v }]));
const version = { const: QA_SAMPLING_VERSION };
const alertStatus = { enum: ['alert', 'non_alert'] };
const stratum = { stratum_id: id, alert_status: alertStatus, requested_count: count(MAX_QA_SELECTED) };
export const qaSamplingCallerSchema = object({ ...boundary, workspace_id: id, client_id: id });
export const qaSamplingEvidenceSchema = object({ evidence_id: id, available_at: timestamp });
export const qaSamplingRowSchema = object({ fixture_id: id, stratum_id: id, alert_status: alertStatus,
  evidence: { ...array(qaSamplingEvidenceSchema, MAX_QA_ROWS), minItems: 1 } });
export const qaSamplingPoolSchema = object({ ...boundary, contract_version: version, pool_id: id,
  row_count: count(MAX_QA_ROWS), rows: array(qaSamplingRowSchema, MAX_QA_ROWS) });
export const qaSamplingPolicySchema = object({ ...boundary, contract_version: version, policy_id: id,
  policy_version: id, as_of: timestamp, seed: id,
  strata: { ...array(object(stratum), MAX_QA_ROWS), minItems: 1 } });
export const qaSamplingStratumResultSchema = object({ ...stratum,
  status: { enum: ['missing', 'insufficient', 'satisfied'] }, pool_count: count(MAX_QA_ROWS),
  eligible_count: count(MAX_QA_ROWS), excluded_future_evidence_count: count(MAX_QA_ROWS),
  selected_count: count(MAX_QA_SELECTED), fraction: object({ numerator: count(MAX_QA_SELECTED), denominator: count(MAX_QA_ROWS) }),
  selected: array(qaSamplingRowSchema, MAX_QA_SELECTED) });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$', maxLength: 64 };
export const qaSamplingResultSchema = object({ ...boundary, contract_version: version, caller: qaSamplingCallerSchema,
  pool_id: id, pool_hash: hash, policy_hash: hash, policy: qaSamplingPolicySchema, population_claims: { const: false },
  row_count: count(MAX_QA_ROWS), selected_count: count(MAX_QA_SELECTED), strata: array(qaSamplingStratumResultSchema, MAX_QA_ROWS) });
const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
formats.default(ajv, { mode: 'full', formats: ['date-time'] });
function validator<T>(schema: object, maxBytes = MAX_QA_POOL_BYTES): (value: unknown) => value is T {
  const check = ajv.compile<T>(schema);
  return (value: unknown): value is T => {
    try { const json = JSON.stringify(value); return typeof json === 'string' && Buffer.byteLength(json, 'utf8') <= maxBytes && check(value) === true; }
    catch { return false; }
  };
}
const unique = (ids: string[]) => new Set(ids).size === ids.length;
function validRows(rows: QaSamplingRow[]): boolean {
  const statuses = new Map<string, QaAlertStatus>();
  const evidence = new Map<string, string>();
  return unique(rows.map(r => r.fixture_id)) && rows.every(r => {
    if (statuses.has(r.stratum_id) && statuses.get(r.stratum_id) !== r.alert_status) return false;
    statuses.set(r.stratum_id, r.alert_status);
    return unique(r.evidence.map(e => e.evidence_id)) && r.evidence.every(e => {
      if (evidence.has(e.evidence_id) && evidence.get(e.evidence_id) !== e.available_at) return false;
      evidence.set(e.evidence_id, e.available_at); return true;
    });
  });
}
export const isQaSamplingCaller = validator<QaSamplingCaller>(qaSamplingCallerSchema);
const poolCheck = validator<QaSamplingPool>(qaSamplingPoolSchema);
export function isQaSamplingPool(value: unknown): value is QaSamplingPool {
  return poolCheck(value) && value.row_count === value.rows.length && validRows(value.rows);
}
const policyCheck = validator<QaSamplingPolicy>(qaSamplingPolicySchema);
export function isQaSamplingPolicy(value: unknown): value is QaSamplingPolicy {
  return policyCheck(value) && unique(value.strata.map(s => s.stratum_id)) &&
    value.strata.reduce((n, s) => n + s.requested_count, 0) <= MAX_QA_SELECTED;
}
const resultCheck = validator<QaSamplingResult>(qaSamplingResultSchema, MAX_QA_REPORT_BYTES);
export function isQaSamplingResult(value: unknown): value is QaSamplingResult {
  if (!resultCheck(value) || !isQaSamplingPolicy(value.policy) || value.strata.length !== value.policy.strata.length ||
      !unique(value.strata.map(s => s.stratum_id))) return false;
  const rows = value.strata.flatMap(s => s.selected);
  if (!validRows(rows) || value.selected_count !== rows.length ||
      value.row_count !== value.strata.reduce((n, s) => n + s.pool_count, 0)) return false;
  return value.strata.every(s => {
    const p = value.policy.strata.find(p => p.stratum_id === s.stratum_id);
    const expected = Math.min(s.requested_count, s.eligible_count);
    return p !== undefined && p.alert_status === s.alert_status && p.requested_count === s.requested_count &&
      s.pool_count === s.eligible_count + s.excluded_future_evidence_count && s.selected_count === expected &&
      s.selected.length === expected && s.fraction.numerator === expected && s.fraction.denominator === s.pool_count &&
      s.status === (s.pool_count === 0 ? 'missing' : s.eligible_count < s.requested_count ? 'insufficient' : 'satisfied') &&
      s.selected.every(r => r.stratum_id === s.stratum_id && r.alert_status === s.alert_status &&
        r.evidence.every(e => e.available_at <= value.policy.as_of));
  });
}
export class QaSamplingContractError extends Error {
  readonly code = 'QA_SAMPLING_INVALID_INPUT';
  constructor() { super('QA_SAMPLING_INVALID_INPUT; private diagnostics withheld.'); this.name = 'QaSamplingContractError'; }
}
function parse<T>(json: string, limit: number, check: (value: unknown) => value is T): T {
  try {
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > limit) throw new Error();
    const value: unknown = JSON.parse(json);
    if (!check(value)) throw new Error();
    return value;
  } catch { throw new QaSamplingContractError(); }
}
export const parseQaSamplingCaller = (json: string): QaSamplingCaller => parse(json, MAX_QA_POOL_BYTES, isQaSamplingCaller);
export const parseQaSamplingPool = (json: string): QaSamplingPool => parse(json, MAX_QA_POOL_BYTES, isQaSamplingPool);
export const parseQaSamplingPolicy = (json: string): QaSamplingPolicy => parse(json, MAX_QA_POOL_BYTES, isQaSamplingPolicy);
export const parseQaSamplingResult = (json: string): QaSamplingResult => parse(json, MAX_QA_REPORT_BYTES, isQaSamplingResult);
