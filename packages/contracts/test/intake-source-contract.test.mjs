import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intakeSourceFacts } from '../dist/intake-source-contract.js';

const row = () => ['1', '2026-10-01 12:00:00', '1000000.00', 'LAK', 'OK', '2026-10-01 12:00:01'];
test('six-column contract preserves exact money and distinguishes every unmapped result', () => {
  for (const [result, expected] of [['OK', 'succeeded'], ['TRANSACTION_FAILED', 'failed'], [null, 'unknown'], ['', 'unknown'], ['ok', 'unknown'], [' OK', 'unknown'], ['REVERSED', 'unknown'], ['ERROR', 'unknown'], ['LMPS PAYMENT TIME IS EXPIRE', 'unknown']]) {
    const values = row(); values[4] = result;
    const facts = intakeSourceFacts(values);
    assert.equal(facts.transaction_status, expected);
    assert.equal(facts.amount, '1000000.00'); assert.equal(facts.currency, 'LAK');
    assert.equal(facts.occurred_at, null); assert.equal(facts.account_identity, 'unverified');
    assert.equal(facts.source_semantics, 'unverified');
  }
});
test('invalid source values are rejected with value-free errors and no currency or clock guessing', () => {
  for (const values of [null, row().slice(1), [...row(), 'extra'], ...[
    [2, '-1.00'], [2, '1e6'], [2, '100.001'], [3, 'lak'], [3, '001'], [5, '2026-02-30 12:00:01'],
  ].map(([index, value]) => { const v = row(); v[index] = value; return v; })]) {
    assert.throws(() => intakeSourceFacts(values), /^Error: INTAKE_SOURCE_CONTRACT_INVALID; source values withheld\.$/);
  }
});
test('Intake test mapping is unavailable in production mode', () => {
  const before = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; assert.throws(() => intakeSourceFacts(row())); }
  finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
});
