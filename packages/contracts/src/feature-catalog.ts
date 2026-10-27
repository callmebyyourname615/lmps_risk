import { createHash } from 'node:crypto';
import { types } from 'node:util';
/** Synthetic declarations only; this module never attests real source semantics. */
export const FEATURE_CATALOG_VERSION = 'local-synthetic-features-1' as const;
export const FEATURE_LIMITS = Object.freeze({ deliveries: 2000, queries: 8, bytes: 2097152, golden_deliveries: 32, golden_bytes: 65536 });
export const UNAVAILABLE_REASONS = ['UNSUPPORTED_FEATURE', 'UNKNOWN_LIFECYCLE', 'UNKNOWN_REVERSAL', 'IDENTITY_UNAVAILABLE', 'COVERAGE_INCOMPLETE', 'CURRENCY_CONFLICT', 'STALE_EVIDENCE', 'LATE_EVENT', 'LIMIT_EXCEEDED'] as const;
export type UnavailableReason = typeof UNAVAILABLE_REASONS[number];
export class FeatureCatalogError extends Error {
  constructor(readonly code: 'FEATURE_MALFORMED' | 'FEATURE_LIMIT' = 'FEATURE_MALFORMED') { super(code); this.name = 'FeatureCatalogError'; }
}
function check(v: unknown, code: 'FEATURE_MALFORMED' | 'FEATURE_LIMIT' = 'FEATURE_MALFORMED'): asserts v { if (!v) throw new FeatureCatalogError(code); }
/** Descriptor-only detached JSON. No getters, toJSON, exotic prototypes or lossy encoding. */
export function detachFeatureJSON(value: unknown, maxBytes: number = FEATURE_LIMITS.bytes): any {
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= FEATURE_LIMITS.bytes);
  const seen = new Set<object>();
  let encodedBytes = 0;
  function charge(n: number): void { encodedBytes += n; check(encodedBytes <= maxBytes, 'FEATURE_LIMIT'); }
  function visit(v: any, depth: number): any {
    check(depth <= 32);
    if (v === null || typeof v === 'boolean') { charge(JSON.stringify(v).length); return v; }
    if (typeof v === 'string') { check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)); charge(Buffer.byteLength(JSON.stringify(v))); return v; }
    if (typeof v === 'number') { check(Number.isSafeInteger(v) && !Object.is(v, -0)); charge(JSON.stringify(v).length); return v; }
    check(typeof v === 'object' && !types.isProxy(v) && !seen.has(v)); const array = Array.isArray(v);
    check(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype)); seen.add(v);
    const keys = Reflect.ownKeys(v), out: any = array ? [] : {};
    if (array) check(v.length <= 2000 && keys.length === v.length + 1, 'FEATURE_LIMIT');
    charge(2 + Math.max(0, keys.length - (array ? 1 : 0) - 1));
    for (const key of keys) {
      check(typeof key === 'string'); if (array && key === 'length') continue;
      if (array) check(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < v.length);
      check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(key));
      if (!array) charge(Buffer.byteLength(JSON.stringify(key)) + 1);
      const d = Object.getOwnPropertyDescriptor(v, key)!; check(d.enumerable && 'value' in d);
      Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(v); return out;
  }
  const result = visit(value, 0); check(Buffer.byteLength(JSON.stringify(result)) <= maxBytes, 'FEATURE_LIMIT'); return result;
}
function obj(v: any, fields: string): void { const keys = fields.split(' '); check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))); }
function str(v: any, re: RegExp): void { check(typeof v === 'string'); const match = re.exec(v); check(match !== null && match[0] === v); }
function id(v: any): void { str(v, /^synthetic_[A-Za-z0-9_]{1,70}$/); }
function uint(v: any, max = Number.MAX_SAFE_INTEGER, min = 0): void { check(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max); }
function time(v: any): void { str(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); const d = new Date(v); check(Number.isFinite(d.getTime()) && d.toISOString() === v.replace('Z', '.000Z')); }
function money(v: any): void { str(v, /^(0|[1-9][0-9]{0,21})\.[0-9]{2}$/); }
export function featureMoneyMinor(v: unknown): bigint { money(v); return BigInt((v as string).replace('.', '')); }
export interface FeaturePolicy {
  version: typeof FEATURE_CATALOG_VERSION; scope: 'local_synthetic'; identity: 'synthetic_declared';
  run_id: string; namespace: string; input_identity: string; semantics: typeof FEATURE_CATALOG_VERSION;
  currencies: string[]; anchor: 'occurred_at'; window_seconds: number; watermark: string; coverage_start: string;
  allowed_lateness_seconds: number; active_ttl_seconds: number; freshness_seconds: number;
  limits: { deliveries: number; payments: number; attempts: number; revisions_per_payment: number; deliveries_per_key: number; queries: number; bytes: number };
}
export interface FeatureRevision {
  namespace: string; payment_id: string; attempt_id: string; revision_id: string; revision_number: number; account_id: string;
  occurred_at: string; available_at: string; currency: string; attempt_amount: string; gross_amount: string; reversed_amount: string | null;
  lifecycle: 'pending' | 'failed' | 'succeeded' | 'partially_reversed' | 'reversed' | 'unknown'; identity: 'synthetic_declared' | 'unknown'; coverage: 'complete' | 'unknown';
}
export interface FeatureDelivery { position: number; revision: FeatureRevision }
export interface FeatureQuery { id: string; account_id: string; currency: string; as_of: string }
export const VECTOR_FIELDS = ['attempt_count', 'attempt_amount', 'gross_count', 'gross_amount', 'reversed_count', 'reversed_amount', 'net_active_count', 'net_amount'] as const;
export type FeatureVector = Record<typeof VECTOR_FIELDS[number], string>;
export type FeatureAvailability = { status: 'available'; vector: FeatureVector } | { status: 'unavailable'; reason: UnavailableReason };
export interface FeatureSnapshot { version: typeof FEATURE_CATALOG_VERSION; query: FeatureQuery; watermark: string; result: FeatureAvailability }
export interface FeatureState { version: typeof FEATURE_CATALOG_VERSION; policy: FeaturePolicy; next_position: number; watermark: string; deliveries: FeatureDelivery[]; snapshots: FeatureSnapshot[] }
function policy(p: any): void {
  obj(p, 'version scope identity run_id namespace input_identity semantics currencies anchor window_seconds watermark coverage_start allowed_lateness_seconds active_ttl_seconds freshness_seconds limits');
  check(p.version === FEATURE_CATALOG_VERSION && p.semantics === FEATURE_CATALOG_VERSION && p.scope === 'local_synthetic' && p.identity === 'synthetic_declared' && p.anchor === 'occurred_at');
  id(p.run_id); id(p.namespace); id(p.input_identity); time(p.watermark); time(p.coverage_start); check(p.coverage_start <= p.watermark);
  check(Array.isArray(p.currencies) && p.currencies.length > 0 && p.currencies.length <= 32); p.currencies.forEach((c: any) => str(c, /^[A-Z]{3}$/)); check(new Set(p.currencies).size === p.currencies.length);
  uint(p.window_seconds, 31536000, 1); uint(p.allowed_lateness_seconds, 31536000); uint(p.active_ttl_seconds, 31536000, p.window_seconds + p.allowed_lateness_seconds); uint(p.freshness_seconds, 31536000);
  obj(p.limits, 'deliveries payments attempts revisions_per_payment deliveries_per_key queries bytes');
  for (const k of ['deliveries', 'payments', 'attempts', 'revisions_per_payment', 'deliveries_per_key']) uint(p.limits[k], 2000, 1);
  uint(p.limits.queries, 8, 1); uint(p.limits.bytes, FEATURE_LIMITS.bytes, 1);
}
export function validateFeaturePolicy(v: unknown): FeaturePolicy { const p = detachFeatureJSON(v); policy(p); check(Buffer.byteLength(JSON.stringify(p)) <= p.limits.bytes, 'FEATURE_LIMIT'); return p; }
function revision(r: any, p: FeaturePolicy): void {
  obj(r, 'namespace payment_id attempt_id revision_id revision_number account_id occurred_at available_at currency attempt_amount gross_amount reversed_amount lifecycle identity coverage');
  check(r.namespace === p.namespace); for (const k of ['payment_id', 'attempt_id', 'revision_id', 'account_id']) id(r[k]); uint(r.revision_number, Number.MAX_SAFE_INTEGER, 1);
  time(r.occurred_at); time(r.available_at); check(r.available_at >= r.occurred_at); str(r.currency, /^[A-Z]{3}$/); check(p.currencies.includes(r.currency));
  money(r.attempt_amount); money(r.gross_amount); if (r.reversed_amount !== null) money(r.reversed_amount);
  check(['pending', 'failed', 'succeeded', 'partially_reversed', 'reversed', 'unknown'].includes(r.lifecycle)); check(['synthetic_declared', 'unknown'].includes(r.identity) && ['complete', 'unknown'].includes(r.coverage));
  const g = featureMoneyMinor(r.gross_amount), a = featureMoneyMinor(r.attempt_amount), b = r.reversed_amount === null ? null : featureMoneyMinor(r.reversed_amount);
  check(g <= a && (b === null || b <= g));
  if (r.lifecycle === 'pending' || r.lifecycle === 'failed') check(g === 0n && (b === null || b === 0n));
  if (r.lifecycle === 'succeeded' && b !== null) check(b === 0n);
  if (r.lifecycle === 'partially_reversed' && b !== null) check(b > 0n && b < g);
  if (r.lifecycle === 'reversed' && b !== null) check(b === g);
}
export function validateFeatureDelivery(v: unknown, config: unknown): FeatureDelivery { const p = validateFeaturePolicy(config), d = detachFeatureJSON(v, p.limits.bytes); obj(d, 'position revision'); uint(d.position, p.limits.deliveries - 1); revision(d.revision, p); return d; }
export function featureRevisionAvailability(v: unknown, config: unknown): UnavailableReason | null {
  const r = validateFeatureDelivery({ position: 0, revision: v }, config).revision;
  return r.identity === 'unknown' ? 'IDENTITY_UNAVAILABLE' : r.coverage === 'unknown' ? 'COVERAGE_INCOMPLETE' : r.lifecycle === 'unknown' ? 'UNKNOWN_LIFECYCLE' : r.reversed_amount === null ? 'UNKNOWN_REVERSAL' : null;
}
function query(q: any, p: FeaturePolicy): void { obj(q, 'id account_id currency as_of'); id(q.id); id(q.account_id); check(p.currencies.includes(q.currency)); time(q.as_of); }
export function validateFeatureQuery(v: unknown, config: unknown): FeatureQuery { const p = validateFeaturePolicy(config), q = detachFeatureJSON(v, p.limits.bytes); query(q, p); return q; }
export function validateFeatureVector(v: unknown, signed = false): FeatureVector { check(typeof signed === 'boolean'); const x = detachFeatureJSON(v); obj(x, VECTOR_FIELDS.join(' ')); for (const k of VECTOR_FIELDS) str(x[k], signed ? /^(0|-?[1-9][0-9]{0,31})$/ : /^(0|[1-9][0-9]{0,31})$/); return x; }
function snapshot(s: any, p: FeaturePolicy): void {
  obj(s, 'version query watermark result'); check(s.version === FEATURE_CATALOG_VERSION); query(s.query, p); time(s.watermark); check(s.query.as_of <= s.watermark);
  if (s.result?.status === 'available') { obj(s.result, 'status vector'); validateFeatureVector(s.result.vector); }
  else { obj(s.result, 'status reason'); check(s.result.status === 'unavailable' && UNAVAILABLE_REASONS.includes(s.result.reason)); }
}
export function validateFeatureSnapshot(v: unknown, config: unknown): FeatureSnapshot { const p = validateFeaturePolicy(config), s = detachFeatureJSON(v, p.limits.bytes); snapshot(s, p); return s; }
/** Structural recovery envelope only. Consumers MUST recompute snapshots and arithmetic. */
export function validateFeatureState(v: unknown): FeatureState {
  const s = detachFeatureJSON(v); obj(s, 'version policy next_position watermark deliveries snapshots'); policy(s.policy); const p: FeaturePolicy = s.policy;
  check(s.version === FEATURE_CATALOG_VERSION); time(s.watermark); check(s.watermark >= p.watermark); uint(s.next_position, p.limits.deliveries);
  check(Array.isArray(s.deliveries) && s.deliveries.length === s.next_position && s.deliveries.length <= p.limits.deliveries, 'FEATURE_LIMIT');
  const payments = new Set<string>(), attempts = new Set<string>(), revisions = new Map<string, Set<string>>(), keys = new Map<string, number>();
  s.deliveries.forEach((d: any, i: number) => {
    obj(d, 'position revision'); check(d.position === i); revision(d.revision, p); const r: FeatureRevision = d.revision;
    payments.add(r.payment_id); attempts.add(r.attempt_id); const rs = revisions.get(r.payment_id) ?? new Set<string>(); rs.add(r.revision_id); revisions.set(r.payment_id, rs);
    const key = `${r.account_id}/${r.currency}`; keys.set(key, (keys.get(key) ?? 0) + 1);
  });
  check(payments.size <= p.limits.payments && attempts.size <= p.limits.attempts && [...revisions.values()].every(x => x.size <= p.limits.revisions_per_payment) && [...keys.values()].every(n => n <= p.limits.deliveries_per_key), 'FEATURE_LIMIT');
  check(Array.isArray(s.snapshots) && s.snapshots.length <= p.limits.queries, 'FEATURE_LIMIT'); s.snapshots.forEach((x: any) => { snapshot(x, p); check(x.watermark <= s.watermark); }); check(new Set(s.snapshots.map((x: FeatureSnapshot) => x.query.id)).size === s.snapshots.length);
  check(Buffer.byteLength(JSON.stringify(s)) <= p.limits.bytes, 'FEATURE_LIMIT'); return s;
}
export function validateFeatureInput(v: unknown, golden = false): { policy: FeaturePolicy; deliveries: FeatureDelivery[]; queries: FeatureQuery[] } {
  check(typeof golden === 'boolean');
  const x = detachFeatureJSON(v, golden ? FEATURE_LIMITS.golden_bytes : FEATURE_LIMITS.bytes); obj(x, 'policy deliveries queries'); policy(x.policy);
  check(Array.isArray(x.deliveries) && x.deliveries.length <= (golden ? 32 : x.policy.limits.deliveries), 'FEATURE_LIMIT');
  validateFeatureState({ version: FEATURE_CATALOG_VERSION, policy: x.policy, next_position: x.deliveries.length, watermark: x.policy.watermark, deliveries: x.deliveries, snapshots: [] });
  check(Array.isArray(x.queries) && x.queries.length <= x.policy.limits.queries, 'FEATURE_LIMIT'); x.queries.forEach((q: any) => query(q, x.policy)); check(new Set(x.queries.map((q: FeatureQuery) => q.id)).size === x.queries.length);
  check(Buffer.byteLength(JSON.stringify(x)) <= x.policy.limits.bytes, 'FEATURE_LIMIT'); return x;
}
function ordered(v: any): string { return Array.isArray(v) ? `[${v.map(ordered).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${ordered(v[k])}`).join(',')}}` : JSON.stringify(v); }
export function canonicalFeatureJSON(v: unknown): string { return ordered(detachFeatureJSON(v)); }
export function featureGroupedHash(groups: unknown[]): string { return createHash('sha256').update(canonicalFeatureJSON({ domain: FEATURE_CATALOG_VERSION, groups })).digest('hex'); }
export function featurePolicyIdentity(v: unknown): string { return featureGroupedHash([validateFeaturePolicy(v)]); }
export const FEATURE_CATALOG = Object.freeze([
  ...VECTOR_FIELDS.map(name => Object.freeze({ name, version: FEATURE_CATALOG_VERSION, scope: 'local_synthetic', support: 'supported', unit: name.endsWith('count') ? 'integer_count' : 'currency_minor_units', currency: 'separate_policy_bucket', lifecycle: 'latest_available_declared_revision', anchor: 'occurred_at', window: '(as_of-window_seconds,as_of]', provenance: 'synthetic_declared', availability: 'complete_known_evidence_before_arithmetic', freshness: 'policy.freshness_seconds' })),
  ...['counterparty', 'institution', 'baseline', 'graph'].map(name => Object.freeze({ name, version: FEATURE_CATALOG_VERSION, scope: 'local_synthetic', support: 'unsupported', reason: 'UNSUPPORTED_FEATURE' }))
]);
