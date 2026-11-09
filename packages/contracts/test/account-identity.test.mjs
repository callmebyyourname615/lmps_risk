import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detachIdentityJSON, validateIdentityInput, validateIdentityMapping, unresolvedIdentityAccount } from '../dist/account-identity.js';

const mapping = () => ({ version: 'synthetic_v1', namespace: 'synthetic_accounts', owning_institution_id: 'synthetic_bank',
  stability: 'synthetic_declared', source_representation: 'unmasked', canonicalization: 'exact_utf8', key: { id: 'synthetic_key', version: 'synthetic_v1' } });
const input = () => ({ mapping_version: 'synthetic_v1', namespace: 'synthetic_accounts', owning_institution_id: 'synthetic_bank', source_representation: 'unmasked', account_value: 'synthetic_0001' });
const invalid = fn => assert.throws(fn, /^Error: IDENTITY_INVALID_INPUT; private values withheld\.$/);

test('identity contracts detach input, preserve exact values and retain unverified/masked states', () => {
  const v = mapping(), result = validateIdentityMapping(v); v.key.version = 'synthetic_changed';
  assert.equal(result.key.version, 'synthetic_v1');
  assert.equal(validateIdentityInput(input()).account_value, 'synthetic_0001');
  for (const source_representation of ['masked', 'unknown']) {
    assert.equal(validateIdentityMapping({ ...mapping(), source_representation, stability: 'unverified' }).source_representation, source_representation);
  }
  assert.equal(validateIdentityInput({ ...input(), account_value: null }).account_value, null);
  assert.deepEqual(unresolvedIdentityAccount(), { status: 'unresolved', source_representation: 'unknown', reason_code: 'STABLE_IDENTITY_UNVERIFIED' });
});
test('strict schema rejects real namespaces, field/key drift, normalization guesses and unknown fields without echoing values', () => {
  for (const change of [{ namespace: 'real_bank' }, { owning_institution_id: '' }, { stability: 'owner_verified' }, { canonicalization: 'trim' },
    { key: { id: 'synthetic_key', version: 'v1' } }, { source_representation: 'full' }, { extra: 'private' }]) invalid(() => validateIdentityMapping({ ...mapping(), ...change }));
  for (const change of [{ mapping_version: null }, { account_value: 123 }, { account_value: 'x'.repeat(201) }, { account_value: 'private\n' }, { extra: true }]) invalid(() => validateIdentityInput({ ...input(), ...change }));
  for (const v of [null, [], true, 'private']) { invalid(() => validateIdentityInput(v)); invalid(() => validateIdentityMapping(v)); }
  invalid(() => unresolvedIdentityAccount('private value'));
});
test('accessors, toJSON, prototypes, cycles, symbols and oversized graphs never reach schema processing', () => {
  let invoked = 0; const accessor = {}; Object.defineProperty(accessor, 'account_value', { enumerable: true, get() { invoked++; throw Error('PRIVATE'); } });
  const cycle = {}; cycle.self = cycle;
  const extraArray = [null]; extraArray.private = true;
  for (const v of [accessor, { toJSON() { invoked++; } }, Object.create(null), cycle, { [Symbol('private')]: true }, new Array(130).fill(null), new Array(3), extraArray, new Date(), Buffer.alloc(32)]) invalid(() => detachIdentityJSON(v));
  assert.equal(invoked, 0);
});
