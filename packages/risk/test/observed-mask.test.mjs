import assert from 'node:assert/strict';
import test from 'node:test';
import { observedMaskKey, observedMaskTime, referenceObservedWindow, OBSERVED_MASK_SOURCE_PROFILE } from '../dist/index.js';

test('bank+exact representation groups are run-private and never claim verified account identity', () => {
  const key = Buffer.alloc(32, 7), input = { bank: 'SYN_BANK_A', representation: 'SYN_MASK_***001' };
  const first = observedMaskKey(input, key);
  assert.deepEqual(first, observedMaskKey({ ...input }, key));
  assert.equal(first.identity_status, 'unverified'); assert.equal(first.real_account_claim, false);
  assert.notEqual(first.observed_key, observedMaskKey({ ...input, bank: 'SYN_BANK_B' }, key).observed_key);
  assert.notEqual(first.observed_key, observedMaskKey({ ...input, representation: 'SYN_MASK_***002' }, key).observed_key);
  assert.notEqual(first.observed_key, observedMaskKey(input, Buffer.alloc(32, 8)).observed_key);
  assert.equal(observedMaskKey({ bank: input.bank, representation: input.representation }, key).observed_key, first.observed_key);
  assert.ok(!JSON.stringify(first).includes(input.representation));
  assert.ok(Object.isFrozen(OBSERVED_MASK_SOURCE_PROFILE.windows_seconds));
  // Two different real accounts with the same mask would still be this one observed group.
  assert.equal(observedMaskKey(input, key).observed_key, first.observed_key);
});

test('Vientiane conversion validates calendar syntax and preserves one-second boundaries', () => {
  assert.equal(new Date(observedMaskTime('2026-10-01 00:00:00') * 1000).toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(observedMaskTime('2026-10-01 00:05:00') - observedMaskTime('2026-10-01 00:00:00'), 300);
  for (const value of ['2026-02-30 00:00:00', '2026-10-01 24:00:00', '2026-10-01T00:00:00Z', '2026-10-01 00:00:00\n']) assert.throws(() => observedMaskTime(value));
});

test('rolling reference excludes the lower boundary, includes all same-second rows, and keeps warmup unavailable', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), start = observedMaskTime('2026-10-01 00:00:00');
  const e = (ordinal, offset, sender, receiver, amount = '1.00') => ({ ordinal, occurred_unix: start + offset, sender, receiver, amount });
  const events = [e(0, 300, a, b, '50.00'), e(1, 301, a, c, '2.00'), e(2, 600, a, b, '3.00'), e(3, 600, c, b, '4.00'), e(4, 600, a, c, '5.00'), e(5, 601, a, b, '20.00')];
  const request = { events, anchor: 2, window_seconds: 300, scope_start: start };
  const result = referenceObservedWindow(request);
  assert.deepEqual(result.metrics, { FRAUD_COUNT_VELOCITY: '3', FRAUD_AMOUNT_VELOCITY: '10.00', MULE_FAN_OUT: '2', MULE_FAN_IN: '2' });
  assert.deepEqual(result, referenceObservedWindow({ ...request, events: [...events].reverse() }));
  assert.equal(referenceObservedWindow({ ...request, anchor: 0, window_seconds: 900 }).status, 'warmup_withheld');
  assert.equal(result.identity_status, 'unverified');
});

test('bad namespaces, blank representations, accessors and production are refused with fixed diagnostics', () => {
  const key = Buffer.alloc(32, 7); let invoked = false;
  const bad = { bank: 'SYN' }; Object.defineProperty(bad, 'representation', { enumerable: true, get() { invoked = true; return 'PRIVATE'; } });
  for (const input of [bad, null, {}, { bank: '', representation: 'SYN' }, { bank: 'SYN', representation: '\ufeff' }, { bank: 'SYN', representation: 'PRIVATE\nVALUE' }]) {
    assert.throws(() => observedMaskKey(input, key), /^Error: OBSERVED_MASK_INVALID; source values withheld\.$/);
  }
  assert.equal(invoked, false);
  const old = process.env.LMPS_ENVIRONMENT;
  try { process.env.LMPS_ENVIRONMENT = 'production'; assert.throws(() => observedMaskTime('2026-10-01 00:00:00')); }
  finally { if (old === undefined) delete process.env.LMPS_ENVIRONMENT; else process.env.LMPS_ENVIRONMENT = old; }
});
