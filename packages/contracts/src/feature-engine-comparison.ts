import { createHash } from 'node:crypto';
import { detachFeatureJSON, validateFeatureVector, UNAVAILABLE_REASONS, type FeatureAvailability } from './feature-catalog.js';

export const FEATURE_ENGINE_COMPARISON_VERSION = 'local-synthetic-engine-comparison-1' as const;
export const FEATURE_ENGINE_COMPARISON_LIMITS = Object.freeze({ records: 2000, queries: 8, currencies: 32, partitions: 1, scratch_bytes: 2147483648, evidence_bytes: 16777216, invocation_ms: 180000, report_bytes: 1048576 });
export const FEATURE_ENGINE_RUNTIME = Object.freeze({ java: '21.0.10', kafka: '4.1.2', streams: '4.1.2', rocksdb_jni: '9.7.3', inventory_sha256: 'efd8dcc34d81f51961a1d69dc5863c7307ba90fd9de985002b7e40e2b37edc9c' });
export const FEATURE_ENGINE_SEMANTICS = Object.freeze({ original: 'synthetic-feature-stream-1', extended: 'local-synthetic-features-1', window: 'occurred-anchor-open-start-closed-end-3600-v1', lifecycle: 'latest-available-revision-exact-replay-v1' });
export const FEATURE_ENGINE_SUPPORT = Object.freeze({
  planned: Object.freeze(['keyed_latest_available_revision', 'exact_duplicate_replay', 'currency_isolation', 'big_integer_vectors', 'explicit_anchor_window', 'clean_stop_restart']),
  unsupported: Object.freeze(['unclean_crash', 'production_watermarks', 'ttl_eviction', 'serving_freshness', 'unknown_coverage', 'real_identity']),
});
export type EngineCandidate = 'bounded_consumer' | 'kafka_streams';
export interface EngineQuery { id: string; corpus: 'original' | 'extended'; key: string; currency: string; as_of: string; anchor_at: string; eligible: boolean }
export interface FeatureEnginePlan {
  version: typeof FEATURE_ENGINE_COMPARISON_VERSION; mode: 'local_synthetic'; run_id: string;
  corpora: { id: 'original' | 'extended'; version: 'synthetic_golden_v1' | 'synthetic_extended_v1'; sha256: string; records: number }[];
  semantics: typeof FEATURE_ENGINE_SEMANTICS; runtime: typeof FEATURE_ENGINE_RUNTIME;
  candidates: ['bounded_consumer', 'kafka_streams']; currencies: string[]; queries: EngineQuery[];
  policy: { identity: 'synthetic_declared'; availability: 'available_at_lte_as_of'; anchor: 'explicit_occurred_at'; window_seconds: 3600; coverage: 'explicit_fixture_only'; lifecycle: 'latest_available_revision'; money: 'integer_minor_units_no_fx'; completeness: 'never_arrival_derived' };
  recovery: { fault: 'clean_stop_after_prefix'; prefix_records: number; replay_records: number; suffix_records: number; unsupported_fault: 'unclean_crash' };
  budgets: { records: number; queries: number; partitions: 1; scratch_bytes: number; evidence_bytes: number; invocation_ms: number; teardown_reserve_ms: number; process_output_bytes: number; state_bytes: number };
}
export interface EngineTrial {
  candidate: EngineCandidate; status: 'not_run' | 'failed' | 'observed'; failure: null | 'RUNTIME_MISSING' | 'EXECUTION_FAILED' | 'TIMEOUT' | 'LIMIT' | 'CLEANUP_UNCERTAIN';
  binding: null | { plan_sha256: string; runtime: typeof FEATURE_ENGINE_RUNTIME; source_before: string; source_after: string; compiled_before: string; compiled_after: string; input_before: string; input_after: string; evidence_sha256: string };
  outputs: { query_id: string; result: FeatureAvailability }[];
  recovery: null | { prefix_position: number; replay_records: number; final_position: number; state_sha256: string; owned_processes: 0 };
  observations: null | { setup_ms: number; processing_ms: number; teardown_ms: number; elapsed_ms: number; peak_scratch_bytes: number; retained_evidence_bytes: number; state_bytes: number; process_output_bytes: number };
}
export interface FeatureEngineReport {
  version: typeof FEATURE_ENGINE_COMPARISON_VERSION; mode: 'local_synthetic'; production_ready: false; acceptance: 'pending_independent_native_verification';
  plan: FeatureEnginePlan; expected: { query_id: string; result: FeatureAvailability }[]; trials: [EngineTrial, EngineTrial];
  comparisons: { query_id: string; status: 'match' | 'mismatch' | 'unsupported' | 'failure' }[];
  status: 'matched_observations' | 'mismatch' | 'unsupported' | 'failure';
}
export class FeatureEngineComparisonError extends Error {
  readonly code = 'FEATURE_ENGINE_COMPARISON_INVALID';
  constructor() { super('FEATURE_ENGINE_COMPARISON_INVALID'); this.name = 'FeatureEngineComparisonError'; }
}
function check(v: unknown): asserts v { if (!v) throw new FeatureEngineComparisonError(); }
function obj(v: any, fields: string): void { const keys = fields.split(' '); check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))); }
function str(v: any, re: RegExp): void { check(typeof v === 'string'); const m = re.exec(v); check(m !== null && m[0] === v); }
const id = (v: any) => str(v, /^synthetic_[A-Za-z0-9_]{1,70}$/);
const hash = (v: any) => str(v, /^[a-f0-9]{64}$/);
function uint(v: any, max: number, min = 0): void { check(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max); }
function time(v: any): void { str(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); const d = new Date(v); check(Number.isFinite(d.getTime()) && d.toISOString() === v.replace('Z', '.000Z')); }
function canonical(v: any): string { return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v); }
const same = (a: any, b: any) => canonical(a) === canonical(b);
function array(v: any, max: number, min = 0): void { check(Array.isArray(v) && v.length >= min && v.length <= max); }
function plan(p: any): void {
  obj(p, 'version mode run_id corpora semantics runtime candidates currencies queries policy recovery budgets');
  check(p.version === FEATURE_ENGINE_COMPARISON_VERSION && p.mode === 'local_synthetic'); id(p.run_id);
  check(same(p.semantics, FEATURE_ENGINE_SEMANTICS) && same(p.runtime, FEATURE_ENGINE_RUNTIME) && same(p.candidates, ['bounded_consumer', 'kafka_streams']));
  array(p.corpora, 2, 2); let records = 0;
  p.corpora.forEach((c: any, i: number) => { obj(c, 'id version sha256 records'); check(c.id === ['original', 'extended'][i] && c.version === ['synthetic_golden_v1', 'synthetic_extended_v1'][i]); hash(c.sha256); uint(c.records, 2000, 1); records += c.records; });
  obj(p.budgets, 'records queries partitions scratch_bytes evidence_bytes invocation_ms teardown_reserve_ms process_output_bytes state_bytes');
  for (const k of ['records', 'queries', 'scratch_bytes', 'evidence_bytes', 'invocation_ms'] as const) uint(p.budgets[k], FEATURE_ENGINE_COMPARISON_LIMITS[k], 1);
  check(records <= p.budgets.records && p.budgets.partitions === 1); uint(p.budgets.teardown_reserve_ms, p.budgets.invocation_ms - 1, 1);
  uint(p.budgets.process_output_bytes, p.budgets.evidence_bytes, 1); uint(p.budgets.state_bytes, p.budgets.scratch_bytes, 1);
  array(p.currencies, 32, 1); p.currencies.forEach((c: any) => str(c, /^[A-Z]{3}$/)); check(new Set(p.currencies).size === p.currencies.length);
  array(p.queries, p.budgets.queries, 1); const ids = new Set();
  p.queries.forEach((q: any) => { obj(q, 'id corpus key currency as_of anchor_at eligible'); id(q.id); id(q.key); check(!ids.has(q.id)); ids.add(q.id); check(['original', 'extended'].includes(q.corpus) && p.currencies.includes(q.currency) && typeof q.eligible === 'boolean'); time(q.as_of); time(q.anchor_at); check(q.anchor_at <= q.as_of); });
  check(same(p.policy, { identity: 'synthetic_declared', availability: 'available_at_lte_as_of', anchor: 'explicit_occurred_at', window_seconds: 3600, coverage: 'explicit_fixture_only', lifecycle: 'latest_available_revision', money: 'integer_minor_units_no_fx', completeness: 'never_arrival_derived' }));
  obj(p.recovery, 'fault prefix_records replay_records suffix_records unsupported_fault'); const r = p.recovery;
  check(r.fault === 'clean_stop_after_prefix' && r.unsupported_fault === 'unclean_crash'); uint(r.prefix_records, records - 1, 1); uint(r.replay_records, r.prefix_records, 1); uint(r.suffix_records, records, 1); check(r.prefix_records + r.suffix_records === records);
}
function availability(r: any): void {
  if (r?.status === 'available') { obj(r, 'status vector'); validateFeatureVector(r.vector); for (const k of ['attempt_count', 'gross_count', 'reversed_count', 'net_active_count']) check(BigInt(r.vector[k]) <= 2000n); }
  else { obj(r, 'status reason'); check(r.status === 'unavailable' && UNAVAILABLE_REASONS.includes(r.reason)); }
}
function outputs(v: any, p: FeatureEnginePlan, complete: boolean): void {
  array(v, p.queries.length); const ids = new Set();
  v.forEach((x: any) => { obj(x, 'query_id result'); check(p.queries.some(q => q.id === x.query_id) && !ids.has(x.query_id)); ids.add(x.query_id); availability(x.result); });
  if (complete) check(v.length === p.queries.length);
}
function planHash(p: FeatureEnginePlan): string { return createHash('sha256').update(canonical(p)).digest('hex'); }
function trial(t: any, p: FeatureEnginePlan, i: number): void {
  obj(t, 'candidate status failure binding outputs recovery observations'); check(t.candidate === p.candidates[i]);
  check(['not_run', 'failed', 'observed'].includes(t.status)); outputs(t.outputs, p, t.status === 'observed');
  if (t.status === 'not_run') { check(t.failure === null && t.binding === null && t.recovery === null && t.observations === null && t.outputs.length === 0); return; }
  check(t.status === 'observed' ? t.failure === null : ['RUNTIME_MISSING', 'EXECUTION_FAILED', 'TIMEOUT', 'LIMIT', 'CLEANUP_UNCERTAIN'].includes(t.failure));
  if (t.binding !== null) {
    obj(t.binding, 'plan_sha256 runtime source_before source_after compiled_before compiled_after input_before input_after evidence_sha256');
    const b = t.binding; check(b.plan_sha256 === planHash(p) && same(b.runtime, p.runtime));
    for (const k of ['source_before', 'source_after', 'compiled_before', 'compiled_after', 'input_before', 'input_after', 'evidence_sha256']) hash(b[k]);
    check(b.source_before === b.source_after && b.compiled_before === b.compiled_after && b.input_before === b.input_after);
    check(b.input_before === createHash('sha256').update(canonical(p.corpora)).digest('hex'));
  }
  if (t.recovery !== null) { obj(t.recovery, 'prefix_position replay_records final_position state_sha256 owned_processes'); check(t.recovery.prefix_position === p.recovery.prefix_records && t.recovery.replay_records === p.recovery.replay_records && t.recovery.final_position === p.recovery.prefix_records + p.recovery.suffix_records && t.recovery.owned_processes === 0); hash(t.recovery.state_sha256); }
  if (t.observations !== null) {
    const o = t.observations; obj(o, 'setup_ms processing_ms teardown_ms elapsed_ms peak_scratch_bytes retained_evidence_bytes state_bytes process_output_bytes');
    for (const k of ['setup_ms', 'processing_ms', 'teardown_ms', 'elapsed_ms']) uint(o[k], p.budgets.invocation_ms);
    check(o.setup_ms + o.processing_ms + o.teardown_ms === o.elapsed_ms && o.setup_ms + o.processing_ms <= p.budgets.invocation_ms - p.budgets.teardown_reserve_ms);
    for (const [k, limit] of Object.entries({ peak_scratch_bytes: p.budgets.scratch_bytes, retained_evidence_bytes: p.budgets.evidence_bytes, state_bytes: p.budgets.state_bytes, process_output_bytes: p.budgets.process_output_bytes })) uint(o[k], limit);
  }
  if (t.status === 'observed') check(t.binding !== null && t.recovery !== null && t.observations !== null);
}
function report(r: any): void {
  obj(r, 'version mode production_ready acceptance plan expected trials comparisons status');
  check(r.version === FEATURE_ENGINE_COMPARISON_VERSION && r.mode === 'local_synthetic' && r.production_ready === false && r.acceptance === 'pending_independent_native_verification');
  plan(r.plan); const p: FeatureEnginePlan = r.plan; outputs(r.expected, p, true); array(r.trials, 2, 2); r.trials.forEach((t: any, i: number) => trial(t, p, i));
  array(r.comparisons, p.queries.length, p.queries.length);
  const statuses = p.queries.map((q, i) => {
    const c = r.comparisons[i]; obj(c, 'query_id status'); check(c.query_id === q.id);
    const expected = r.expected.find((x: any) => x.query_id === q.id).result;
    const results = [expected, ...r.trials.filter((t: any) => t.status === 'observed').map((t: any) => t.outputs.find((x: any) => x.query_id === q.id).result)];
    const unsupported = !q.eligible || results.some(x => x.status === 'unavailable' && x.reason === 'UNSUPPORTED_FEATURE');
    const status = r.trials.some((t: any) => t.status !== 'observed') ? 'failure' : unsupported ? 'unsupported' : results.every(x => same(x, expected)) ? 'match' : 'mismatch';
    check(c.status === status); return status;
  });
  check(r.status === (statuses.includes('failure') ? 'failure' : statuses.includes('mismatch') ? 'mismatch' : statuses.includes('unsupported') ? 'unsupported' : 'matched_observations'));
}
function validate<T>(v: unknown, fn: (v: any) => void): T { try { const copy = detachFeatureJSON(v, FEATURE_ENGINE_COMPARISON_LIMITS.report_bytes); fn(copy); return copy; } catch { throw new FeatureEngineComparisonError(); } }
export const validateFeatureEnginePlan = (v: unknown): FeatureEnginePlan => validate(v, plan);
export const validateFeatureEngineReport = (v: unknown): FeatureEngineReport => validate(v, report);
export const serializeFeatureEnginePlan = (v: unknown): string => canonical(validateFeatureEnginePlan(v));
export const serializeFeatureEngineReport = (v: unknown): string => canonical(validateFeatureEngineReport(v));
export const featureEnginePlanHash = (v: unknown): string => planHash(validateFeatureEnginePlan(v));
