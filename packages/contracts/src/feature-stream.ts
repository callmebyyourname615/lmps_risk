/** Inert synthetic P04 contracts. Validators detach JSON inputs; they do not attest
 * arithmetic or hashes. The durable store must recompute both before trusting state.
 * Full positioned history retains lower/future revisions and replay evidence. */
export const FEATURE_STREAM_VERSION = 'synthetic-feature-stream-1' as const;
export const FEATURE_STREAM_LIMITS = Object.freeze({ golden_deliveries: 32, snapshots: 8, golden_bytes: 32768, records: 2000, capture_bytes: 2097152, state_bytes: 1048576 });
export class FeatureStreamError extends Error {
  readonly code = 'FEATURE_STREAM_INVALID' as const;
  constructor() { super('Invalid synthetic feature stream'); this.name = 'FeatureStreamError'; }
}
export interface FeatureStreamEvent {
  namespace: string; transaction_id: string; revision_number: number; sender: string; receiver: string;
  occurred_at: string; available_at: string; currency: string; amount: string; reversed_amount: string;
  status: 'succeeded' | 'partially_reversed' | 'reversed' | 'pending' | 'failed';
}
export interface FeatureStreamDelivery { identity: 'synthetic_declared'; topic: string; partition: 0; offset: number; event: FeatureStreamEvent }
export interface FeatureStreamQuery { id: string; target: string; as_of: string; currency: string; evidence: 'available' | 'missing'; coverage_complete: boolean; flags_available: boolean }
export interface FeatureStreamPlan {
  version: typeof FEATURE_STREAM_VERSION; identity: 'synthetic_declared'; run_id: string; input_identity: string;
  namespace: string; topic: string; window_seconds: 3600; coverage_start: string; queries: FeatureStreamQuery[];
  limits: { records: number; revisions: number; snapshots: number; capture_bytes: number; state_bytes: number };
}
export interface FeatureStreamSnapshot {
  version: typeof FEATURE_STREAM_VERSION; plan_identity: string; query: FeatureStreamQuery;
  namespace: string; topic: string; partition: 0; next_offset: number; coverage_start: string;
  window_start: string; window_end: string; count: string | null; amount: string | null;
  reason: 'INPUT_MISSING' | 'HISTORY_INCOMPLETE' | null;
}
export interface FeatureStreamState { version: typeof FEATURE_STREAM_VERSION; plan: FeatureStreamPlan; next_offset: number; deliveries: FeatureStreamDelivery[]; snapshots: FeatureStreamSnapshot[] }
function check(v: unknown): asserts v { if (!v) throw new FeatureStreamError(); }
const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
function clone(v: unknown, max: number): any {
  const seen = new Set<object>();
  function visit(x: any, depth: number): void {
    check(depth <= 32);
    if (x === null || typeof x === 'boolean') return;
    if (typeof x === 'string') { check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x)); return; }
    if (typeof x === 'number') { check(Number.isSafeInteger(x) && !Object.is(x, -0)); return; }
    check(typeof x === 'object' && !seen.has(x)); seen.add(x);
    check(Object.getPrototypeOf(x) === (Array.isArray(x) ? Array.prototype : Object.prototype));
    const keys = Reflect.ownKeys(x);
    if (Array.isArray(x)) check(x.length <= 2000 && keys.length === x.length + 1);
    for (const k of keys) {
      check(typeof k === 'string'); if (Array.isArray(x) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(x, k)!; check(d.enumerable && 'value' in d); visit(d.value, depth + 1);
    }
    seen.delete(x);
  }
  visit(v, 0); check(bytes(v) <= max); return JSON.parse(JSON.stringify(v));
}
function obj(v: any, fields: string): any {
  const keys = fields.split(' '); check(v && typeof v === 'object' && !Array.isArray(v));
  check(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))); return v;
}
const text = (v: any, re: RegExp): void => { check(typeof v === 'string' && re.test(v)); };
const id = (v: any): void => text(v, /^synthetic_[A-Za-z0-9_]{1,70}$/);
const integer = (v: any, min: number, max: number): void => { check(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max); };
function time(v: any): void {
  text(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const d = new Date(v); check(Number.isFinite(d.getTime()) && d.toISOString() === v.replace('Z', '.000Z'));
}
const money = (v: any): void => text(v, /^(0|[1-9][0-9]{0,21})\.[0-9]{2}$/);
const cents = (v: string): bigint => BigInt(v.replace('.', ''));
function query(q: any): void {
  obj(q, 'id target as_of currency evidence coverage_complete flags_available'); text(q.id, /^[A-Za-z0-9_]{1,80}$/);
  id(q.target); time(q.as_of); text(q.currency, /^[A-Z]{3}$/);
  check(['available', 'missing'].includes(q.evidence) && typeof q.coverage_complete === 'boolean' && typeof q.flags_available === 'boolean');
}
function plan(p: any): void {
  obj(p, 'version identity run_id input_identity namespace topic window_seconds coverage_start queries limits');
  check(p.version === FEATURE_STREAM_VERSION && p.identity === 'synthetic_declared' && p.window_seconds === 3600);
  id(p.run_id); id(p.input_identity); id(p.namespace); check(p.topic === `${p.namespace}.${p.run_id}`); time(p.coverage_start);
  const l = obj(p.limits, 'records revisions snapshots capture_bytes state_bytes');
  integer(l.records, 1, 2000); integer(l.revisions, 1, l.records); integer(l.snapshots, 1, 8);
  integer(l.capture_bytes, 1, 2097152); integer(l.state_bytes, 1, 1048576);
  check(Array.isArray(p.queries) && p.queries.length > 0 && p.queries.length <= l.snapshots);
  p.queries.forEach(query); check(new Set(p.queries.map((q: FeatureStreamQuery) => q.id)).size === p.queries.length);
}
/** Validates and returns detached JSON. IDs are explicit invented declarations only. */
export function validateFeatureStreamPlan(v: unknown): FeatureStreamPlan { const p = clone(v, 32768); plan(p); return p; }
function canonical(v: any): any { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
/** Lossless canonical configuration binding, not a caller-supplied hash or success flag. */
export function featureStreamPlanIdentity(v: unknown): string { return JSON.stringify(canonical(validateFeatureStreamPlan(v))); }
function delivery(d: any, p: FeatureStreamPlan): void {
  obj(d, 'identity topic partition offset event'); check(d.identity === 'synthetic_declared' && d.topic === p.topic && d.partition === 0); integer(d.offset, 0, p.limits.records - 1);
  const e = obj(d.event, 'namespace transaction_id revision_number sender receiver occurred_at available_at currency amount reversed_amount status');
  check(e.namespace === p.namespace); id(e.transaction_id); id(e.sender); id(e.receiver); integer(e.revision_number, 1, Number.MAX_SAFE_INTEGER);
  time(e.occurred_at); time(e.available_at); text(e.currency, /^[A-Z]{3}$/); money(e.amount); money(e.reversed_amount);
  const a = cents(e.amount), r = cents(e.reversed_amount); check(r <= a);
  check(['succeeded', 'partially_reversed', 'reversed', 'pending', 'failed'].includes(e.status));
  check(e.status === 'partially_reversed' ? r > 0n && r < a : e.status === 'reversed' ? r === a : r === 0n);
}
export function validateFeatureStreamDelivery(v: unknown, config: unknown): FeatureStreamDelivery {
  const p = validateFeatureStreamPlan(config), d = clone(v, p.limits.capture_bytes); delivery(d, p); return d;
}
/** Optional golden-run admission gate. Bounds apply to the complete encoded bundle,
 * including supplied queries in the plan; never truncates oversized fixture input. */
export function validateFeatureStreamGoldenInput(v: unknown): { plan: FeatureStreamPlan; deliveries: FeatureStreamDelivery[] } {
  const input = obj(clone(v, FEATURE_STREAM_LIMITS.golden_bytes), 'plan deliveries');
  plan(input.plan); check(Array.isArray(input.deliveries) && input.deliveries.length <= FEATURE_STREAM_LIMITS.golden_deliveries);
  input.deliveries.forEach((d: FeatureStreamDelivery, i: number) => { delivery(d, input.plan); check(d.offset === i); });
  return input;
}
function snapshot(s: any, p: FeatureStreamPlan): void {
  obj(s, 'version plan_identity query namespace topic partition next_offset coverage_start window_start window_end count amount reason');
  check(s.version === FEATURE_STREAM_VERSION && s.plan_identity === featureStreamPlanIdentity(p)); query(s.query);
  check(p.queries.some(q => JSON.stringify(canonical(q)) === JSON.stringify(canonical(s.query))));
  check(s.namespace === p.namespace && s.topic === p.topic && s.partition === 0 && s.coverage_start === p.coverage_start);
  integer(s.next_offset, 0, p.limits.records); time(s.window_start); time(s.window_end);
  check(Date.parse(s.window_end) - Date.parse(s.window_start) === 3600000);
  const reason = s.query.evidence === 'missing' ? 'INPUT_MISSING' : !s.query.coverage_complete || Date.parse(p.coverage_start) > Date.parse(s.window_start) ? 'HISTORY_INCOMPLETE' : null;
  check(s.reason === reason);
  if (reason) check(s.count === null && s.amount === null);
  else { text(s.count, /^(0|[1-9][0-9]{0,3})$/); check(BigInt(s.count) <= BigInt(p.limits.revisions)); text(s.amount, /^(0|[1-9][0-9]{0,25})\.[0-9]{2}$/); }
}
export function validateFeatureStreamSnapshot(v: unknown, config: unknown): FeatureStreamSnapshot {
  const p = validateFeatureStreamPlan(config), s = clone(v, p.limits.state_bytes); snapshot(s, p); return s;
}
/** Retains contiguous source history and immutable-by-copy frozen evidence. Arithmetic
 * validation remains the reducer/store's responsibility; no trusted success/hash input. */
export function validateFeatureStreamState(v: unknown, config: unknown): FeatureStreamState {
  const p = validateFeatureStreamPlan(config), s = obj(clone(v, p.limits.state_bytes), 'version plan next_offset deliveries snapshots');
  check(s.version === FEATURE_STREAM_VERSION && featureStreamPlanIdentity(s.plan) === featureStreamPlanIdentity(p));
  integer(s.next_offset, 0, p.limits.records); check(Array.isArray(s.deliveries) && s.deliveries.length === s.next_offset);
  check(bytes(s.deliveries) <= p.limits.capture_bytes);
  const revisions = new Map<string, string>();
  s.deliveries.forEach((d: FeatureStreamDelivery, i: number) => {
    delivery(d, p); check(d.offset === i);
    const key = JSON.stringify([d.event.namespace, d.event.transaction_id, d.event.revision_number]);
    const content = JSON.stringify(canonical(d.event)); check(!revisions.has(key) || revisions.get(key) === content); revisions.set(key, content);
  });
  check(revisions.size <= p.limits.revisions); check(Array.isArray(s.snapshots) && s.snapshots.length <= p.limits.snapshots);
  const ids = new Set<string>(); s.snapshots.forEach((f: FeatureStreamSnapshot) => { snapshot(f, p); check(f.next_offset <= s.next_offset && !ids.has(f.query.id)); ids.add(f.query.id); });
  return s;
}
