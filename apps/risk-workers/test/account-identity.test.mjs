import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTransaction } from '@lmps/contracts';
import { makeSourcePublication } from '@lmps/contracts/source-publication';
import { createAccountIdentityResolver, evaluateTransactionRisk, riskHash } from '@lmps/risk';
import { identityMapping, identityInput, identityProvider } from '../../../packages/risk/fixtures/account-identity.mjs';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';
import { publicationFixture } from '../../../packages/contracts/fixtures/synthetic-publication.mjs';
import { resolveWorkerTransactionIdentity } from '../dist/account-identity.js';

function fixture() {
  const { transaction, publication } = publicationFixture();
  return { publication, evidence: { binding: { transaction_id: transaction.transaction_id,
    transaction_revision: transaction.transaction_revision, source_namespace: transaction.source_reference.namespace, record_ref: transaction.source_reference.record_ref, publication_sha256: riskHash(publication) },
    sender: identityInput(), receiver: { ...identityInput(), account_value: 'synthetic_account_0002' } } };
}
const resolver = () => createAccountIdentityResolver([identityMapping()], identityProvider().provider);
test('worker enriches only exact synthetic revision evidence, producing a valid transaction without altering caller data or inventing history/time', async () => {
  const input = fixture(), before = structuredClone(input), output = await resolveWorkerTransactionIdentity(input, resolver());
  assert.equal(isTransaction(output.transaction), true); assert.deepEqual(input, before);
  assert.equal(output.transaction.sender.status, 'resolved'); assert.equal(output.transaction.receiver.status, 'resolved');
  assert.notEqual(output.transaction.sender.account_token, output.transaction.receiver.account_token);
  assert.equal(output.transaction.occurred_at, null); assert.equal(output.source_identity_verified, false);
  const { request, observation } = riskFixture(); request.context = null;
  assert.ok(evaluateTransactionRisk(request, observation).findings.slice(1).every(f => f.status === 'unavailable'));
  input.evidence.receiver = identityInput();
  const same = await resolveWorkerTransactionIdentity(input, resolver());
  assert.equal(same.transaction.sender.account_token, same.transaction.receiver.account_token);
});
test('stale revision, foreign source reference and missing evidence never invoke a resolver or retain preexisting resolved accounts', async () => {
  let calls = 0; const provider = { async resolve() { calls++; throw Error('PRIVATE'); } };
  for (const change of [v => { v.evidence = null; }, ...['transaction_id', 'transaction_revision', 'source_namespace', 'record_ref', 'publication_sha256'].map(key => v => { v.evidence.binding[key] = 'synthetic_foreign'; })]) {
    const input = fixture(); change(input);
    const result = await resolveWorkerTransactionIdentity(input, provider);
    assert.equal(result.transaction.sender.status, 'unresolved'); assert.equal(result.transaction.receiver.status, 'unresolved');
  }
  const enriched = await resolveWorkerTransactionIdentity(fixture(), resolver());
  await assert.rejects(resolveWorkerTransactionIdentity({ ...fixture(), transaction: enriched.transaction }, provider));
  const changed = fixture(); changed.publication.normalization_input.amount = '2.00';
  assert.equal((await resolveWorkerTransactionIdentity(changed, provider)).transaction.sender.status, 'unresolved');
  assert.equal(calls, 0);
});
test('actual six-column publication boundary stays unresolved even if supplied synthetic identity evidence', async () => {
  const { publication } = makeSourcePublication({ workspace: 'synthetic_local', namespace: 'synthetic_csv', generation: '00000000-0000-4000-8000-000000000001', batch: '00000000-0000-4000-8000-000000000002',
    dataset_sha256: 'a'.repeat(64), rows_sha256: 'b'.repeat(64), source_namespace: 'lmps_transfer', row_number: 1,
    values: ['1', '2026-10-01 12:00:00', '1000000.00', 'LAK', 'OK', '2026-10-01 12:00:01'], observed_at: '2026-10-02T00:00:00.000Z', expected_revision: 0 });
  const result = await resolveWorkerTransactionIdentity({ ...fixture(), publication }, { resolve() { throw Error('must not run'); } });
  assert.equal(result.transaction.sender.reason_code, 'STABLE_IDENTITY_UNVERIFIED'); assert.equal(result.transaction.receiver.status, 'unresolved');
  assert.equal(result.transaction.occurred_at, null); assert.equal(result.source_identity_verified, false);
  publication.provenance = 'local_synthetic';
  await assert.rejects(resolveWorkerTransactionIdentity({ ...fixture(), publication }, resolver()));
});
test('one missing account or a revoked key withholds only the affected synthetic identity', async () => {
  const input = fixture(); input.evidence.receiver.source_representation = 'masked';
  const result = await resolveWorkerTransactionIdentity(input, resolver());
  assert.equal(result.transaction.sender.status, 'resolved'); assert.equal(result.transaction.receiver.status, 'unresolved');
  const keys = identityProvider(); keys.revoke(identityMapping().key);
  const unavailable = await resolveWorkerTransactionIdentity(fixture(), createAccountIdentityResolver([identityMapping()], keys.provider));
  assert.equal(unavailable.transaction.sender.status, 'unresolved'); assert.equal(unavailable.transaction.receiver.status, 'unresolved');
});
test('malformed worker envelopes and unsupported modes fail with redacted diagnostics', async () => {
  for (const input of [null, {}, { ...fixture(), extra: 'PRIVATE' }, { ...fixture(), provenance: 'local_synthetic' }, { ...fixture(), publication: { ...fixture().publication, execution_mode: 'live' } }])
    await assert.rejects(resolveWorkerTransactionIdentity(input, resolver()), /^Error: WORKER_IDENTITY_INVALID; private values withheld\.$/);
  const target = resolver(), productionInput = fixture(), prior = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; await assert.rejects(resolveWorkerTransactionIdentity(productionInput, target)); }
  finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});
