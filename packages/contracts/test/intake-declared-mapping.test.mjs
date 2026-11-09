import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredIntakeLifecycle, jointIntakeLifecycle, INTAKE_DECLARED_MAPPING, INTAKE_JOINT_MAPPING } from '../dist/intake-source-contract.js';

const input = (result, shouldrevert, reference = 'synthetic_new', originalreference = 'synthetic_old') => ({ result, shouldrevert, reference, originalreference });

test('v3 separates reported success and refund requirement, preserving v2 behavior', () => {
  assert.notEqual(INTAKE_DECLARED_MAPPING, INTAKE_JOINT_MAPPING);
  for (const [result, success] of [['OK', 'succeeded'], ['ERROR', 'not_successful'], ['TRANSACTION_FAILED', 'not_successful'], [null, 'unknown'], ['', 'unknown'], [' OK', 'unknown']]) {
    for (const [flag, refund] of [['0', 'not_required'], ['1', 'required'], [null, 'unknown'], ['2', 'unknown']]) {
      const actual = declaredIntakeLifecycle(input(result, flag));
      assert.equal(actual.reported_success, success);
      assert.equal(actual.refund_instruction, refund);
      assert.equal(actual.refund_completion, 'unverified');
      assert.equal(actual.net_executed_amount, null);
      assert.equal(actual.reversed_amount, null);
      assert.equal(actual.occurred_at, null);
      assert.equal(actual.known_at, null);
      assert.equal(actual.account_identity, 'unverified');
      assert.equal(actual.business_payment_identity, 'unverified');
      assert.equal(actual.drs_reference, 'prior_reference_candidate');
      assert.ok(!Object.values(actual).includes('synthetic_old'));
    }
  }
  assert.equal(jointIntakeLifecycle({ result: 'OK', shouldrevert: '1' }).transaction_status, 'unknown');
  assert.equal(declaredIntakeLifecycle(input('OK', '1')).reported_success, 'succeeded');
  assert.equal(declaredIntakeLifecycle(input('OK', '1')).refund_instruction, 'required');
});

test('DRS markers do not manufacture identity, corrections, completed refunds or net values', () => {
  assert.equal(declaredIntakeLifecycle(input('OK', '0', 'same', 'same')).drs_reference, 'same_reference_requires_review');
  assert.equal(declaredIntakeLifecycle(input('OK', '0', null, 'old')).drs_reference, 'unknown');
  for (const original of ['', null]) assert.equal(declaredIntakeLifecycle(input('OK', '0', 'new', original)).drs_reference, 'not_indicated');
});

test('v3 rejects coercion, malformed/reflected inputs and production without revealing values', () => {
  let read = false;
  const getter = input('OK', '0');
  Object.defineProperty(getter, 'result', { enumerable: true, get() { read = true; throw Error('PRIVATE'); } });
  for (const value of [null, [], {}, getter, { ...input('OK', '0'), extra: 'PRIVATE' }, input('OK', 1), input('OK', '01'), input('OK', '2147483648'), input('PRIVATE\nVALUE', '0'), input('OK', '0', 'x'.repeat(201))]) {
    assert.throws(() => declaredIntakeLifecycle(value), /^Error: INTAKE_DECLARED_MAPPING_INVALID; source values withheld\.$/);
  }
  assert.equal(read, false);
  const old = process.env.LMPS_ENVIRONMENT;
  try { process.env.LMPS_ENVIRONMENT = 'production'; assert.throws(() => declaredIntakeLifecycle(input('OK', '0'))); }
  finally { if (old === undefined) delete process.env.LMPS_ENVIRONMENT; else process.env.LMPS_ENVIRONMENT = old; }
});
