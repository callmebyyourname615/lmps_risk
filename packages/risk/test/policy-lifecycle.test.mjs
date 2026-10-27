import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  compareRiskPolicies,
  nextPolicyState,
  riskHash,
  validatePolicy,
  validatePolicyCommand,
} from '../dist/index.js';
import { riskFixture } from '../fixtures/request.mjs';

test('policy validation reuses all15 typed detector thresholds and rejects live/executable/unknown inputs', () => {
  const { request } = riskFixture();
  const command = { action: 'create', request_id: randomUUID(), policy: request.policy, note: 'Synthetic test policy' };
  assert.equal(validatePolicyCommand(command).policy.rules.length, 15);
  for (const mutation of [
    (c) => (c.policy = null),
    (c) => c.policy.rules.pop(),
    (c) => (c.policy.rules[0].threshold = 'eval(1)'),
    (c) => (c.policy.version = 'production_v1'),
    (c) => (c.extra = true),
    (c) => (c.note = ' '),
    (c) => (c.request_id = 'bad'),
  ]) {
    const bad = structuredClone(command);
    mutation(bad);
    assert.throws(
      () => validatePolicyCommand(bad),
      (e) => e.code === 'POLICY_INVALID_INPUT',
    );
  }
  assert.throws(
    () => validatePolicy(null),
    (e) => e.code === 'POLICY_INVALID_INPUT',
  );
});
test('state machine separates creator/submitter from approver, with terminal rejected/approved versions', () => {
  assert.equal(nextPolicyState('draft', 'submit', 'synthetic_maker', 'synthetic_maker', null), 'submitted');
  assert.equal(
    nextPolicyState('submitted', 'approve', 'synthetic_checker', 'synthetic_maker', 'synthetic_submitter'),
    'approved',
  );
  for (const actor of ['synthetic_maker', 'synthetic_submitter'])
    assert.throws(
      () => nextPolicyState('submitted', 'approve', actor, 'synthetic_maker', 'synthetic_submitter'),
      (e) => e.code === 'POLICY_SELF_APPROVAL',
    );
  for (const state of ['draft', 'approved', 'rejected'])
    assert.throws(
      () => nextPolicyState(state, 'approve', 'synthetic_checker', 'synthetic_maker', 'synthetic_submitter'),
      (e) => e.code === 'POLICY_INVALID_TRANSITION',
    );
});
test('policy comparison is deterministic, preserves frozen inputs and shows explicit finding/coverage changes', () => {
  const f = riskFixture(),
    left = f.request.policy,
    right = structuredClone(left);
  right.version = 'synthetic_v2';
  right.rules.forEach((r) => (r.enabled = false));
  const input = [{ request: f.request, observation: f.observation }],
    original = structuredClone(input);
  const report = compareRiskPolicies(left, right, input);
  assert.deepEqual(report, compareRiskPolicies(left, right, input));
  assert.deepEqual(input, original);
  assert.equal(report.summary.runs, 1);
  assert.equal(report.summary.changed_runs, 1);
  assert.equal(report.summary.candidate_with_signals, 0);
  assert.equal(report.rows[0].after.fraud_score.value, null);
  assert.equal(report.rows[0].after.fraud_score.status, 'not_evaluated');
  assert.equal(report.enforcement, false);
  assert.equal(report.rows[0].changed_codes.length, 15);
  assert.equal(report.baseline.sha256, riskHash(validatePolicy(left)));
});
test('comparison bounds, duplicate evidence and cross-currency policies reject instead of fabricating a result', () => {
  const f = riskFixture(),
    right = structuredClone(f.request.policy);
  right.currency = 'USD';
  const input = { request: f.request, observation: f.observation };
  for (const inputs of [[], Array(21).fill(input), [input, input]])
    assert.throws(() => compareRiskPolicies(f.request.policy, f.request.policy, inputs));
  assert.throws(
    () => compareRiskPolicies(f.request.policy, right, [input]),
    (e) => e.code === 'POLICY_INVALID_INPUT',
  );
});
