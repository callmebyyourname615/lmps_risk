import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as c from '../dist/feature-stream.js';

const golden = JSON.parse(readFileSync(new URL('../../risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
const plan = () => ({ version: c.FEATURE_STREAM_VERSION, identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: golden.coverage_start, queries: golden.snapshots.map(({ expected, ...q }) => q), limits: { records: 2000, revisions: 2000, snapshots: 8, capture_bytes: 2097152, state_bytes: 1048576 } });
const delivery = (i = 0) => ({ identity: 'synthetic_declared', topic: plan().topic, partition: 0, offset: i, event: structuredClone(golden.events[i % golden.events.length]) });
const state = () => ({ version: c.FEATURE_STREAM_VERSION, plan: plan(), next_offset: golden.events.length, deliveries: golden.events.map((_, i) => delivery(i)), snapshots: [] });
const snapshot = (i = 0) => ({ version: c.FEATURE_STREAM_VERSION, plan_identity: c.featureStreamPlanIdentity(plan()), query: plan().queries[i], namespace: plan().namespace, topic: plan().topic, partition: 0, next_offset: golden.events.length, coverage_start: golden.coverage_start, ...golden.snapshots[i].expected });
const invalid = fn => assert.throws(fn, e => e instanceof c.FeatureStreamError && e.code === 'FEATURE_STREAM_INVALID' && e.message === 'Invalid synthetic feature stream');

test('unchanged golden shapes and all explicit unavailable metadata survive detached validation', () => {
  assert.deepEqual(c.validateFeatureStreamPlan(plan()), plan());
  for (let i = 0; i < golden.events.length; i++) assert.deepEqual(c.validateFeatureStreamDelivery(delivery(i), plan()), delivery(i));
  for (let i = 0; i < golden.snapshots.length; i++) assert.deepEqual(c.validateFeatureStreamSnapshot(snapshot(i), plan()), snapshot(i));
  const s = state(); s.snapshots = golden.snapshots.map((_, i) => snapshot(i));
  const restored = c.validateFeatureStreamState(s, plan()); restored.deliveries[0].event.amount = '0.00';
  assert.equal(s.deliveries[0].event.amount, '10.02');
});
test('strict money, calendar, identity, lifecycle, integer and unknown-field rejection', () => {
  for (const [key, values] of Object.entries({ amount: ['01.00', '-1.00', '1', '1.0', '1e2', 1, '1.000', '9'.repeat(23) + '.00'], occurred_at: ['2026-02-30T12:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T12:00:00+00:00', '2026-01-01T12:00:00.000Z'], sender: ['real_account', 'synthetic_a:b', 'synthetic_\ud800'], revision_number: [0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1], status: ['unknown'] })) {
    for (const value of values) { const d = delivery(); d.event[key] = value; invalid(() => c.validateFeatureStreamDelivery(d, plan())); }
  }
  for (const change of [{ partition: 1 }, { offset: -0 }, { offset: '0' }, { offset: 2000 }, { topic: 'real' }, { provenance: 'real' }, { identity: 'real' }]) invalid(() => c.validateFeatureStreamDelivery({ ...delivery(), ...change }, plan()));
  for (const [status, reversed_amount] of [['succeeded', '0.01'], ['reversed', '0.00'], ['partially_reversed', '0.00'], ['partially_reversed', '10.02'], ['reversed', '10.03']]) {
    const d = delivery(); Object.assign(d.event, { status, reversed_amount }); invalid(() => c.validateFeatureStreamDelivery(d, plan()));
  }
  const leap = delivery(); leap.event.occurred_at = '2024-02-29T00:00:00Z'; c.validateFeatureStreamDelivery(leap, plan());
});
test('reject lossy JSON, accessors, sparse arrays, cycles and ambiguous object keys', () => {
  for (const value of [undefined, 1n, Symbol(), new Date(), Object.create(null)]) invalid(() => c.validateFeatureStreamPlan(value));
  const p = plan(); p.extra = undefined; invalid(() => c.validateFeatureStreamPlan(p));
  const getter = plan(); Object.defineProperty(getter, 'run_id', { enumerable: true, get() { throw Error('must not execute'); } }); invalid(() => c.validateFeatureStreamPlan(getter));
  const cycle = plan(); cycle.extra = cycle; invalid(() => c.validateFeatureStreamPlan(cycle));
  const sparse = plan(); sparse.queries = Array(1); invalid(() => c.validateFeatureStreamPlan(sparse));
  const proto = plan(); Object.defineProperty(proto, '__proto__', { value: {}, enumerable: true }); invalid(() => c.validateFeatureStreamPlan(proto));
});
test('exact and one-over finite plan, records, revisions, query and byte bounds', () => {
  for (const [key, max] of Object.entries({ records: 2000, revisions: 2000, snapshots: 8, capture_bytes: 2097152, state_bytes: 1048576 })) {
    const p = plan(); p.limits[key] = max; c.validateFeatureStreamPlan(p); p.limits[key]++; invalid(() => c.validateFeatureStreamPlan(p));
  }
  const p = plan(); p.queries = Array.from({ length: 8 }, (_, i) => ({ ...p.queries[0], id: `q${i}` })); c.validateFeatureStreamPlan(p);
  p.queries.push({ ...p.queries[0], id: 'q8' }); invalid(() => c.validateFeatureStreamPlan(p));
  const full = state(); full.deliveries = Array.from({ length: 2000 }, (_, i) => ({ ...delivery(), offset: i })); full.next_offset = 2000;
  c.validateFeatureStreamState(full, plan()); full.deliveries.push({ ...delivery(), offset: 2000 }); full.next_offset++; invalid(() => c.validateFeatureStreamState(full, plan()));
  const d = delivery(), b = Buffer.byteLength(JSON.stringify(d)), bounded = plan(); bounded.limits.capture_bytes = b;
  c.validateFeatureStreamDelivery(d, bounded); bounded.limits.capture_bytes--; invalid(() => c.validateFeatureStreamDelivery(d, bounded));
  const revisions = state(); revisions.plan.limits.revisions = 1; invalid(() => c.validateFeatureStreamState(revisions, revisions.plan));
  const bundle = { plan: plan(), deliveries: Array.from({ length: 32 }, (_, i) => ({ ...delivery(), offset: i })) };
  c.validateFeatureStreamGoldenInput(bundle); bundle.deliveries.push({ ...delivery(), offset: 32 }); invalid(() => c.validateFeatureStreamGoldenInput(bundle));
  const exact = state();
  // Changing the limit changes its own decimal encoding; converge before checking.
  for (let i = 0; i < 4; i++) exact.plan.limits.state_bytes = Buffer.byteLength(JSON.stringify(exact));
  c.validateFeatureStreamState(exact, exact.plan);
  exact.plan.limits.state_bytes--; invalid(() => c.validateFeatureStreamState(exact, exact.plan));
});
test('state identity, contiguous history, conflicts and frozen evidence consistency', () => {
  const original = state(); c.validateFeatureStreamState(original, plan());
  for (const mutate of [s => s.next_offset++, s => s.deliveries[1].offset++, s => s.deliveries[10].event.amount = '0.02', s => s.plan.input_identity = 'synthetic_changed', s => s.version = 'unknown', s => s.success = true]) {
    const s = state(); mutate(s); invalid(() => c.validateFeatureStreamState(s, plan()));
  }
  const reordered = state(); [reordered.deliveries[9].event, reordered.deliveries[17].event] = [reordered.deliveries[17].event, reordered.deliveries[9].event]; c.validateFeatureStreamState(reordered, plan());
  const frozen = state(); frozen.snapshots = [snapshot(), snapshot()]; invalid(() => c.validateFeatureStreamState(frozen, plan()));
  for (const mutate of [s => s.amount = null, s => s.reason = 'HISTORY_INCOMPLETE', s => s.next_offset = 2001, s => s.query.as_of = '2026-01-02T00:00:00Z', s => s.window_start = s.window_end, s => s.production_ready = true]) {
    const s = snapshot(); mutate(s); invalid(() => c.validateFeatureStreamSnapshot(s, plan()));
  }
  const missing = snapshot(2); missing.count = '0'; invalid(() => c.validateFeatureStreamSnapshot(missing, plan()));
  const a = plan(), b = Object.fromEntries(Object.entries(a).reverse()); assert.equal(c.featureStreamPlanIdentity(a), c.featureStreamPlanIdentity(b));
  b.input_identity = 'synthetic_other'; assert.notEqual(c.featureStreamPlanIdentity(a), c.featureStreamPlanIdentity(b));
});
