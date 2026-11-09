import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayFeatureRisk as replay, compareFeatureRiskReplay as compare } from '../dist/feature-risk-replay.js';
import { evaluateFeatureRisk, initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot, riskHash } from '@lmps/risk';
import { featurePublicationContentHash } from '@lmps/contracts/feature-serving';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';

function fixture({ missing = false, zero = false, partial = false } = {}) {
  const { request, observation } = riskFixture();
  request.run_id = '00000000-0000-4000-8000-000000000001'; request.context = null;
  observation.amount = zero ? '0.00' : '10.00'; observation.observed_at = '2026-01-01T12:00:00Z';
  const query = { id: 'current', target: request.target.transaction_id, as_of: observation.observed_at,
    currency: 'SYN', evidence: missing ? 'missing' : 'available', coverage_complete: !partial, flags_available: false };
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_replay',
    namespace: request.target.namespace, topic: request.target.namespace + '.synthetic_run', window_seconds: 3600,
    coverage_start: '2026-01-01T08:00:00Z', queries: [query],
    limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const version = 'synthetic-feature-serving-1', scope = { version, mode: 'local_synthetic', workspace_key: 'synthetic_local', plan,
    policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 120 } };
  let state = initializeFeatureStream(plan);
  const event = (id, amount, extra = {}) => ({ ...request.target, transaction_id: id, sender: 'synthetic_A', receiver: 'synthetic_B',
    occurred_at: '2026-01-01T11:30:00Z', available_at: '2026-01-01T11:30:00Z', amount, reversed_amount: '0.00', currency: 'SYN', status: 'succeeded', ...extra });
  const add = value => { state = applyFeatureStreamDelivery(state, { identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset: state.next_offset, event: value }); };
  add(event(request.target.transaction_id, observation.amount, { occurred_at: query.as_of, available_at: query.as_of }));
  if (!zero) {
    add(event('synthetic_prior', '1.01')); add(event('synthetic_prior', '1.01'));
    add(event('synthetic_prior', '1.01', { revision_number: 2, reversed_amount: '0.01', status: 'partially_reversed' }));
    add(event('synthetic_reversed', '9.00', { reversed_amount: '9.00', status: 'reversed' }));
    add(event('synthetic_future', '999.00', { available_at: '2026-01-01T12:00:01Z' }));
  }
  state = materializeFeatureStreamSnapshot(state, query.id).state;
  const publication = { version, scope, state, generation: 1, predecessor: null, published_at: query.as_of,
    expires_at: '2026-01-01T13:00:00Z', content_hash: Array(8).fill('00000000').join('-') };
  publication.content_hash = featurePublicationContentHash(publication);
  const serving_request = { version, workspace_key: scope.workspace_key, plan, query, currency: 'SYN', policy: scope.policy, now: '2026-01-01T12:02:00Z' };
  return { publication, scope, inputs: [{ serving_request, risk_request: request, observation }] };
}
const run = f => replay(f.publication, f.scope, f.inputs);
const finding = (r, code) => r.rows[0].assessment.findings.find(f => f.code === code);
test('parity recomputes full envelopes and reports altered evidence without trusting success or hashes', () => {
  const f = fixture(), input = f.inputs[0];
  const individual = evaluateFeatureRisk(f.publication, f.scope, input.serving_request, input.risk_request, input.observation);
  const before = structuredClone(individual);
  const check = values => compare(f.publication, f.scope, f.inputs, values);
  assert.deepEqual(check([individual]), { production_ready: false, status: 'match', replay_sha256: riskHash(run(f)), mismatches: [] });
  const changed = structuredClone(individual); changed.assessment.findings[0].status = 'triggered';
  changed.success = true; changed.result_sha256 = run(f).rows[0].result_sha256;
  const mismatch = check([changed]);
  assert.equal(mismatch.status, 'mismatch'); assert.equal(mismatch.mismatches[0].index, 0);
  assert.equal(mismatch.mismatches[0].individual_result_sha256, riskHash(changed));
  assert.deepEqual(individual, before); assert.throws(() => check([]));
  assert.equal(check([{ success: true, result_sha256: run(f).rows[0].result_sha256 }]).status, 'mismatch');
  assert.throws(() => check([{ get success() { assert.fail('getter called'); } }]));
});
test('ordered eight-row replay binds order and aggregates each dimension without averaging scores', () => {
  const f = fixture();
  f.inputs = Array.from({ length: 8 }, (_, i) => {
    const input = structuredClone(f.inputs[0]);
    input.risk_request.run_id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    return input;
  });
  const report = run(f);
  const individuals = f.inputs.map(input => evaluateFeatureRisk(f.publication, f.scope,
    input.serving_request, input.risk_request, input.observation));
  assert.equal(compare(f.publication, f.scope, f.inputs, individuals).status, 'match');
  assert.deepEqual(report.rows.map(row => row.run_id), f.inputs.map(input => input.risk_request.run_id));
  assert.equal(report.dimensions.fraud.findings.triggered, 8);
  const expectedFindingTotals = { fraud: 48, mule_network: 40, aml: 32 };
  for (const [dimension, counts] of Object.entries(report.dimensions)) {
    assert.equal(Object.values(counts.scores).reduce((a, b) => a + b), 8);
    assert.equal(Object.values(counts.findings).reduce((a, b) => a + b), expectedFindingTotals[dimension]);
  }
  const reorderedKeys = value => Array.isArray(value) ? value.map(reorderedKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse()
      .map(([key, item]) => [key, reorderedKeys(item)])) : value;
  assert.deepEqual(replay(reorderedKeys(f.publication), reorderedKeys(f.scope), reorderedKeys(f.inputs)), report);
  f.inputs.reverse();
  const reversed = run(f);
  assert.notEqual(reversed.inputs_sha256, report.inputs_sha256);
  assert.deepEqual(reversed.dimensions, report.dimensions);
  assert.deepEqual(reversed.rows, [...report.rows].reverse());
  assert.equal(compare(f.publication, f.scope, f.inputs, individuals).mismatches.length, 8);
});
test('coverage stays separate; partial and absent publications withhold context', () => {
  const f = fixture({ partial: true }), partial = run(f);
  assert.equal(partial.rows[0].feature.reason, 'HISTORY_INCOMPLETE');
  assert.equal(partial.rows[0].context.status, 'withheld');
  assert.ok(partial.dimensions.fraud.coverage.unavailable > 0);
  assert.equal(partial.dimensions.fraud.coverage.triggered, 0);
  const absent = replay(null, f.scope, f.inputs);
  assert.equal(absent.status, 'partial'); assert.equal(absent.rows[0].context.status, 'withheld');
  for (const [dimension, score] of [['fraud', 'fraud_score'], ['mule_network', 'mule_network_score'], ['aml', 'aml_suspicion_score']]) {
    assert.deepEqual(partial.dimensions[dimension].coverage, partial.rows[0].assessment[score].coverage);
  }
});
test('later generation and future correction preserve frozen prefix and earlier objects', () => {
  const f = fixture(), oldPublication = structuredClone(f.publication), old = run(f), saved = structuredClone(old);
  const correction = { ...f.publication.state.deliveries[0].event, revision_number: 2, amount: '999.00', available_at: '2026-01-01T12:00:01Z' };
  const next = structuredClone(f.publication);
  next.state = applyFeatureStreamDelivery(next.state, { identity: 'synthetic_declared', topic: next.state.plan.topic,
    partition: 0, offset: next.state.next_offset, event: correction });
  next.generation = 2; next.predecessor = { generation: 1, content_hash: next.content_hash };
  next.content_hash = featurePublicationContentHash(next);
  const later = replay(next, f.scope, f.inputs);
  assert.deepEqual(later.rows[0].assessment, old.rows[0].assessment);
  assert.equal(later.rows[0].lineage.source_prefix, old.rows[0].lineage.source_prefix);
  assert.notEqual(later.publication_sha256, old.publication_sha256);
  assert.notEqual(later.rows[0].feature_source_sha256, old.rows[0].feature_source_sha256);
  assert.deepEqual(f.publication, oldPublication); assert.deepEqual(old, saved);
  f.inputs[0].risk_request.policy.version = 'synthetic_v2';
  assert.notEqual(run(f).rows[0].policy_sha256, old.rows[0].policy_sha256);
  assert.deepEqual(old, saved);
});
test('empty tuples, unknown scope, caller context and future observation fail closed', () => {
  const f = fixture(); assert.throws(() => replay(f.publication, f.scope, []));
  for (const change of [x => { x.scope.extra = true; }, x => { x.inputs[0].risk_request.context = {}; },
    x => { x.inputs[0].observation.observed_at = '2026-01-01T12:00:01Z'; }]) {
    const v = fixture(); change(v); assert.throws(() => run(v));
  }
});
test('a valid different frozen source prefix changes source identity even when totals agree', () => {
  const f = fixture(), old = run(f), next = structuredClone(f.publication);
  // A duplicate delivery changes the bound prefix, never the effective amount.
  next.state = applyFeatureStreamDelivery(next.state, { identity: 'synthetic_declared', topic: next.state.plan.topic,
    partition: 0, offset: next.state.next_offset, event: next.state.deliveries[0].event });
  next.state.snapshots = [];
  next.state = materializeFeatureStreamSnapshot(next.state, 'current').state;
  next.generation = 2; next.predecessor = { generation: 1, content_hash: next.content_hash };
  next.content_hash = featurePublicationContentHash(next);
  const changed = replay(next, f.scope, f.inputs);
  assert.equal(finding(changed, 'FRAUD_AMOUNT_VELOCITY').metric.value, '11.00');
  assert.equal(changed.rows[0].lineage.source_prefix, old.rows[0].lineage.source_prefix + 1);
  assert.notEqual(changed.rows[0].lineage.source_sha256, old.rows[0].lineage.source_sha256);
  assert.notEqual(changed.rows[0].feature_source_sha256, old.rows[0].feature_source_sha256);
  assert.deepEqual(run(f), old);
});
test('hand-calculated correction/reversal/duplicate/future cohort matches individual serving and keeps fifteen findings', () => {
  const f = fixture(), r = run(f), input = f.inputs[0];
  const online = evaluateFeatureRisk(f.publication, f.scope, input.serving_request, input.risk_request, input.observation);
  assert.equal(finding(r, 'FRAUD_COUNT_VELOCITY').metric.value, '2');
  assert.equal(finding(r, 'FRAUD_AMOUNT_VELOCITY').metric.value, '11.00');
  assert.equal(finding(r, 'MULE_FLAGGED_NEIGHBOR').reason_code, 'FLAGS_UNAVAILABLE');
  assert.equal(r.rows[0].assessment.findings.length, 15); assert.equal(r.rows[0].result_sha256, riskHash(online));
  assert.deepEqual(r.rows[0].assessment, online.assessment); assert.equal(r.production_ready, false);
  assert.equal(r.dimensions.fraud.findings.triggered, 1);
  for (const dimension of Object.values(r.dimensions)) assert.equal(Object.values(dimension.scores).reduce((a, b) => a + b), 1);
});
test('retry and object key order are deterministic; later policy or observation versions cannot mutate earlier evidence', () => {
  const f = fixture(), before = JSON.stringify(f), r = run(f), saved = structuredClone(r);
  assert.deepEqual(run(f), r); assert.equal(JSON.stringify(f), before);
  f.inputs[0].risk_request = Object.fromEntries(Object.entries(f.inputs[0].risk_request).reverse()); assert.deepEqual(run(f), r);
  f.inputs[0].risk_request.policy.version = 'synthetic_v2'; assert.notEqual(run(f).rows[0].assessment_sha256, r.rows[0].assessment_sha256);
  assert.deepEqual(r, saved); r.rows[0].assessment.findings.length = 0; assert.equal(run(f).rows[0].assessment.findings.length, 15);
  f.inputs[0].observation.revision_sha256 = 'b'.repeat(64); assert.notEqual(run(f).inputs_sha256, saved.inputs_sha256);
});
test('missing, stale and valid zero remain distinct statuses without unavailable-to-negative counts', () => {
  const missing = run(fixture({ missing: true })); assert.equal(missing.status, 'partial');
  assert.equal(missing.rows[0].feature.reason, 'INPUT_MISSING'); assert.equal(missing.rows[0].context.status, 'withheld');
  assert.ok(missing.dimensions.fraud.findings.unavailable > 0);
  const f = fixture(); f.inputs[0].serving_request.now = '2026-01-01T12:02:01Z'; assert.equal(run(f).rows[0].feature.reason, 'SOURCE_STALE');
  const zero = run(fixture({ zero: true })); assert.equal(zero.rows[0].feature.status, 'available');
  assert.equal(zero.rows[0].assessment.assessment_status, 'not_applicable'); assert.equal(zero.rows[0].assessment.fraud_score.value, null);
});
test('exact eight tuples pass, duplicates and a ninth tuple fail; unknown fields and accessor shapes fail closed', () => {
  const f = fixture(); f.inputs = Array.from({ length: 8 }, (_, i) => { const v = structuredClone(f.inputs[0]); v.risk_request.run_id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`; return v; });
  assert.equal(run(f).rows.length, 8); f.inputs.push(structuredClone(f.inputs[0])); assert.throws(() => run(f));
  f.inputs = [f.inputs[0], f.inputs[0]]; assert.throws(() => run(f));
  f.inputs = [{ ...f.inputs[0], success: true }]; assert.throws(() => run(f));
  f.inputs = [Object.defineProperty({}, 'observation', { enumerable: true, get() { assert.fail('getter called'); } })]; assert.throws(() => run(f));
});
test('changed source, target revision, currency and rehashed forged totals cannot authorize an accepted replay', () => {
  for (const change of [f => f.inputs[0].risk_request.target.revision_number++, f => f.inputs[0].risk_request.policy.currency = 'USD',
    f => f.publication.state.snapshots[0].amount = '0.00', f => f.publication.state.snapshots[0].next_offset = 1]) {
    const f = fixture(); change(f); assert.throws(() => run(f));
    f.publication.content_hash = featurePublicationContentHash(f.publication); assert.throws(() => run(f));
  }
  const f = fixture(); f.inputs[0].success = true; f.inputs[0].assessment_sha256 = 'a'.repeat(64); assert.throws(() => run(f));
});
