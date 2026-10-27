import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { serveFeatureSnapshot as serve, initializeFeatureStream as init, applyFeatureStreamDelivery as apply, materializeFeatureStreamSnapshot as freeze } from '../dist/index.js';
import { featurePublicationContentHash as hash, validateFeatureServingResult } from '@lmps/contracts/feature-serving';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/feature-streams/golden.json', import.meta.url)));
const version = 'synthetic-feature-serving-1';
const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start, queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
const scope = { version, mode: 'local_synthetic', workspace_key: 'synthetic_workspace', plan, policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 120 } };
const seal = p => ({ ...p, content_hash: hash(p) });
function publication(events = corpus.events) {
  let state = init(plan);
  events.forEach((event, offset) => { state = apply(state, { identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset, event }); });
  for (const q of plan.queries) state = freeze(state, q.id).state;
  return seal({ version, scope, generation: 1, predecessor: null, state, published_at: '2026-01-01T12:01:00Z', expires_at: '2026-01-01T13:00:00Z', content_hash: Array(8).fill('00000000').join('-') });
}
const request = (i = 0) => ({ version, workspace_key: scope.workspace_key, plan, query: plan.queries[i], currency: plan.queries[i].currency, policy: scope.policy, now: '2026-01-01T12:02:00Z' });
function unavailable(p, s, r, reason) {
  const result = serve(p, s, r);
  assert.deepEqual(result, { version, request: r, status: 'unavailable', reason, count: null, amount: null, provenance: null });
  validateFeatureServingResult(result);
}
const invalid = fn => assert.throws(fn, e => e.code === 'FEATURE_SERVING_INVALID');

test('fixed golden totals, historical queries, currency and complete provenance', () => {
  const p = publication();
  const fixed = [['11', '14.11'], ['11', '13.14'], [null, null], [null, null], ['11', '13.14'], ['1', '7.00']];
  for (let i = 0; i < 6; i++) {
    const r = serve(p, scope, request(i));
    assert.deepEqual([r.count, r.amount], fixed[i]);
    validateFeatureServingResult(r);
    if (r.status === 'available') assert.deepEqual(r.provenance, { publication: p, snapshot: p.state.snapshots[i] });
    else assert.equal(r.reason, i === 2 ? 'INPUT_MISSING' : 'HISTORY_INCOMPLETE');
  }
});

test('absence, age equality/one-over, expiry equality and future clocks', () => {
  const p = publication(), r = request();
  unavailable(null, scope, r, 'PUBLICATION_MISSING');
  unavailable(seal({ ...p, state: { ...p.state, snapshots: [] } }), scope, r, 'QUERY_MISSING');
  assert.equal(serve(p, scope, r).status, 'available');
  unavailable(p, scope, { ...r, now: '2026-01-01T12:02:01Z' }, 'SOURCE_STALE');
  unavailable(p, scope, { ...r, now: p.expires_at }, 'PUBLICATION_EXPIRED');
  unavailable(p, scope, { ...r, now: '2026-01-01T12:00:59Z' }, 'FUTURE_PUBLICATION');
  unavailable(seal({ ...p, published_at: '2026-01-01T12:59:00Z' }), scope, { ...r, now: '2026-01-01T12:59:00Z' }, 'SOURCE_STALE');
  const empty = seal({ ...p, state: init(plan), published_at: '2026-01-01T11:59:00Z' });
  unavailable(empty, scope, { ...r, now: '2026-01-01T11:59:30Z' }, 'FUTURE_EVIDENCE');
});

test('exact scope/policy and bounded generation fences', () => {
  const p = publication(), r = request();
  unavailable(p, scope, { ...r, workspace_key: 'synthetic_other' }, 'SCOPE_MISMATCH');
  unavailable(seal({ ...p, scope: { ...scope, workspace_key: 'synthetic_other' } }), scope, r, 'SCOPE_MISMATCH');
  for (const field of ['id', 'version', 'max_age_seconds']) {
    const policy = { ...r.policy, [field]: field === 'max_age_seconds' ? 121 : 'synthetic_other' };
    unavailable(p, scope, { ...r, policy }, 'POLICY_MISMATCH');
    unavailable(seal({ ...p, scope: { ...scope, policy } }), scope, r, 'POLICY_MISMATCH');
  }
  for (const changed of [{ input_identity: 'synthetic_other' }, { queries: plan.queries.map((q, i) => i ? q : { ...q, as_of: '2026-01-01T12:00:01Z' }) }, { namespace: 'synthetic_other', topic: 'synthetic_other.synthetic_run' }]) {
    const other = { ...plan, ...changed };
    unavailable(p, scope, { ...r, plan: other, query: other.queries[0] }, 'SCOPE_MISMATCH');
  }
  unavailable(p, scope, { ...r, minimum_generation: 2 }, 'GENERATION_TOO_OLD');
  const last = seal({ ...p, generation: 1000, predecessor: { generation: 999, content_hash: p.content_hash } });
  assert.equal(serve(last, scope, { ...r, minimum_generation: 1000 }).status, 'available');
  invalid(() => serve(last, scope, { ...r, minimum_generation: 1001 }));
  invalid(() => serve({ ...last, generation: 1001 }, scope, r));
});

test('valid zero and input/output detachment', () => {
  const p = publication(corpus.events.map(e => ({ ...e, status: 'failed', reversed_amount: '0.00' })));
  const r = request(), before = JSON.stringify([p, scope, r]);
  const result = serve(p, scope, r);
  assert.deepEqual([result.status, result.count, result.amount], ['available', '0', '0.00']);
  assert.equal(JSON.stringify([p, scope, r]), before);
  result.provenance.publication.state.deliveries[0].event.amount = '99.00';
  result.request.policy.version = 'synthetic_changed';
  assert.equal(JSON.stringify([p, scope, r]), before);
  unavailable(p, scope, request(2), 'INPUT_MISSING');
});

test('malformed inputs, hashes and independently rehashed arithmetic fail closed', () => {
  const p = publication(), r = request();
  invalid(() => serve({ ...p, content_hash: Array(8).fill('00000000').join('-') }, scope, r));
  for (const mutate of [x => x.state.snapshots[0].amount = '0.00', x => x.state.snapshots[0].count = '0', x => x.state.snapshots[0].next_offset = 1, x => x.state.deliveries[0].event.amount = '99.00']) {
    const changed = structuredClone(p); mutate(changed);
    invalid(() => serve(changed, scope, r));
    invalid(() => serve(seal(changed), scope, r));
  }
  for (const input of [{ ...r, version: 'unknown' }, { ...r, now: '2026-02-30T12:00:00Z' }, { ...r, currency: 'ALT' }, { ...r, query: { ...r.query, id: 'unknown' } }, { ...r, extra: true }]) invalid(() => serve(p, scope, input));
  invalid(() => serve(p, scope, Object.defineProperty({ ...r }, 'now', { get() { assert.fail('accessor invoked'); }, enumerable: true })));
  invalid(() => serve(undefined, scope, r));
});
