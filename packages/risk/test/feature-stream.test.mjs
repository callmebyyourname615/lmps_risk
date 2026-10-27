import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { initializeFeatureStream as init, restoreFeatureStream as restore, applyFeatureStreamDelivery as apply,
  materializeFeatureStreamSnapshot as freeze, evaluateTransactionRisk } from '../dist/index.js';
import { riskFixture } from '../fixtures/request.mjs';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/feature-streams/golden.json', import.meta.url)));
const plan = {
  version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1',
  namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600,
  coverage_start: corpus.coverage_start, queries: corpus.snapshots.map(({ expected, ...query }) => query),
  limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 },
};
const delivery = (event, offset) => ({ identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset, event: structuredClone(event) });
const feed = (events = corpus.events, config = plan) => events.reduce((s, e, i) => apply(s, delivery(e, i)), init(config));
const values = s => Object.fromEntries(['count', 'amount', 'window_start', 'window_end', 'reason'].map(k => [k, s[k]]));
const invalid = fn => assert.throws(fn, e => e.code === 'FEATURE_STREAM_INVALID');
const fixed = [['11', '14.11', null], ['11', '13.14', null], [null, null, 'INPUT_MISSING'],
  [null, null, 'HISTORY_INCOMPLETE'], ['11', '13.14', null], ['1', '7.00', null]];

test('every frozen golden snapshot matches fixed values, unchanged fixture and independent reference', () => {
  let state = feed();
  for (const [i, query] of plan.queries.entries()) {
    const result = freeze(state, query.id); state = result.state;
    assert.deepEqual([result.snapshot.count, result.snapshot.amount, result.snapshot.reason], fixed[i]);
    assert.deepEqual(values(result.snapshot), corpus.snapshots[i].expected);
    const { request, observation } = riskFixture();
    const target = corpus.events.find(e => e.transaction_id === query.target);
    request.target = { namespace: target.namespace, transaction_id: target.transaction_id, revision_number: target.revision_number };
    request.policy.currency = query.currency;
    Object.assign(request.context, { binding: { ...request.target, revision_sha256: observation.revision_sha256 }, as_of: query.as_of,
      coverage_start: plan.coverage_start, coverage_complete: query.coverage_complete, events: structuredClone(corpus.events),
      flagged_accounts: query.flags_available ? [] : null, flagged_accounts_version: query.flags_available ? 'synthetic_empty_v1' : null });
    Object.assign(observation, { amount: target.amount, reversed_amount: target.reversed_amount, currency: target.currency,
      transaction_status: target.status, observed_at: query.as_of });
    if (query.evidence === 'missing') for (const key of Object.keys(observation)) observation[key] = key === 'status' ? 'missing' : null;
    const reference = evaluateTransactionRisk(request, observation);
    for (const [code, value] of [['FRAUD_COUNT_VELOCITY', result.snapshot.count], ['FRAUD_AMOUNT_VELOCITY', result.snapshot.amount]]) {
      const finding = reference.findings.find(f => f.code === code);
      assert.equal(finding.metric?.value ?? null, value);
      if (result.snapshot.reason) assert.equal(finding.reason_code, result.snapshot.reason);
    }
  }
  assert.deepEqual(restore(JSON.parse(JSON.stringify(state)), plan), state);
});

test('every prefix survives restart, final parity survives reversed delivery order', () => {
  let state = init(plan);
  for (const [offset, event] of corpus.events.entries()) {
    const previous = JSON.stringify(state);
    const next = apply(state, delivery(event, offset));
    assert.equal(JSON.stringify(state), previous);
    state = restore(JSON.parse(JSON.stringify(next)), plan);
    assert.equal(state.next_offset, offset + 1);
  }
  const reverse = feed([...corpus.events].reverse());
  for (const q of plan.queries) assert.deepEqual(values(freeze(reverse, q.id).snapshot), values(freeze(state, q.id).snapshot));
});

test('offset/revision retries, conflicts, gaps and failed apply are atomic', () => {
  const first = delivery(corpus.events[0], 0), state = apply(init(plan), first);
  const before = JSON.stringify(state), inputBefore = JSON.stringify(first);
  assert.deepEqual(apply(state, first), state);
  const duplicate = apply(state, { ...first, offset: 1 });
  assert.equal(duplicate.next_offset, 2);
  assert.equal(freeze(duplicate, plan.queries[0].id).snapshot.amount, '10.02');
  for (const offset of [0, 1]) invalid(() => apply(state, { ...first, offset, event: { ...first.event, amount: '11.00' } }));
  invalid(() => apply(state, { ...first, offset: 2 }));
  invalid(() => apply(init(plan), { ...first, offset: 1 }));
  invalid(() => apply(state, { ...first, offset: 1, event: { ...first.event, namespace: 'synthetic_other' } }));
  invalid(() => apply(state, { ...first, offset: 1, topic: 'synthetic_other.synthetic_run' }));
  assert.equal(JSON.stringify(state), before); assert.equal(JSON.stringify(first), inputBefore);
});

test('future corrections and old-after-new revisions preserve frozen prefix evidence', () => {
  const prefix = feed(corpus.events.slice(0, -1));
  const frozen = freeze(prefix, plan.queries[0].id);
  assert.equal(frozen.snapshot.amount, '14.11');
  let state = apply(frozen.state, delivery(corpus.events.at(-1), prefix.next_offset));
  state = apply(state, delivery(corpus.events[9], state.next_offset));
  assert.deepEqual(freeze(state, plan.queries[0].id).snapshot, frozen.snapshot);
  assert.equal(freeze(state, plan.queries[1].id).snapshot.amount, '13.14');
  const restored = restore(JSON.parse(JSON.stringify(state)), plan);
  assert.deepEqual(freeze(restored, plan.queries[0].id).snapshot, frozen.snapshot);
  frozen.snapshot.amount = '0.00';
  assert.equal(state.snapshots[0].amount, '14.11');
});

test('state tampering, unsupported versions and changed plan fail closed', () => {
  const state = freeze(feed(), plan.queries[0].id).state;
  for (const mutate of [s => s.snapshots[0].amount = '0.00', s => s.snapshots[0].window_end = '2026-01-01T13:00:00Z',
    s => s.next_offset--, s => s.deliveries[0].offset++, s => s.version = 'unknown',
    s => s.deliveries[10].event.amount = '999.00']) {
    const changed = structuredClone(state); mutate(changed); invalid(() => restore(changed, plan));
  }
  invalid(() => restore(state, { ...plan, input_identity: 'synthetic_changed' }));
  invalid(() => freeze(init(plan), plan.queries[0].id));
  invalid(() => freeze(state, 'unknown'));
});

test('exact finite record/revision/byte caps reject overflow without mutation', () => {
  const one = { ...plan, limits: { ...plan.limits, records: 1, revisions: 1 } };
  const state = apply(init(one), delivery(corpus.events[0], 0));
  const before = JSON.stringify(state);
  invalid(() => apply(state, delivery(corpus.events[1], 1)));
  assert.equal(JSON.stringify(state), before);
  const revisionPlan = { ...plan, limits: { ...plan.limits, revisions: 1 } };
  const rev = apply(init(revisionPlan), delivery(corpus.events[0], 0));
  assert.equal(apply(rev, delivery(corpus.events[0], 1)).next_offset, 2);
  invalid(() => apply(rev, delivery(corpus.events[1], 1)));
  const bytes = new TextEncoder().encode(JSON.stringify([delivery(corpus.events[0], 0)])).length;
  for (const cap of [bytes, bytes - 1]) {
    const config = { ...plan, limits: { ...plan.limits, capture_bytes: cap } };
    if (cap === bytes) assert.equal(apply(init(config), delivery(corpus.events[0], 0)).next_offset, 1);
    else invalid(() => apply(init(config), delivery(corpus.events[0], 0)));
  }
  const full = feed(); const size = new TextEncoder().encode(JSON.stringify(full)).length;
  // Configuration itself changes encoded size: find the exact fixed point.
  let config = { ...plan, limits: { ...plan.limits, state_bytes: size } };
  for (let i = 0; i < 3; i++) config.limits.state_bytes = new TextEncoder().encode(JSON.stringify({ ...full, plan: config })).length;
  assert.equal(restore({ ...full, plan: config }, config).next_offset, full.next_offset);
  config = structuredClone(config); config.limits.state_bytes--;
  invalid(() => restore({ ...full, plan: config }, config));
});

test('sender isolation, exact large money and coverage boundary', () => {
  const events = [corpus.events[0], { ...corpus.events[1], amount: '9999999999999999999999.99' },
    { ...corpus.events[2], sender: 'synthetic_unrelated', amount: '100.00' }];
  assert.equal(freeze(feed(events), plan.queries[0].id).snapshot.amount, '10000000000000000000010.01');
  const config = { ...plan, coverage_start: '2026-01-01T11:00:01Z' };
  assert.equal(freeze(feed(events, config), plan.queries[0].id).snapshot.reason, 'HISTORY_INCOMPLETE');
  const exact = { ...plan, coverage_start: '2026-01-01T11:00:00Z' };
  assert.equal(freeze(feed(events, exact), plan.queries[0].id).snapshot.reason, null);
});
