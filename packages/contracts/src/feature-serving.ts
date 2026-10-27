/** Local synthetic shape contracts. Validators detach inputs, but do not attest
 * reducer arithmetic or caller hashes. Store/serving must restore B06 evidence. */
import { createHash } from 'node:crypto';
import { validateFeatureStreamPlan, validateFeatureStreamState, validateFeatureStreamSnapshot, type FeatureStreamPlan, type FeatureStreamState, type FeatureStreamQuery, type FeatureStreamSnapshot } from './feature-stream.js';
export const FEATURE_SERVING_VERSION = 'synthetic-feature-serving-1' as const;
export const FEATURE_SERVING_LIMITS = Object.freeze({ bytes: 1048576, generations: 1000, ttl_seconds: 86400 });
export class FeatureServingError extends Error {
  readonly code = 'FEATURE_SERVING_INVALID';
  constructor() { super('Invalid synthetic feature serving'); this.name = 'FeatureServingError'; }
}
export interface FeatureServingPolicy { id: string; version: string; max_age_seconds: number }
export interface FeatureStoreScope { version: typeof FEATURE_SERVING_VERSION; mode: 'local_synthetic'; workspace_key: string; plan: FeatureStreamPlan; policy: FeatureServingPolicy }
export interface FeaturePublication { version: typeof FEATURE_SERVING_VERSION; scope: FeatureStoreScope; generation: number; predecessor: { generation: number; content_hash: string } | null; state: FeatureStreamState; published_at: string; expires_at: string; content_hash: string }
export interface FeatureServingRequest { version: typeof FEATURE_SERVING_VERSION; workspace_key: string; plan: FeatureStreamPlan; query: FeatureStreamQuery; currency: string; policy: FeatureServingPolicy; now: string; minimum_generation?: number }
export const FEATURE_UNAVAILABLE_REASONS = ['PUBLICATION_MISSING', 'QUERY_MISSING', 'INPUT_MISSING', 'HISTORY_INCOMPLETE', 'SOURCE_STALE', 'PUBLICATION_EXPIRED', 'FUTURE_EVIDENCE', 'FUTURE_PUBLICATION', 'POLICY_MISMATCH', 'SCOPE_MISMATCH', 'GENERATION_TOO_OLD'] as const;
export type FeatureUnavailableReason = typeof FEATURE_UNAVAILABLE_REASONS[number];
export type FeatureServingResult = { version: typeof FEATURE_SERVING_VERSION; request: FeatureServingRequest } & ({ status: 'available'; reason: null; count: string; amount: string; provenance: { publication: FeaturePublication; snapshot: FeatureStreamSnapshot } } | { status: 'unavailable'; reason: FeatureUnavailableReason; count: null; amount: null; provenance: null });
function check(v: unknown): asserts v { if (!v) throw new FeatureServingError(); }
/** Budget serialized bytes during descriptor-only traversal, before serialization. */
function detach(value: unknown): any {
  let budget: number = FEATURE_SERVING_LIMITS.bytes;
  const active = new Set<object>();
  const spend = (n: number) => { budget -= n; check(budget >= 0); };
  function walk(v: any, depth: number): any {
    check(depth <= 40);
    if (v === null || typeof v === 'boolean') { spend(v === null ? 4 : v ? 4 : 5); return v; }
    if (typeof v === 'string') { check(v.length <= FEATURE_SERVING_LIMITS.bytes && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)); spend(new TextEncoder().encode(JSON.stringify(v)).length); return v; }
    if (typeof v === 'number') { check(Number.isSafeInteger(v) && !Object.is(v, -0)); spend(String(v).length); return v; }
    check(v && typeof v === 'object' && !active.has(v)); const array = Array.isArray(v);
    check(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
    const keys = Reflect.ownKeys(v); check(keys.length <= 2001); active.add(v); spend(2);
    if (array) check(v.length <= 2000 && keys.length === v.length + 1);
    const out: any = array ? [] : {}; let first = true;
    for (const k of keys) {
      check(typeof k === 'string'); if (array && k === 'length') continue;
      check(!['__proto__', 'constructor', 'prototype'].includes(k)); if (array) check(k === String(out.length));
      const d = Object.getOwnPropertyDescriptor(v, k)!; check(d.enumerable && 'value' in d);
      if (!first) spend(1); first = false; if (!array) { walk(k, depth + 1); spend(1); }
      out[k] = walk(d.value, depth + 1);
    }
    active.delete(v); return out;
  }
  return walk(value, 0);
}
function obj(v: any, fields: string, optional: string[] = []): void { check(v && typeof v === 'object' && !Array.isArray(v)); const required = fields.split(' '); check(required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k))); }
const id = (v: any) => check(typeof v === 'string' && /^synthetic_[A-Za-z0-9_]{1,70}$/.test(v) && !v.includes('\n'));
const integer = (v: any, min: number, max: number) => check(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max);
function time(v: any): number { check(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)); const n = Date.parse(v); check(Number.isFinite(n) && new Date(n).toISOString() === v.replace('Z', '.000Z')); return n; }
function canonical(v: any): string { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; return JSON.stringify(v); }
const same = (a: any, b: any) => canonical(a) === canonical(b);
function hash(v: any): void { check(typeof v === 'string' && v.length === 71 && /^[0-9a-f]{8}(?:-[0-9a-f]{8}){7}$/.test(v)); }
function policy(v: any): void { obj(v, 'id version max_age_seconds'); id(v.id); id(v.version); integer(v.max_age_seconds, 0, 86400); }
function scope(v: any): void { obj(v, 'version mode workspace_key plan policy'); check(v.version === FEATURE_SERVING_VERSION && v.mode === 'local_synthetic'); id(v.workspace_key); v.plan = validateFeatureStreamPlan(v.plan); policy(v.policy); }
function request(v: any): void { obj(v, 'version workspace_key plan query currency policy now', ['minimum_generation']); check(v.version === FEATURE_SERVING_VERSION); id(v.workspace_key); v.plan = validateFeatureStreamPlan(v.plan); check(v.plan.queries.some((q: FeatureStreamQuery) => same(q, v.query))); check(v.currency === v.query.currency); policy(v.policy); time(v.now); if (Object.hasOwn(v, 'minimum_generation')) integer(v.minimum_generation, 1, 1000); }
function publication(v: any): void {
  obj(v, 'version scope generation predecessor state published_at expires_at content_hash'); check(v.version === FEATURE_SERVING_VERSION); scope(v.scope); integer(v.generation, 1, 1000); hash(v.content_hash);
  if (v.generation === 1) check(v.predecessor === null);
  else { obj(v.predecessor, 'generation content_hash'); check(v.predecessor.generation === v.generation - 1); hash(v.predecessor.content_hash); }
  v.state = validateFeatureStreamState(v.state, v.scope.plan);
  const published = time(v.published_at), expires = time(v.expires_at); check(expires > published && expires - published <= 86400000);
  for (const s of v.state.snapshots) check(published >= time(s.query.as_of));
}
function validate<T>(v: unknown, fn: (v: any) => void): T { try { const copy = detach(v); fn(copy); return copy; } catch { throw new FeatureServingError(); } }
/** Strict detached full-plan synthetic scope; no real tenancy attestation. */
export const validateFeatureStoreScope = (v: unknown): FeatureStoreScope => validate(v, scope);
/** Explicit fixture-only policy, not production freshness authorization. */
export const validateFeatureServingPolicy = (v: unknown): FeatureServingPolicy => validate(v, policy);
/** First predecessor is null, later exactly n-1. Store must check actual prior
 * hash, increasing generation, history extension and recomputed arithmetic. */
export const validateFeaturePublication = (v: unknown): FeaturePublication => validate(v, publication);
/** Exact query/currency/full-plan identity with explicit supplied UTC now. */
export const validateFeatureServingRequest = (v: unknown): FeatureServingRequest => validate(v, request);
/** SHA-256 of sorted-key canonical JSON excluding only content_hash. Hex is
 * losslessly grouped into eight groups. Caller hashes are never attestations. */
export function featurePublicationContentHash(v: unknown): string { const { content_hash: ignored, ...content } = validateFeaturePublication(v); return createHash('sha256').update(canonical(content)).digest('hex').match(/.{8}/g)!.join('-'); }
/** Canonical full scope identity for subsequent store/adapter bindings. */
export function featureStoreScopeIdentity(v: unknown): string { return canonical(validateFeatureStoreScope(v)); }
/** Unavailable carries null values/provenance. Available retains full publication
 * and snapshot; source age == max is valid, now == expiry is expired. Publication
 * time never refreshes source time. Reason precedence belongs to the server. */
export function validateFeatureServingResult(v: unknown): FeatureServingResult {
  return validate(v, r => {
    obj(r, 'version request status reason count amount provenance'); check(r.version === FEATURE_SERVING_VERSION); request(r.request);
    if (r.status === 'unavailable') { check(FEATURE_UNAVAILABLE_REASONS.includes(r.reason) && r.count === null && r.amount === null && r.provenance === null); return; }
    check(r.status === 'available' && r.reason === null); obj(r.provenance, 'publication snapshot'); const p = r.provenance.publication; publication(p);
    const s = validateFeatureStreamSnapshot(r.provenance.snapshot, p.scope.plan); r.provenance.snapshot = s;
    check(p.state.snapshots.some((x: FeatureStreamSnapshot) => same(x, s)) && s.reason === null && same(s.query, r.request.query));
    check(r.count === s.count && r.amount === s.amount && s.count !== null && s.amount !== null);
    check(r.request.workspace_key === p.scope.workspace_key && same(r.request.plan, p.scope.plan) && same(r.request.policy, p.scope.policy)); check(p.generation >= (r.request.minimum_generation ?? 1));
    const now = time(r.request.now), evidence = time(s.query.as_of);
    check(now >= evidence && now >= time(p.published_at) && now < time(p.expires_at) && now - evidence <= p.scope.policy.max_age_seconds * 1000);
  });
}
