import assert from 'node:assert/strict';
import { createSecretKey, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createAccountIdentityResolver, createLocalIdentityKeyProvider } from '../dist/index.js';
import { identityMapping, identityInput, identityProvider } from '../fixtures/account-identity.mjs';

const reason = result => { assert.equal(result.account.status, 'unresolved'); assert.equal(result.source_identity_verified, false); return result.account.reason_code; };
test('sanitized golden vector pins the token algorithm and full mapping digest independently of execution order', async () => {
  const golden = JSON.parse(readFileSync(new URL('../fixtures/account-identity-golden.json', import.meta.url), 'utf8'));
  assert.equal(golden.synthetic_only, true);
  const m = identityMapping(), reordered = Object.fromEntries(Object.entries(m).reverse());
  reordered.key = Object.fromEntries(Object.entries(m.key).reverse());
  for (const mapping of [m, reordered]) {
    const result = await createAccountIdentityResolver([mapping], identityProvider().provider).resolve('local_synthetic', identityInput());
    assert.equal(result.mapping_sha256, golden.mapping_sha256_words.join(''));
    assert.equal(result.account.account_token, 'synthetic_token_' + golden.token_hex_words.join(''));
  }
});
test('token is deterministic for the exact synthetic account and differs for case and significant leading zeros', async () => {
  const resolver = createAccountIdentityResolver([identityMapping()], identityProvider().provider);
  const first = await resolver.resolve('local_synthetic', identityInput());
  assert.equal(first.account.status, 'resolved'); assert.equal(first.source_identity_verified, false);
  assert.deepEqual(await resolver.resolve('local_synthetic', identityInput()), first);
  assert.match(first.account.account_token, /^synthetic_token_[a-f0-9]{64}$/);
  for (const account_value of ['synthetic_account_001', 'synthetic_Account_0001']) {
    const next = await resolver.resolve('local_synthetic', { ...identityInput(), account_value });
    assert.equal(next.account.status, 'resolved'); assert.notEqual(next.account.account_token, first.account.account_token);
  }
  assert.ok(!JSON.stringify(first).includes(identityInput().account_value));
});
test('namespace, institution, mapping version and key version isolate tokens without cross-version aliases', async () => {
  const m = identityMapping(), first = await createAccountIdentityResolver([m], identityProvider(m).provider).resolve('local_synthetic', identityInput());
  for (const change of [{ namespace: 'synthetic_other' }, { owning_institution_id: 'synthetic_bank_b' }, { version: 'synthetic_mapping_v2' }, { key: { ...m.key, version: 'synthetic_key_v2' } }]) {
    const mapping = { ...m, ...change }, input = { ...identityInput(), namespace: mapping.namespace, owning_institution_id: mapping.owning_institution_id, mapping_version: mapping.version };
    const result = await createAccountIdentityResolver([mapping], identityProvider(mapping).provider).resolve('local_synthetic', input);
    assert.equal(result.account.status, 'resolved'); assert.notEqual(result.account.account_token, first.account.account_token);
    assert.notEqual(result.mapping_sha256, first.mapping_sha256);
  }
});
test('declared mapping is immutable within a resolver and duplicate/conflicting mapping identities reject at construction', async () => {
  const m = identityMapping(), resolver = createAccountIdentityResolver([m], identityProvider(m).provider);
  const first = await resolver.resolve('local_synthetic', identityInput()); m.key.version = 'synthetic_changed'; m.stability = 'unverified';
  assert.deepEqual(await resolver.resolve('local_synthetic', identityInput()), first);
  assert.throws(() => createAccountIdentityResolver([identityMapping(), identityMapping()], identityProvider().provider));
  assert.throws(() => createAccountIdentityResolver([identityMapping(), { ...identityMapping(), key: m.key }], identityProvider().provider));
  assert.throws(() => createAccountIdentityResolver(Array(33).fill(identityMapping()), identityProvider().provider));
});
test('rotation keeps versions explicit; revoking the old key does not relink accounts or disable the replacement key', async () => {
  const oldMapping = identityMapping(), newMapping = { ...identityMapping(), version: 'synthetic_mapping_v2', key: { ...oldMapping.key, version: 'synthetic_key_v2' } };
  const keys = createLocalIdentityKeyProvider([
    { key: oldMapping.key, material: createSecretKey(Buffer.alloc(32)) },
    { key: newMapping.key, material: createSecretKey(Buffer.alloc(32, 1)) },
  ]);
  const resolver = createAccountIdentityResolver([oldMapping, newMapping], keys.provider);
  const first = await resolver.resolve('local_synthetic', identityInput());
  const input = { ...identityInput(), mapping_version: newMapping.version }, next = await resolver.resolve('local_synthetic', input);
  assert.equal(first.account.status, 'resolved'); assert.equal(next.account.status, 'resolved');
  assert.notEqual(first.account.account_token, next.account.account_token);
  keys.revoke(oldMapping.key);
  assert.equal(reason(await resolver.resolve('local_synthetic', identityInput())), 'IDENTITY_KEY_UNAVAILABLE');
  assert.deepEqual(await resolver.resolve('local_synthetic', input), next);
});
test('real provenance, masked/unknown values, missing identities and unmapped scopes never call the key provider', async () => {
  let calls = 0; const provider = { async mac() { calls++; throw Error('PRIVATE'); } };
  const resolver = createAccountIdentityResolver([identityMapping()], provider);
  assert.equal(reason(await resolver.resolve('user_supplied_file', identityInput())), 'STABLE_IDENTITY_UNVERIFIED');
  const getter = {}; Object.defineProperty(getter, 'account_value', { get() { throw Error('must not inspect'); } });
  assert.equal(reason(await resolver.resolve('user_supplied_file', getter)), 'STABLE_IDENTITY_UNVERIFIED');
  for (const source_representation of ['masked', 'unknown']) assert.equal(reason(await resolver.resolve('local_synthetic', { ...identityInput(), source_representation })), 'IDENTITY_REPRESENTATION_UNVERIFIED');
  for (const account_value of [null, '']) assert.equal(reason(await resolver.resolve('local_synthetic', { ...identityInput(), account_value })), 'IDENTITY_VALUE_MISSING');
  for (const account_value of ['123456', ' synthetic_account_0001', 'synthetic_account_0001 ', '***0001']) assert.equal(reason(await resolver.resolve('local_synthetic', { ...identityInput(), account_value })), 'IDENTITY_INPUT_INVALID');
  assert.equal(reason(await resolver.resolve('local_synthetic', { ...identityInput(), namespace: 'synthetic_other' })), 'IDENTITY_MAPPING_UNAVAILABLE');
  assert.equal(reason(await resolver.resolve('local_synthetic', { ...identityInput(), extra: 'private' })), 'IDENTITY_INPUT_INVALID');
  assert.equal(reason(await createAccountIdentityResolver([{ ...identityMapping(), stability: 'unverified' }], provider).resolve('local_synthetic', identityInput())), 'STABLE_IDENTITY_UNVERIFIED');
  assert.equal(calls, 0);
});
test('key outage, revocation, wrong key metadata and malformed digests withhold tokens and redact provider diagnostics', async () => {
  const local = identityProvider(), resolver = createAccountIdentityResolver([identityMapping()], local.provider);
  assert.equal((await resolver.resolve('local_synthetic', identityInput())).account.status, 'resolved'); local.revoke(identityMapping().key);
  assert.equal(reason(await resolver.resolve('local_synthetic', identityInput())), 'IDENTITY_KEY_UNAVAILABLE');
  for (const mac of [() => { throw Error('PRIVATE_KEY_OR_ACCOUNT'); }, async () => null, async () => ({ key: identityMapping().key, status: 'revoked', digest: new Uint8Array(32) }),
    async () => ({ key: { ...identityMapping().key, version: 'synthetic_wrong' }, status: 'active', digest: new Uint8Array(32) }),
    async () => ({ key: identityMapping().key, status: 'active', digest: 'PRIVATE' }),
    async () => ({ key: identityMapping().key, status: 'active', digest: new Uint8Array(31) })]) {
    const result = await createAccountIdentityResolver([identityMapping()], { mac }).resolve('local_synthetic', identityInput());
    assert.equal(reason(result), 'IDENTITY_KEY_UNAVAILABLE'); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});
test('provider deadline bounds the caller, aborts ignored work and discards late output without returning a token', async () => {
  let captured, finish;
  const resolver = createAccountIdentityResolver([identityMapping()], { mac(input) { captured = input; return new Promise(resolve => { finish = resolve; }); } }, 25);
  const result = await resolver.resolve('local_synthetic', identityInput());
  assert.equal(reason(result), 'IDENTITY_KEY_TIMEOUT'); assert.equal(captured.signal.aborted, true);
  assert.ok(captured.message.every(byte => byte === 0));
  finish({ key: identityMapping().key, status: 'active', digest: new Uint8Array(32) });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(result.account.status, 'unresolved');
});
test('local key adapter rejects weak/non-secret keys, duplicate versions and unsupported modes', async () => {
  const key = identityMapping().key;
  for (const material of [createSecretKey(Buffer.alloc(16)), generateKeyPairSync('ed25519').privateKey, Buffer.alloc(32)]) assert.throws(() => createLocalIdentityKeyProvider([{ key, material }]));
  assert.throws(() => createLocalIdentityKeyProvider([{ key, material: createSecretKey(Buffer.alloc(32)) }, { key, material: createSecretKey(Buffer.alloc(32)) }]));
  for (const timeout of [0, -1, 2001, 1.5]) assert.throws(() => createAccountIdentityResolver([], identityProvider().provider, timeout));
  const resolver = createAccountIdentityResolver([identityMapping()], identityProvider().provider), prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(reason(await resolver.resolve('local_synthetic', identityInput())), 'IDENTITY_CONTEXT_UNSUPPORTED');
    assert.throws(() => identityProvider()); assert.throws(() => createAccountIdentityResolver([], { mac() {} }));
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});
