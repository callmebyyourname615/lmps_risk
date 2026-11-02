import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFeatureHealth as evaluate } from '../dist/feature-health.js';
import { FEATURE_PARITY_VERSION as version, FEATURE_PARITY_SEMANTICS as semantics, featureParityPlanHash } from '@lmps/contracts/feature-parity';
const now = '2026-01-01T12:00:00Z';
function fixture(n = 1) {
  const plan = { version, mode: 'local_synthetic', input_sha256: 'a'.repeat(64), semantics, runtime: { python: '3.12', typescript: '5.9', source_sha256: 'b'.repeat(64), compiled_sha256: 'c'.repeat(64) }, fixture: { now, retention_seconds: 3600, coverage: 'explicit_cohort_only' }, queries: Array.from({ length: n }, (_, i) => ({ id: 'synthetic_q' + i, key: 'synthetic_key', currency: 'USD', as_of: now, anchor_at: now, window_seconds: 3600, member_ids: [] })) };
  return { plan, now, max_age_seconds: 60, sources: plan.queries.map(() => ({ status: 'available', as_of: '2026-01-01T11:59:00Z', available_at: now, source_position: 5, consumed_position: 5, plan_sha256: featureParityPlanHash(plan) })) };
}
test('independent age equality, lag and age one-over, immutable detached counts', () => {
  const x = fixture(), before = structuredClone(x), r = evaluate(x);
  assert.equal(r.status, 'available'); assert.equal(r.max_age_seconds, 60); assert.equal(r.position_lag, 0);
  assert.deepEqual(x, before); assert(Object.isFrozen(r.statuses)); assert.throws(() => { r.statuses.available = 9; });
  x.sources[0].as_of = '2026-01-01T11:58:59Z'; x.sources[0].consumed_position = 2;
  const bad = evaluate(x); assert.equal(bad.stale, 1); assert.equal(bad.position_lag, 3); assert.equal(bad.lagging, 1); assert.equal(bad.status, 'unavailable');
});
test('future, missing, negative and incompatible evidence are unknown, never healthy', () => {
  const incompatible = fixture(); incompatible.plan.semantics = { ...semantics, semantic: 'unsupported-1' }; incompatible.sources[0].plan_sha256 = featureParityPlanHash(incompatible.plan); assert.equal(evaluate(incompatible).unknown, 1);
  for (const change of [{ as_of: '2026-01-01T12:00:01Z' }, { available_at: '2026-01-01T12:00:01Z' }, { available_at: null }, { as_of: null }, { source_position: -1 }, { consumed_position: 6 }, { source_position: null }, { plan_sha256: 'f'.repeat(64) }]) {
    const x = fixture(); Object.assign(x.sources[0], change); const r = evaluate(x); assert.equal(r.unknown, 1); assert.equal(r.position_lag, null); assert.equal(r.max_age_seconds, null); assert.equal(r.status, 'unavailable');
  }
});
test('bounded status aggregation and partial versus valid zero', () => {
  const x = fixture(5); ['available', 'partial', 'unavailable', 'retrospective', 'unsupported'].forEach((s, i) => x.sources[i].status = s);
  const r = evaluate(x); assert.deepEqual(r.statuses, { available: 1, partial: 1, unavailable: 1, retrospective: 1, unsupported: 1 }); assert.equal(r.unavailable, 4);
  const zero = fixture(); zero.sources[0].source_position = zero.sources[0].consumed_position = 0; assert.equal(evaluate(zero).status, 'available');
  assert.equal(evaluate(fixture(8)).total, 8); assert.throws(() => evaluate(fixture(9)));
  zero.sources.push(zero.sources[0]); assert.throws(() => evaluate(zero));
});
test('hostile input, invalid dates, undeclared dimensions and implicit clocks rejected', () => {
  const x = fixture(); Object.defineProperty(x.sources[0], 'as_of', { get() { throw Error('getter invoked'); }, enumerable: true }); assert.throws(() => evaluate(x));
  for (const change of [{ now: '2026-02-30T12:00:00Z' }, { max_age_seconds: -1 }, { label: 'private' }]) assert.throws(() => evaluate({ ...fixture(), ...change }));
});
