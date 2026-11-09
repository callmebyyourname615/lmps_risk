import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFeatureRisk as evaluate, initializeFeatureStream as init, applyFeatureStreamDelivery as apply,
  materializeFeatureStreamSnapshot as freeze } from '../dist/index.js';
import { featurePublicationContentHash as hash } from '@lmps/contracts/feature-serving';
import { riskFixture } from '../fixtures/request.mjs';

const version = 'synthetic-feature-serving-1';
const seal = p => ({ ...p, content_hash: hash(p) });
function fixture({ zero = false, partial = false, missing = false, count = 0 } = {}) {
  const { request, observation } = riskFixture();
  request.run_id = '00000000-0000-4000-8000-000000000001'; request.context = null;
  observation.amount = zero ? '0.00' : '10.02'; observation.observed_at = '2026-01-01T12:00:00Z';
  const query = { id: 'current', target: request.target.transaction_id, as_of: observation.observed_at,
    currency: 'SYN', evidence: missing ? 'missing' : 'available', coverage_complete: !partial, flags_available: true };
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run',
    input_identity: 'synthetic_fixture', namespace: request.target.namespace, topic: `${request.target.namespace}.synthetic_run`,
    window_seconds: 3600, coverage_start: '2026-01-01T08:00:00Z', queries: [query],
    limits: { records: 2000, revisions: 2000, snapshots: 8, capture_bytes: 2097152, state_bytes: 1048576 } };
  const scope = { version, mode: 'local_synthetic', workspace_key: 'synthetic_local', plan,
    policy: { id: 'synthetic_fresh', version: 'synthetic_v1', max_age_seconds: 120 } };
  const event = (id, amount = '1.01', more = {}) => ({ ...request.target, transaction_id: id, sender: 'synthetic_A', receiver: 'synthetic_B',
    occurred_at: '2026-01-01T11:30:00Z', available_at: '2026-01-01T11:30:00Z', currency: 'SYN', amount,
    reversed_amount: '0.00', status: 'succeeded', ...more });
  let state = init(plan);
  const add = e => { state = apply(state, { identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset: state.next_offset, event: e }); };
  add(event('synthetic_target', observation.amount, { occurred_at: query.as_of, available_at: query.as_of }));
  if (!zero) {
    const prior = event('synthetic_prior'); add(prior); add(prior);
    add(event('synthetic_prior', '1.01', { revision_number: 2, reversed_amount: '0.01', status: 'partially_reversed' }));
    add(event('synthetic_reversed', '4.00', { reversed_amount: '4.00', status: 'reversed' }));
    add(event('synthetic_future', '999.00', { available_at: '2026-01-01T12:00:01Z' }));
  }
  for (let i = 0; i < count; i++) add(event(`synthetic_extra_${i}`));
  state = freeze(state, query.id).state;
  const prefix = state.next_offset;
  // A later source revision cannot rewrite the frozen prefix, even if backdated.
  add(event('synthetic_target', '99.00', { revision_number: 2, occurred_at: query.as_of, available_at: query.as_of }));
  const publication = seal({ version, scope, state, generation: 1, predecessor: null,
    published_at: query.as_of, expires_at: '2026-01-01T13:00:00Z', content_hash: Array(8).fill('00000000').join('-') });
  const serving = { version, workspace_key: scope.workspace_key, plan, query, currency: 'SYN', policy: scope.policy, now: '2026-01-01T12:02:00Z' };
  return { publication, scope, serving, request, observation, prefix };
}
const run = f => evaluate(f.publication, f.scope, f.serving, f.request, f.observation);
const metric = (r, code) => r.assessment.findings.find(f => f.code === code);
test('fixed P04 totals: correction, reversal, duplicate and both future fences; fifteen original findings', () => {
  const f = fixture(), r = run(f);
  assert.deepEqual([r.feature.status, r.feature.count, r.feature.amount], ['available', '2', '11.02']);
  assert.equal(metric(r, 'FRAUD_COUNT_VELOCITY').metric.value, '2');
  assert.equal(metric(r, 'FRAUD_AMOUNT_VELOCITY').metric.value, '11.02');
  assert.equal(metric(r, 'FRAUD_HIGH_AMOUNT').metric.value, '10.02');
  assert.equal(metric(r, 'MULE_FLAGGED_NEIGHBOR').reason_code, 'FLAGS_UNAVAILABLE');
  assert.equal(r.assessment.findings.length, 15); assert.equal(r.assessment.assessment_status, 'partial');
  assert.equal(r.assessment.mule_network_score.value, null); assert.equal(r.assessment.aml_suspicion_score.meaning, 'risk_index');
  assert.equal(r.lineage.source_prefix, f.prefix); assert.equal(r.lineage.revision_attestation, 'caller_binding_only');
  assert.equal(r.production_ready, false);
});
test('zero is explicit P04 zero with original nonexecution semantics', () => {
  const r = run(fixture({ zero: true }));
  assert.deepEqual([r.feature.count, r.feature.amount], ['0', '0.00']);
  assert.equal(r.assessment.assessment_status, 'not_applicable'); assert.equal(r.assessment.fraud_score.value, null);
});
test('missing, partial, stale, expiry and absent publication withhold context, never fabricate safe scores', () => {
  for (const [options, reason] of [[{ partial: true }, 'HISTORY_INCOMPLETE'], [{ missing: true }, 'INPUT_MISSING']]) {
    const r = run(fixture(options)); assert.equal(r.context.reason, reason); assert.equal(r.feature.amount, null);
    assert.equal(metric(r, 'FRAUD_COUNT_VELOCITY').reason_code, 'CONTEXT_NOT_PROVIDED');
  }
  for (const [now, reason] of [['2026-01-01T12:02:01Z', 'SOURCE_STALE'], ['2026-01-01T13:00:00Z', 'PUBLICATION_EXPIRED']]) {
    const f = fixture(); f.serving.now = now; const r = run(f);
    assert.equal(r.context.reason, reason); assert.equal(r.assessment.feature_snapshot_sha256, null);
    assert.equal(metric(r, 'FRAUD_HIGH_AMOUNT').metric.value, '10.02');
  }
  const f = fixture(); f.publication = null; assert.equal(run(f).context.reason, 'PUBLICATION_MISSING');
});
test('bindings reject caller context, target/revision, currency/window, time and unknown scope conflicts', () => {
  for (const change of [f => f.request.context = riskFixture().request.context, f => f.request.target.revision_number++,
    f => f.request.target.transaction_id = 'synthetic_other', f => f.request.target.namespace = 'synthetic_other',
    f => f.request.policy.currency = 'USD', f => f.request.policy.window_seconds = 60,
    f => f.observation.currency = 'USD', f => f.observation.observed_at = '2026-01-01T12:00:01Z',
    f => f.observation.amount = '10.03', f => f.scope.extra = true, f => f.observation.revision_sha256 = null,
    f => f.request.workspace_key = 'synthetic_other']) {
    const f = fixture(); change(f); assert.throws(() => run(f));
  }
  const f = fixture(); f.observation.revision_sha256 = 'b'.repeat(64);
  assert.equal(run(f).lineage.observation_revision_sha256, 'b'.repeat(64));
});
test('rehashed arithmetic forgery cannot authorize a snapshot', () => {
  for (const change of [p => p.state.snapshots[0].amount = '0.00', p => p.state.snapshots[0].count = '0',
    p => p.state.snapshots[0].next_offset = 1, p => p.state.deliveries[0].event.amount = '99.00']) {
    const f = fixture(); change(f.publication); assert.throws(() => run(f));
    f.publication = seal(f.publication); assert.throws(() => run(f));
  }
});
test('all inputs detach; output mutation never changes earlier results or source', () => {
  const f = fixture(), before = JSON.stringify(f), r = run(f), expected = structuredClone(r);
  assert.equal(JSON.stringify(f), before);
  r.feature.provenance.publication.state.deliveries[0].event.amount = '999.00'; r.assessment.findings.length = 0;
  assert.equal(JSON.stringify(f), before); assert.deepEqual(run(f), expected);
  f.observation.amount = '20.00'; assert.equal(expected.assessment.findings[0].metric.value, '10.02');
});
test('accessors/exotic inputs rejected before invocation; production mode rejected', () => {
  for (const key of ['publication', 'scope', 'serving', 'request', 'observation']) {
    const f = fixture(); f[key] = Object.defineProperty({}, 'bad', { enumerable: true, get() { assert.fail('getter invoked'); } });
    assert.throws(() => run(f));
    f[key] = new Date(); assert.throws(() => run(f));
  }
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; assert.throws(() => run(fixture())); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('risk context bound withholds rather than truncates eligible P04 history', () => {
  const r = run(fixture({ count: 200 }));
  assert.equal(r.feature.count, '202'); assert.equal(r.context.reason, 'RISK_CONTEXT_LIMIT_EXCEEDED');
  assert.equal(r.assessment.feature_snapshot_sha256, null);
});
