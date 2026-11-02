import { createHash } from 'node:crypto';
import { detachFeatureJSON } from './feature-catalog.js';
export const FEATURE_PARITY_VERSION = 'local-synthetic-parity-1' as const;
export const FEATURE_PARITY_LIMITS = Object.freeze({ records: 2000, queries: 8, keys: 2000, bytes: 2097152 });
export const FEATURE_PARITY_SEMANTICS = Object.freeze({ feature: 'count-amount-1', lifecycle: 'latest-eligible-revision-1', semantic: 'occurred-open-closed-1', availability: 'available-at-lte-as-of-1' });
export class FeatureParityError extends Error {
  constructor(readonly code: 'PARITY_INVALID' | 'PARITY_LIMIT' = 'PARITY_INVALID') { super(code); this.name = 'FeatureParityError'; }
}
export interface ParityQuery { id: string; key: string; currency: string; as_of: string; anchor_at: string; window_seconds: number; member_ids: string[] }
export interface FeatureParityPlan {
  version: typeof FEATURE_PARITY_VERSION; mode: 'local_synthetic'; input_sha256: string;
  semantics: { feature: string; lifecycle: string; semantic: string; availability: string };
  runtime: { python: string; typescript: string; source_sha256: string; compiled_sha256: string };
  fixture: { now: string; retention_seconds: number; coverage: 'explicit_cohort_only' }; queries: ParityQuery[];
}
export interface ParityLineage {
  event_id: string; key: string; currency: string; revision: number; source_position: number;
  occurred_at: string; available_at: string | null; availability_sha256: string | null;
  record_sha256: string; amount: string; active: boolean;
}
export interface FeatureParityInput { version: typeof FEATURE_PARITY_VERSION; mode: 'local_synthetic'; records: ParityLineage[] }
export interface ParityObservation {
  query: ParityQuery; plan_sha256: string; input_sha256: string; cohort_sha256: string;
  semantics: FeatureParityPlan['semantics']; runtime: FeatureParityPlan['runtime'];
  status: 'available' | 'unavailable' | 'retrospective' | 'unsupported'; count: string | null; amount: string | null;
}
export type ParityStatus = 'matched_observations' | 'mismatch' | 'unavailable' | 'retrospective' | 'unsupported';
export interface FeatureParityReport {
  version: typeof FEATURE_PARITY_VERSION; mode: 'local_synthetic'; production_ready: false;
  acceptance: 'pending_independent_runtime_verification'; plan_sha256: string; input_sha256: string;
  comparisons: { query_id: string; status: ParityStatus; cohort_sha256: string; selected_records: number }[];
}
function ok(v: unknown, limit = false): asserts v { if (!v) throw new FeatureParityError(limit ? 'PARITY_LIMIT' : 'PARITY_INVALID'); }
function obj(v: any, fields: string): void { const ks = fields.split(' '); ok(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === ks.length && ks.every(k => Object.hasOwn(v, k))); }
function str(v: any, re: RegExp): void { ok(typeof v === 'string' && re.exec(v)?.[0] === v); }
const hash = (v: any) => str(v, /^[a-f0-9]{64}$/);
const id = (v: any) => str(v, /^synthetic_[A-Za-z0-9_]{1,70}$/);
function uint(v: any, max = Number.MAX_SAFE_INTEGER, min = 0): void { ok(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min); ok(v <= max, true); }
function time(v: any): void { str(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); ok(Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v.replace('Z', '.000Z')); }
function array(v: any, max: number): void { ok(Array.isArray(v)); ok(v.length <= max, true); }
function canonical(v: any): string { return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v); }
const same = (a: any, b: any) => canonical(a) === canonical(b);
const digest = (v: any) => createHash('sha256').update(canonical(v)).digest('hex');
function detached(v: unknown): any { try { return detachFeatureJSON(v, FEATURE_PARITY_LIMITS.bytes); } catch (e) { throw new FeatureParityError((e as { code?: string }).code === 'FEATURE_LIMIT' ? 'PARITY_LIMIT' : 'PARITY_INVALID'); } }
function query(q: any): void { obj(q, 'id key currency as_of anchor_at window_seconds member_ids'); id(q.id); id(q.key); str(q.currency, /^[A-Z]{3}$/); time(q.as_of); time(q.anchor_at); ok(q.anchor_at <= q.as_of); uint(q.window_seconds, 31536000, 1); array(q.member_ids, 2000); q.member_ids.forEach(id); ok(new Set(q.member_ids).size === q.member_ids.length); ok(q.member_ids.every((v: string, i: number) => i === 0 || q.member_ids[i - 1] < v)); }
function semantics(s: any): void { obj(s, 'feature lifecycle semantic availability'); for (const v of Object.values(s)) str(v, /^[a-z][a-z0-9-]{0,95}$/); }
function runtime(r: any): void { obj(r, 'python typescript source_sha256 compiled_sha256'); for (const k of ['python', 'typescript']) str(r[k], /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/); hash(r.source_sha256); hash(r.compiled_sha256); }
export function validateFeatureParityPlan(v: unknown): FeatureParityPlan {
  const p = detached(v); obj(p, 'version mode input_sha256 semantics runtime fixture queries'); ok(p.version === FEATURE_PARITY_VERSION && p.mode === 'local_synthetic'); hash(p.input_sha256); semantics(p.semantics); runtime(p.runtime);
  obj(p.fixture, 'now retention_seconds coverage'); time(p.fixture.now); uint(p.fixture.retention_seconds, 31536000, 1); ok(p.fixture.coverage === 'explicit_cohort_only');
  array(p.queries, 8); ok(p.queries.length > 0); const ids = new Set(); for (const q of p.queries) { query(q); ok(!ids.has(q.id) && q.as_of <= p.fixture.now); ids.add(q.id); } return p;
}
export function validateFeatureParityInput(v: unknown): FeatureParityInput {
  const x = detached(v); obj(x, 'version mode records'); ok(x.version === FEATURE_PARITY_VERSION && x.mode === 'local_synthetic'); array(x.records, 2000);
  const revisions = new Set(), positions = new Set(), identities = new Map();
  for (const r of x.records) {
    obj(r, 'event_id key currency revision source_position occurred_at available_at availability_sha256 record_sha256 amount active'); id(r.event_id); id(r.key); str(r.currency, /^[A-Z]{3}$/); uint(r.revision); uint(r.source_position); time(r.occurred_at); hash(r.record_sha256);
    if (r.available_at === null) ok(r.availability_sha256 === null); else { time(r.available_at); hash(r.availability_sha256); }
    str(r.amount, /^(0|[1-9][0-9]{0,23})\.[0-9]{2}$/); ok(typeof r.active === 'boolean');
    const identity = r.key + ':' + r.currency; ok(!identities.has(r.event_id) || identities.get(r.event_id) === identity); identities.set(r.event_id, identity);
    const rev = r.event_id + ':' + r.revision; ok(!revisions.has(rev) && !positions.has(r.source_position)); revisions.add(rev); positions.add(r.source_position);
  } ok(new Set(x.records.map((r: ParityLineage) => r.key)).size <= 2000, true); return x;
}
export const serializeFeatureParityPlan = (v: unknown): string => canonical(validateFeatureParityPlan(v));
export const serializeFeatureParityInput = (v: unknown): string => canonical(validateFeatureParityInput(v));
export const featureParityPlanHash = (v: unknown): string => digest(validateFeatureParityPlan(v));
export const featureParityInputHash = (v: unknown): string => digest(validateFeatureParityInput(v));
/** Select revisions before event-time window filtering; source position never chooses a revision. */
export function selectFeatureParityCohort(plan: unknown, input: unknown, queryId: string): { status: 'eligible' | 'unavailable' | 'unsupported'; records: ParityLineage[]; cohort_sha256: string } {
  const p = validateFeatureParityPlan(plan), x = validateFeatureParityInput(input); ok(digest(x) === p.input_sha256); const q = p.queries.find(q => q.id === queryId); ok(q);
  const candidates = x.records.filter(r => r.key === q.key && r.currency === q.currency && q.member_ids.includes(r.event_id));
  let status: 'eligible' | 'unavailable' | 'unsupported' = same(p.semantics, FEATURE_PARITY_SEMANTICS) ? 'eligible' : 'unsupported';
  if (status === 'eligible' && (candidates.some(r => r.available_at === null) || q.member_ids.some(id => !candidates.some(r => r.event_id === id && r.available_at !== null && r.available_at <= q.as_of)))) status = 'unavailable';
  const latest = new Map<string, ParityLineage>();
  for (const r of candidates) if (r.available_at !== null && r.available_at <= q.as_of) { const old = latest.get(r.event_id); if (!old || old.revision < r.revision) latest.set(r.event_id, r); }
  const start = Date.parse(q.anchor_at) - q.window_seconds * 1000;
  const records = [...latest.values()].filter(r => Date.parse(r.occurred_at) > start && r.occurred_at <= q.anchor_at).sort((a, b) => a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0);
  return { status, records, cohort_sha256: digest({ query: q, records }) };
}
function observation(v: any): void {
  obj(v, 'query plan_sha256 input_sha256 cohort_sha256 semantics runtime status count amount'); query(v.query); for (const k of ['plan_sha256', 'input_sha256', 'cohort_sha256']) hash(v[k]); semantics(v.semantics); runtime(v.runtime);
  ok(['available', 'unavailable', 'retrospective', 'unsupported'].includes(v.status));
  if (v.status === 'available') { str(v.count, /^(0|[1-9][0-9]{0,3})$/); ok(BigInt(v.count) <= 2000n); str(v.amount, /^(0|[1-9][0-9]{0,27})\.[0-9]{2}$/); } else ok(v.count === null && v.amount === null);
}
export function compareFeatureParity(plan: unknown, input: unknown, online: unknown, offline: unknown): FeatureParityReport {
  const p = validateFeatureParityPlan(plan), x = validateFeatureParityInput(input), a = detached(online), b = detached(offline); ok(digest(x) === p.input_sha256);
  array(a, 8); array(b, 8); ok(a.length === p.queries.length && b.length === p.queries.length); a.forEach(observation); b.forEach(observation);
  const ph = digest(p);
  const comparisons = p.queries.map((q, i) => {
    const c = selectFeatureParityCohort(p, x, q.id), left = a[i], right = b[i];
    const bound = (o: ParityObservation) => same(o.query, q) && o.plan_sha256 === ph && o.input_sha256 === p.input_sha256 && o.cohort_sha256 === c.cohort_sha256 && same(o.semantics, p.semantics) && same(o.runtime, p.runtime);
    let status: ParityStatus;
    if (!bound(left) || !bound(right)) status = 'mismatch';
    else if (c.status !== 'eligible') status = c.status;
    else if ([left.status, right.status].includes('unsupported')) status = 'unsupported';
    else if ([left.status, right.status].includes('retrospective')) status = 'retrospective';
    else if ([left.status, right.status].includes('unavailable')) status = 'unavailable';
    else {
      const active = c.records.filter(r => r.active);
      const minor = active.reduce((sum, r) => sum + BigInt(r.amount.replace('.', '')), 0n);
      const amount = (minor / 100n).toString() + '.' + (minor % 100n).toString().padStart(2, '0');
      status = left.count === String(active.length) && right.count === String(active.length) && left.amount === amount && right.amount === amount ? 'matched_observations' : 'mismatch';
    }
    return { query_id: q.id, status, cohort_sha256: c.cohort_sha256, selected_records: c.records.length };
  });
  return { version: FEATURE_PARITY_VERSION, mode: 'local_synthetic', production_ready: false, acceptance: 'pending_independent_runtime_verification', plan_sha256: ph, input_sha256: p.input_sha256, comparisons };
}
/** Recompute a report; caller flags never authorize runtime acceptance. */
export function validateFeatureParityReport(report: unknown, plan: unknown, input: unknown, online: unknown, offline: unknown): FeatureParityReport {
  const actual = compareFeatureParity(plan, input, online, offline); ok(same(detached(report), actual)); return actual;
}
export function serializeFeatureParityReport(report: unknown, plan: unknown, input: unknown, online: unknown, offline: unknown): string { return canonical(validateFeatureParityReport(report, plan, input, online, offline)); }
