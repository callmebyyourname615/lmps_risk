import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectFeatureRiskAlerts as project, RISK_CODES, riskHash, evaluateFeatureRisk,
  initializeFeatureStream as init, applyFeatureStreamDelivery as add, materializeFeatureStreamSnapshot as freeze } from '../dist/index.js';
import { featurePublicationContentHash as hash } from '@lmps/contracts/feature-serving';
import { riskFixture } from '../fixtures/request.mjs';

function fixture({ partial = false, missing = false } = {}) {
  const { request, observation } = riskFixture();
  request.run_id = '00000000-0000-4000-8000-000000000001';
  const events = request.context.events.map(e => ({ ...e, occurred_at: e.occurred_at.replace('.000Z', 'Z'), available_at: e.available_at.replace('.000Z', 'Z') })); request.context = null;
  observation.observed_at = observation.observed_at.replace('.000Z', 'Z');
  const query = { id: 'current', target: request.target.transaction_id, as_of: observation.observed_at,
    currency: 'SYN', evidence: missing ? 'missing' : 'available', coverage_complete: !partial, flags_available: false };
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run',
    input_identity: 'synthetic_fixture', namespace: request.target.namespace, topic: `${request.target.namespace}.synthetic_run`,
    window_seconds: 3600, coverage_start: '2026-01-01T08:00:00Z', queries: [query],
    limits: { records: 2000, revisions: 2000, snapshots: 8, capture_bytes: 2097152, state_bytes: 1048576 } };
  const version = 'synthetic-feature-serving-1';
  const scope = { version, mode: 'local_synthetic', workspace_key: 'synthetic_local', plan,
    policy: { id: 'synthetic_fresh', version: 'synthetic_v1', max_age_seconds: 120 } };
  let state = init(plan);
  for (const event of events) state = add(state, { identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset: state.next_offset, event });
  state = freeze(state, query.id).state;
  const publication = { version, scope, state, generation: 1, predecessor: null, published_at: query.as_of,
    expires_at: '2026-01-01T13:00:00Z', content_hash: Array(8).fill('00000000').join('-') };
  publication.content_hash = hash(publication);
  const serving = { version, workspace_key: scope.workspace_key, plan, query, currency: 'SYN', policy: scope.policy, now: query.as_of };
  const policy = { policy_id: 'synthetic_alerts', version: 'synthetic_v1', minimum_severity: 'high', included_codes: [...RISK_CODES], include_partial: true };
  return { publication, scope, serving, request, observation, policy };
}
const run = f => project(f.publication, f.scope, f.serving, f.request, f.observation, f.policy);

test('one candidate preserves fourteen eligible findings, severity equality and separate dimension semantics', () => {
  const f = fixture(), before = structuredClone(f), r = run(f);
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0].snapshot.selected_risk_types, RISK_CODES.filter(c => c !== 'MULE_FLAGGED_NEIGHBOR'));
  assert.equal(r.candidates[0].snapshot.severity, 'high');
  assert.equal(r.evidence.assessment.findings.length, 15);
  assert.equal(r.evidence.assessment.fraud_score.value, 1);
  assert.equal(r.evidence.assessment.mule_network_score.value, null);
  assert.equal(r.evidence.assessment.aml_suspicion_score.value, 1);
  const fresh = evaluateFeatureRisk(f.publication, f.scope, f.serving, f.request, f.observation);
  assert.equal(r.identities.assessment_sha256, riskHash(fresh.assessment));
  assert.equal(r.identities.source_prefix, 9); assert.equal(r.production_ready, false);
  assert.equal(r.durable_grouping, false); assert.ok(r.remaining_gates.includes('durable_alert_integration'));
  assert.deepEqual(f, before);
});
test('partial excluded, included code filtering, severity above equality and disabled rules', () => {
  const f = fixture(); f.policy.include_partial = false;
  assert.equal(run(f).reason_code, 'ALERT_PARTIAL_EXCLUDED'); assert.equal(run(f).candidates.length, 0);
  f.policy.include_partial = true; f.policy.included_codes = ['AML_MULTI_HOP_FLOW'];
  assert.deepEqual(run(f).candidates[0].snapshot.selected_risk_types, ['AML_MULTI_HOP_FLOW']);
  f.policy.minimum_severity = 'critical'; assert.equal(run(f).reason_code, 'ALERT_NO_MATCH');
  f.policy.minimum_severity = 'high';
  f.request.policy.rules.find(r => r.code === 'AML_MULTI_HOP_FLOW').enabled = false;
  assert.equal(run(f).reason_code, 'ALERT_NO_MATCH');
});
test('retry, key ordering and count stable; policy/revision/source versions change identity without mutating old evidence', () => {
  const f = fixture(), original = run(f), id = original.candidates[0].candidate_sha256;
  assert.deepEqual(run(f), original);
  f.policy = Object.fromEntries(Object.entries(f.policy).reverse()); f.policy.included_codes.reverse();
  assert.deepEqual(run(f), original);
  for (const mutate of [f => f.policy.version = 'synthetic_v2', f => f.request.policy.version = 'synthetic_v2',
    f => f.observation.revision_sha256 = 'b'.repeat(64), f => {
      f.publication.generation = 2;
      f.publication.predecessor = { generation: 1, content_hash: f.publication.content_hash };
      f.publication.content_hash = hash(f.publication);
    }]) {
    const changed = fixture(); mutate(changed); const r = run(changed);
    assert.equal(r.candidates.length, 1); assert.notEqual(r.candidates[0].candidate_sha256, id);
  }
  original.candidates[0].snapshot.selected_risk_types.length = 0;
  assert.equal(run(f).candidates[0].snapshot.selected_risk_types.length, 14);
});
test('missing/stale source withholds context; amount-only finding never implies successful source no-match', () => {
  for (const [options, reason] of [[{ partial: true }, 'HISTORY_INCOMPLETE'], [{ missing: true }, 'INPUT_MISSING']]) {
    const f = fixture(options), r = run(f);
    assert.equal(r.source_status, 'withheld'); assert.equal(r.source_reason, reason);
    assert.deepEqual(r.candidates[0].snapshot.selected_risk_types, ['FRAUD_HIGH_AMOUNT']);
    assert.equal(r.evidence.assessment.mule_network_score.value, null);
    f.policy.included_codes = ['FRAUD_COUNT_VELOCITY'];
    assert.equal(run(f).reason_code, 'FEATURE_CONTEXT_WITHHELD');
  }
  for (const mutate of [f => f.publication = null, f => f.serving.now = '2026-01-01T12:02:01Z']) {
    const f = fixture(); mutate(f); const r = run(f);
    assert.equal(r.source_status, 'withheld'); assert.ok(r.source_reason);
    assert.deepEqual(r.candidates[0].snapshot.selected_risk_types, ['FRAUD_HIGH_AMOUNT']);
    assert.equal(r.evidence.assessment.fraud_score.value, null);
    f.policy.included_codes = ['FRAUD_COUNT_VELOCITY'];
    assert.equal(run(f).reason_code, 'FEATURE_CONTEXT_WITHHELD'); assert.equal(run(f).candidates.length, 0);
  }
  const f = fixture(); f.publication = null;
  f.observation = { status: 'missing', revision_sha256: null, amount: null, reversed_amount: null,
    currency: null, transaction_status: null, observed_at: null };
  assert.equal(run(f).evidence.assessment.assessment_status, 'unavailable'); assert.equal(run(f).candidates.length, 0);
});
test('forged results, caller context, unknown scope, future time and rehashed arithmetic rejected', () => {
  for (const mutate of [f => f.request.result = { success: true }, f => f.policy.success = true,
    f => f.request.context = riskFixture().request.context,
    f => f.publication = { success: true, assessment: run(f).evidence.assessment },
    f => { f.publication.state.snapshots[0].amount = '0.00'; f.publication.content_hash = hash(f.publication); },
    f => f.observation.observed_at = '2026-01-01T12:00:01Z', f => f.scope.extra = true]) {
    const f = fixture(); mutate(f); assert.throws(() => run(f));
  }
  const f = fixture(); let invoked = false;
  Object.defineProperty(f.policy, 'version', { enumerable: true, get() { invoked = true; return 'synthetic_v1'; } });
  assert.throws(() => run(f)); assert.equal(invoked, false);
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; assert.throws(() => run(fixture())); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
