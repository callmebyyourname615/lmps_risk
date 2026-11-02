import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as p from '../dist/feature-parity.js';
const h = 'a'.repeat(64), at = '2026-01-01T01:00:00Z';
const clone = v => structuredClone(v);
function record(overrides = {}) { return { event_id: 'synthetic_event', key: 'synthetic_key', currency: 'USD', revision: 0, source_position: 0, occurred_at: at, available_at: at, availability_sha256: h, record_sha256: h, amount: '12.34', active: true, ...overrides }; }
function fixture(records = [record()]) {
  const input = { version: p.FEATURE_PARITY_VERSION, mode: 'local_synthetic', records };
  const plan = { version: p.FEATURE_PARITY_VERSION, mode: 'local_synthetic', input_sha256: p.featureParityInputHash(input), semantics: { ...p.FEATURE_PARITY_SEMANTICS }, runtime: { python: '3.12.1', typescript: '5.9.1', source_sha256: h, compiled_sha256: h }, fixture: { now: at, retention_seconds: 3600, coverage: 'explicit_cohort_only' }, queries: [{ id: 'synthetic_query', key: 'synthetic_key', currency: 'USD', as_of: at, anchor_at: at, window_seconds: 3600, member_ids: ['synthetic_event'] }] };
  return { input, plan };
}
function obs(f, count = '1', amount = '12.34') { return { query: clone(f.plan.queries[0]), plan_sha256: p.featureParityPlanHash(f.plan), input_sha256: f.plan.input_sha256, cohort_sha256: p.selectFeatureParityCohort(f.plan, f.input, 'synthetic_query').cohort_sha256, semantics: clone(f.plan.semantics), runtime: clone(f.plan.runtime), status: 'available', count, amount }; }
function status(f, a = obs(f), b = a) { return p.compareFeatureParity(f.plan, f.input, [a], [b]).comparisons[0].status; }
function fails(fn, code = 'PARITY_INVALID') { assert.throws(fn, e => e instanceof p.FeatureParityError && e.code === code && e.message === code); }
test('equality eligible; future corrections excluded; arrival order irrelevant; exact window boundaries', () => {
  const f = fixture([record(), record({ revision: 1, source_position: 1, available_at: '2026-01-01T01:00:01Z', amount: '99.00' })]);
  assert.equal(status(f), 'matched_observations');
  assert.equal(p.selectFeatureParityCohort(f.plan, f.input, 'synthetic_query').records[0].revision, 0);
  const reverse = fixture([...f.input.records].reverse());
  assert.equal(p.selectFeatureParityCohort(f.plan, f.input, 'synthetic_query').cohort_sha256, p.selectFeatureParityCohort(reverse.plan, reverse.input, 'synthetic_query').cohort_sha256);
  const start = fixture([record({ occurred_at: '2026-01-01T00:00:00Z' })]);
  assert.equal(status(start, obs(start, '0', '0.00')), 'matched_observations');
  const moved = fixture([record(), record({ revision: 1, source_position: 1, occurred_at: '2026-01-01T00:00:00Z' })]);
  assert.equal(status(moved, obs(moved, '0', '0.00')), 'matched_observations');
});
test('missing availability/member is unavailable; future-only member unavailable; explicit empty cohort valid zero', () => {
  for (const records of [[], [record({ available_at: null, availability_sha256: null })], [record({ available_at: '2026-01-01T01:00:01Z' })]]) {
    const f = fixture(records); assert.equal(status(f), 'unavailable');
  }
  const f = fixture([]); f.plan.queries[0].member_ids = [];
  assert.equal(status(f, obs(f, '0', '0.00')), 'matched_observations');
  const reversed = fixture([record({ active: false })]); assert.equal(status(reversed, obs(reversed, '0', '0.00')), 'matched_observations');
});
test('bindings differ => mismatch; identical forged values/hashes cannot authorize pass', () => {
  const f = fixture();
  for (const mutate of [o => o.query.currency = 'EUR', o => o.query.window_seconds++, o => o.query.anchor_at = '2026-01-01T00:59:59Z', o => o.query.as_of = '2026-01-01T01:00:01Z', o => o.query.member_ids = [], o => o.runtime.python = '3.13.0', o => o.semantics.feature = 'other', o => o.cohort_sha256 = 'b'.repeat(64), o => o.input_sha256 = 'b'.repeat(64), o => o.plan_sha256 = 'b'.repeat(64)]) {
    const o = obs(f); mutate(o); assert.equal(status(f, o), 'mismatch');
  }
  assert.equal(status(f, obs(f, '0', '0.00')), 'mismatch');
  const report = p.compareFeatureParity(f.plan, f.input, [obs(f)], [obs(f)]);
  assert.equal(report.production_ready, false); assert.equal(report.acceptance, 'pending_independent_runtime_verification');
  report.acceptance = 'passed'; fails(() => p.validateFeatureParityReport(report, f.plan, f.input, [obs(f)], [obs(f)]));
  const o = obs(f); o.passed = true; fails(() => status(f, o));
});
test('retrospective/unsupported/unavailable never compare numerically', () => {
  const f = fixture();
  for (const s of ['unavailable', 'retrospective', 'unsupported']) { const o = obs(f); Object.assign(o, { status: s, count: null, amount: null }); assert.equal(status(f, o), s); }
  f.plan.semantics.lifecycle = 'unknown'; assert.equal(status(f), 'unsupported');
});
test('exact record/query/key bounds and one-over', () => {
  const records = Array.from({ length: 2000 }, (_, i) => record({ event_id: `synthetic_e${i}`, key: `synthetic_k${i}`, source_position: i }));
  const f = fixture(records); assert.equal(p.validateFeatureParityInput(f.input).records.length, 2000);
  f.input.records.push(record({ event_id: 'synthetic_over', source_position: 2000 })); fails(() => p.validateFeatureParityInput(f.input), 'PARITY_LIMIT');
  f.plan.queries = Array.from({ length: 8 }, (_, i) => ({ ...f.plan.queries[0], id: `synthetic_q${i}` })); assert.equal(p.validateFeatureParityPlan(f.plan).queries.length, 8);
  f.plan.queries.push({ ...f.plan.queries[0], id: 'synthetic_over' }); fails(() => p.validateFeatureParityPlan(f.plan), 'PARITY_LIMIT');
  const q = fixture(); q.plan.queries[0].member_ids = records.slice(0, 2000).map(r => r.event_id).sort(); p.validateFeatureParityPlan(q.plan);
  q.plan.queries[0].member_ids.push('synthetic_z'); fails(() => p.validateFeatureParityPlan(q.plan), 'PARITY_LIMIT');
});
test('byte threshold exact/one-over before strict schema validation', () => {
  // Unknown padding remains invalid at the exact byte cap; one extra byte is a resource error.
  const v = { padding: '' }; v.padding = 'x'.repeat(p.FEATURE_PARITY_LIMITS.bytes - Buffer.byteLength(JSON.stringify(v)));
  assert.equal(Buffer.byteLength(JSON.stringify(v)), 2097152);
  fails(() => p.validateFeatureParityInput(v)); v.padding += 'x'; fails(() => p.validateFeatureParityInput(v), 'PARITY_LIMIT');
});
test('detached inputs and fixed rejection codes without executing accessors', () => {
  const f = fixture(); const out = p.validateFeatureParityPlan(f.plan); out.queries[0].key = 'synthetic_other'; assert.equal(f.plan.queries[0].key, 'synthetic_key');
  const variants = [Object.create(f.plan), { ...f.plan, [Symbol('x')]: 1 }, new Proxy(f.plan, {}), Object.assign(Object.create(null), f.plan)];
  const accessor = clone(f.plan); Object.defineProperty(accessor, 'mode', { enumerable: true, get() { throw Error('executed'); } }); variants.push(accessor);
  const cycle = clone(f.plan); cycle.queries = cycle; variants.push(cycle);
  for (const v of variants) fails(() => p.validateFeatureParityPlan(v));
  assert.equal(p.featureParityPlanHash(f.plan), createHash('sha256').update(p.serializeFeatureParityPlan(f.plan)).digest('hex'));
});
test('real dates, canonical decimals, safe counters, hashes, identity/currency conflicts', () => {
  for (const change of [{ occurred_at: '2026-02-30T00:00:00Z' }, { amount: '01.00' }, { amount: 1 }, { revision: -0 }, { source_position: Number.MAX_SAFE_INTEGER + 1 }, { available_at: null }, { record_sha256: 'A'.repeat(64) }, { currency: '???' }]) {
    const f = fixture(); Object.assign(f.input.records[0], change); fails(() => p.validateFeatureParityInput(f.input));
  }
  fails(() => p.validateFeatureParityInput({ ...fixture().input, records: [record(), record({ revision: 1, source_position: 1, currency: 'EUR' })] }));
  const f = fixture(); const o = obs(f); o.status = 'unavailable'; fails(() => status(f, o));
});
