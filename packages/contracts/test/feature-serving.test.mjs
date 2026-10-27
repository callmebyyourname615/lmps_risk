import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as c from '../dist/feature-serving.js';
import * as b from '../dist/feature-stream.js';
const golden = JSON.parse(readFileSync(new URL('../../risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
const version = c.FEATURE_SERVING_VERSION;
const hash = Array(8).fill('01234567').join('-');
const plan = () => ({ version: b.FEATURE_STREAM_VERSION, identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: golden.coverage_start, queries: golden.snapshots.map(({ expected, ...q }) => q), limits: { records: 2000, revisions: 2000, snapshots: 8, capture_bytes: 2097152, state_bytes: 1048576 } });
const policy = () => ({ id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 60 });
const scope = () => ({ version, mode: 'local_synthetic', workspace_key: 'synthetic_workspace', plan: plan(), policy: policy() });
const snapshot = () => ({ version: b.FEATURE_STREAM_VERSION, plan_identity: b.featureStreamPlanIdentity(plan()), query: plan().queries[0], namespace: plan().namespace, topic: plan().topic, partition: 0, next_offset: 0, coverage_start: golden.coverage_start, ...golden.snapshots[0].expected });
const shift = (t, n) => new Date(Date.parse(t) + n * 1000).toISOString().replace('.000Z', 'Z');
function publication() { const s = snapshot(); return { version, scope: scope(), generation: 1, predecessor: null, state: { version: b.FEATURE_STREAM_VERSION, plan: plan(), next_offset: 0, deliveries: [], snapshots: [s] }, published_at: s.query.as_of, expires_at: shift(s.query.as_of, 120), content_hash: hash }; }
const request = () => ({ version, workspace_key: 'synthetic_workspace', plan: plan(), query: plan().queries[0], currency: plan().queries[0].currency, policy: policy(), now: shift(plan().queries[0].as_of, 60) });
const result = () => ({ version, request: request(), status: 'available', reason: null, count: snapshot().count, amount: snapshot().amount, provenance: { publication: publication(), snapshot: snapshot() } });
const invalid = fn => assert.throws(fn, e => e instanceof c.FeatureServingError && e.code === 'FEATURE_SERVING_INVALID' && e.message === 'Invalid synthetic feature serving');
test('detached full provenance, canonical hash and caller immutability', () => {
  const p = publication(), before = structuredClone(p); const out = c.validateFeaturePublication(p); out.scope.plan.queries[0].id = 'changed'; assert.deepEqual(p, before);
  assert.deepEqual(c.validateFeatureServingResult(result()), result());
  function canonical(v) { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
  const { content_hash, ...content } = p;
  const expected = createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex').match(/.{8}/g).join('-');
  assert.equal(c.featurePublicationContentHash(p), expected);
  p.content_hash = 'ffffffff-ffffffff-ffffffff-ffffffff-ffffffff-ffffffff-ffffffff-ffffffff'; assert.equal(c.featurePublicationContentHash(p), expected);
  p.scope.workspace_key = 'synthetic_other'; assert.notEqual(c.featurePublicationContentHash(p), expected);
  assert.deepEqual(before, publication());
});
test('generation, predecessor, policy and exact fixture TTL boundaries', () => {
  for (const n of [1, 1000]) { const p = publication(); p.generation = n; p.predecessor = n === 1 ? null : { generation: n - 1, content_hash: hash }; c.validateFeaturePublication(p); }
  for (const n of [0, 1001, '1', -0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) { const p = publication(); p.generation = n; invalid(() => c.validateFeaturePublication(p)); }
  for (const predecessor of [{ generation: 0, content_hash: hash }, {}, undefined]) { const p = publication(); p.predecessor = predecessor; invalid(() => c.validateFeaturePublication(p)); }
  const p = publication(); p.generation = 3; p.predecessor = { generation: 1, content_hash: hash }; invalid(() => c.validateFeaturePublication(p));
  for (const n of [0, 86400]) c.validateFeatureServingPolicy({ ...policy(), max_age_seconds: n });
  for (const n of [-1, 86401, '60', undefined]) invalid(() => c.validateFeatureServingPolicy({ ...policy(), max_age_seconds: n }));
  for (const n of [1, 86400]) c.validateFeaturePublication({ ...publication(), expires_at: shift(publication().published_at, n) });
  for (const n of [0, -1, 86401]) invalid(() => c.validateFeaturePublication({ ...publication(), expires_at: shift(publication().published_at, n) }));
  invalid(() => c.validateFeaturePublication({ ...publication(), published_at: shift(publication().published_at, -1) }));
});
test('freshness uses query time, strict expiry, future clocks and all unavailable reasons', () => {
  for (const seconds of [0, 60]) { const r = result(); r.request.now = shift(r.request.query.as_of, seconds); c.validateFeatureServingResult(r); }
  for (const seconds of [-1, 61, 120]) { const r = result(); r.request.now = shift(r.request.query.as_of, seconds); invalid(() => c.validateFeatureServingResult(r)); }
  const expiry = result(); expiry.provenance.publication.expires_at = expiry.request.now; invalid(() => c.validateFeatureServingResult(expiry));
  const future = result(); future.provenance.publication.published_at = shift(future.request.now, 1); invalid(() => c.validateFeatureServingResult(future));
  const recent = result(); recent.request.now = shift(recent.request.query.as_of, 61); recent.provenance.publication.published_at = recent.request.now; invalid(() => c.validateFeatureServingResult(recent));
  for (const reason of c.FEATURE_UNAVAILABLE_REASONS) { const r = { version, request: request(), status: 'unavailable', reason, count: null, amount: null, provenance: null }; assert.deepEqual(c.validateFeatureServingResult(r), r); for (const change of [{ count: '0' }, { amount: '0.00' }, { provenance: {} }, { reason: 'unknown' }]) invalid(() => c.validateFeatureServingResult({ ...r, ...change })); }
});
test('identity, version, policy, query, money and complete evidence cannot drift', () => {
  for (const change of [r => r.request.workspace_key = 'synthetic_other', r => r.request.plan.input_identity = 'synthetic_other', r => r.request.plan.run_id = 'synthetic_other', r => r.request.plan.namespace = 'synthetic_other', r => r.request.plan.topic = 'synthetic_other', r => r.request.policy.version = 'synthetic_v2', r => r.request.policy.id = 'synthetic_other', r => r.request.policy.max_age_seconds++, r => r.request.currency = 'ZZZ', r => r.request.query.id = 'unknown', r => r.request.minimum_generation = 2, r => r.version = 'unknown', r => r.count = '0', r => r.amount = '01.00', r => r.provenance.snapshot.amount = 1, r => r.provenance.snapshot.query.coverage_complete = false]) { const r = result(); change(r); invalid(() => c.validateFeatureServingResult(r)); }
  const p = publication(); p.scope.plan.queries.push(structuredClone(p.scope.plan.queries[0])); invalid(() => c.validateFeaturePublication(p));
  const s = publication(); s.state.snapshots.push(structuredClone(s.state.snapshots[0])); invalid(() => c.validateFeaturePublication(s));
  for (const n of [1, 1000]) c.validateFeatureServingRequest({ ...request(), minimum_generation: n });
  for (const n of [0, 1001, undefined]) invalid(() => c.validateFeatureServingRequest({ ...request(), minimum_generation: n }));
});
test('malformed JSON objects, encoding, real calendar times and unknown fields fail safely', () => {
  for (const value of [undefined, Symbol(), 1n, new Date(), Object.create(null), { ...scope(), extra: undefined }, { ...scope(), workspace_key: 'synthetic_\ud800' }]) invalid(() => c.validateFeatureStoreScope(value));
  let invoked = false; const getter = scope(); Object.defineProperty(getter, 'workspace_key', { enumerable: true, get() { invoked = true; return 'synthetic_x'; } }); invalid(() => c.validateFeatureStoreScope(getter)); assert.equal(invoked, false);
  const cycle = scope(); cycle.extra = cycle; invalid(() => c.validateFeatureStoreScope(cycle));
  const symbol = scope(); symbol[Symbol()] = 1; invalid(() => c.validateFeatureStoreScope(symbol));
  const proto = scope(); Object.defineProperty(proto, '__proto__', { value: {}, enumerable: true }); invalid(() => c.validateFeatureStoreScope(proto));
  const sparse = scope(); sparse.plan.queries = Array(1); invalid(() => c.validateFeatureStoreScope(sparse));
  for (const now of ['2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:60Z']) invalid(() => c.validateFeatureServingRequest({ ...request(), now }));
  c.validateFeatureServingRequest({ ...request(), now: '2024-02-29T00:00:00Z' });
});
test('bounded records, snapshots, and encoded publications reject one over without mutation', () => {
  const p = publication(); p.state.snapshots = [];
  p.state.deliveries = Array.from({ length: 2000 }, (_, offset) => ({ identity: 'synthetic_declared', topic: plan().topic, partition: 0, offset, event: structuredClone(golden.events[0]) })); p.state.next_offset = 2000;
  c.validateFeaturePublication(p); p.state.next_offset++; p.state.deliveries.push({ ...p.state.deliveries[0], offset: 2000 }); invalid(() => c.validateFeaturePublication(p));
  const s = scope(); s.plan.queries = Array.from({ length: 8 }, (_, i) => ({ ...s.plan.queries[0], id: `q${i}` })); c.validateFeatureStoreScope(s); s.plan.queries.push({ ...s.plan.queries[0], id: 'q8' }); invalid(() => c.validateFeatureStoreScope(s));
  const huge = publication(); huge.content_hash = 'x'.repeat(1048576); const before = structuredClone(huge); invalid(() => c.validateFeaturePublication(huge)); assert.deepEqual(huge, before);
});
test('exact 1MiB encoded publication accepted, one extra byte rejected', () => {
  const p = publication(); p.state.snapshots = [];
  p.state.deliveries = Array.from({ length: 2000 }, (_, offset) => ({ identity: 'synthetic_declared', topic: plan().topic, partition: 0, offset, event: { ...structuredClone(golden.events[0]), transaction_id: `synthetic_t${offset}`, sender: 'synthetic_s', receiver: 'synthetic_r' } })); p.state.next_offset = 2000;
  let remaining = 1048576 - Buffer.byteLength(JSON.stringify(p));
  assert.ok(remaining > 0);
  for (const d of p.state.deliveries) for (const key of ['transaction_id', 'sender', 'receiver']) {
    const add = Math.min(remaining, 80 - d.event[key].length); d.event[key] += 'x'.repeat(add); remaining -= add;
  }
  assert.equal(remaining, 0); assert.equal(Buffer.byteLength(JSON.stringify(p)), 1048576);
  c.validateFeaturePublication(p);
  const last = p.state.deliveries.at(-1).event; assert.ok(last.receiver.length < 80); last.receiver += 'x';
  assert.equal(Buffer.byteLength(JSON.stringify(p)), 1048577); invalid(() => c.validateFeaturePublication(p));
});
