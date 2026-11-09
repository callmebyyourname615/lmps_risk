import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATASET_MAX_ROWS } from '@lmps/contracts/offline-dataset';
import { evaluateTransactionRisk, RISK_CATALOG } from '@lmps/risk';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';
import { analyzeIntakeSourceContract } from '../dist/intake-source-contract.js';

const row = (id = 1, ccy = 'LAK', result = 'OK', amount = '1000000.00') => [String(id), '2026-10-01 12:00:00', amount, ccy, result, '2026-10-01 12:00:01'];
const policy = () => { const p = riskFixture().request.policy; p.currency = 'LAK'; return p; };
const high = report => report.patterns.find(p => p.code === 'FRAUD_HIGH_AMOUNT');

test('222 invented rows: 214 amount-test candidates, one failed payment, seven currencies awaiting policy; no fabricated contextual capability', () => {
  const rows = Array.from({ length: 222 }, (_, i) => row(i + 1, i < 215 ? 'LAK' : 'THB', i === 214 ? 'TRANSACTION_FAILED' : 'OK'));
  const report = analyzeIntakeSourceContract(rows, policy());
  assert.equal(report.source_rows, 222);
  assert.deepEqual(report.currencies, [
    { currency: 'LAK', rows: 215, lifecycle: { succeeded: 214, failed: 1, unknown: 0 } },
    { currency: 'THB', rows: 7, lifecycle: { succeeded: 7, failed: 0, unknown: 0 } },
  ]);
  assert.deepEqual(high(report).counts, { eligible_for_test: 214, waiting_policy: 7, unavailable: 0, not_applicable: 1, disabled: 0 });
  assert.equal(report.patterns.length, RISK_CATALOG.length);
  for (const pattern of report.patterns.slice(1)) {
    assert.equal(pattern.counts.eligible_for_test, 0); assert.equal(pattern.counts.unavailable, 214);
    assert.ok(pattern.source_blockers.includes('ACCOUNT_IDENTITY_UNVERIFIED'));
    assert.equal(Object.values(pattern.counts).reduce((a, b) => a + b, 0), 222);
  }
  assert.equal(report.production_ready_patterns, 0); assert.equal(report.assessment_performed, false);
  assert.equal(report.enforcement, false); assert.equal(report.operational_alerts_created, false);
  assert.equal(report.policy.authority, 'caller_supplied_test_only');
});

test('missing policy, literal unknown codes, zero execution and disabled rules remain distinct', () => {
  assert.equal(high(analyzeIntakeSourceContract([row()])).counts.waiting_policy, 1);
  for (const result of [null, '', 'ok', ' OK', 'REVERSED', 'ERROR', 'LMPS PAYMENT TIME IS EXPIRE']) {
    const report = analyzeIntakeSourceContract([row(1, 'LAK', result)], policy());
    assert.equal(high(report).counts.unavailable, 1);
    assert.ok(high(report).reason_codes.includes('LIFECYCLE_CODE_UNMAPPED'));
  }
  assert.equal(high(analyzeIntakeSourceContract([row(1, 'LAK', 'OK', '0.00')], policy())).counts.not_applicable, 1);
  const p = policy(); p.rules.find(r => r.code === 'FRAUD_HIGH_AMOUNT').enabled = false;
  assert.equal(high(analyzeIntakeSourceContract([row()], p)).counts.disabled, 1);
});

test('eligibility agrees with the actual context-free risk engine for supported test lifecycle and currency scopes', () => {
  for (const [ccy, result, amount] of [['LAK', 'OK', '1000000.00'], ['LAK', 'TRANSACTION_FAILED', '1.00'], ['LAK', 'OK', '0.00'], ['THB', 'OK', '10.00']]) {
    const { request, observation } = riskFixture(); request.context = null; request.policy = policy();
    Object.assign(observation, { currency: ccy, transaction_status: result === 'OK' ? 'succeeded' : 'failed', amount });
    const findings = evaluateTransactionRisk(request, observation).findings;
    const report = analyzeIntakeSourceContract([row(1, ccy, result, amount)], request.policy);
    for (const pattern of report.patterns) {
      const status = findings.find(f => f.code === pattern.code).status;
      const expected = ccy !== 'LAK' ? 'waiting_policy' : ['triggered', 'not_triggered'].includes(status) ? 'eligible_for_test' : status;
      assert.equal(pattern.counts[expected], 1, pattern.code);
    }
  }
});

test('duplicate/conflicting full source keys, invalid policies and invalid bounds are rejected without partial reports', () => {
  const bad = { ...policy(), extra: 'private' };
  for (const rows of [[], null, new Array(DATASET_MAX_ROWS + 1), [row(), row()], [row(), row(1, 'LAK', 'OK', '2.00')], [row(), row(2, 'LAK', 'OK', '-1.00')]]) {
    assert.throws(() => analyzeIntakeSourceContract(rows, policy()), /^Error: INTAKE_SOURCE_CONTRACT_INVALID; source values withheld\.$/);
  }
  assert.throws(() => analyzeIntakeSourceContract([row()], bad));
  const a = row(), b = row(); b[1] = '2026-10-02 12:00:00';
  assert.equal(analyzeIntakeSourceContract([a, b], policy()).source_rows, 2);
});

test('aggregate report excludes raw identifiers, amounts, clocks and result codes, and binds exact row bytes', () => {
  const input = row(1723456789, 'LAK', 'PRIVATE_RESULT', '123456789.12');
  const first = analyzeIntakeSourceContract([input], policy());
  const serialized = JSON.stringify(first);
  for (const privateValue of [input[0], input[1], input[2], input[4], input[5]]) assert.ok(!serialized.includes(privateValue));
  input[2] = '123456789.13';
  assert.notEqual(analyzeIntakeSourceContract([input], policy()).rows_sha256, first.rows_sha256);
  assert.deepEqual(first, analyzeIntakeSourceContract([row(1723456789, 'LAK', 'PRIVATE_RESULT', '123456789.12')], policy()));
});
