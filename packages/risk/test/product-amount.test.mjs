import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProductAmount, LAK_PRODUCT_AMOUNT_PROFILE } from '../dist/index.js';

test('exact decimal bands preserve equality at 20/100/180/200 million and separate above-cap values', () => {
  for (const [amount, band] of [['-0.01', 'nonpositive_withheld'], ['0.00', 'nonpositive_withheld'], ['0.01', 'below_review'], ['19999999.99', 'below_review'], ['20000000.00', 'review'], ['99999999.99', 'review'], ['100000000.00', 'high'], ['179999999.99', 'high'], ['180000000.00', 'near_cap'], ['200000000.00', 'near_cap'], ['200000000.01', 'above_cap'], ['9999999999999999999999.99', 'above_cap']]) {
    const r = classifyProductAmount({ amount, currency: 'LAK' });
    assert.equal(r.band, band);
    assert.equal(r.product_scope, 'unverified');
    assert.equal(r.amount_units, 'unverified');
    assert.equal(r.enforcement, false);
    assert.equal(r.candidate_only, true);
  }
  assert.equal(classifyProductAmount({ amount: '200000000.01', currency: 'THB' }).band, 'currency_out_of_scope');
  assert.ok(Object.isFrozen(LAK_PRODUCT_AMOUNT_PROFILE));
  assert.ok(Object.isFrozen(LAK_PRODUCT_AMOUNT_PROFILE.backtest_thresholds));
});

test('untrusted monetary input is not coerced or echoed', () => {
  let invoked = false;
  const value = { currency: 'LAK' };
  Object.defineProperty(value, 'amount', { enumerable: true, get() { invoked = true; return 'PRIVATE'; } });
  for (const input of [value, null, [], {}, { amount: 200000000, currency: 'LAK' }, { amount: '2e8', currency: 'LAK' }, { amount: '020000000.00', currency: 'LAK' }, { amount: '200000000.001', currency: 'LAK' }, { amount: '1.00', currency: 'LAK', extra: 'PRIVATE' }]) {
    assert.throws(() => classifyProductAmount(input), /^Error: PRODUCT_AMOUNT_INVALID; source values withheld\.$/);
  }
  assert.equal(invoked, false);
});
