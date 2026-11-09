import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { evaluateTransactionRisk, riskHash, validateRiskRequest } from '@lmps/risk';
import { createTransactionRisks, riskObservation, validateFrozenTransactionRisk } from '../dist/index.js';
import { transactionRiskFixture } from './fixtures/transaction-risk.mjs';
import { makeSourcePublication } from '@lmps/contracts/source-publication';
import { validateTransactionRevision } from '../dist/transaction-revisions.js';
import { observationMatchesRevision } from '../dist/transaction-risks.js';

test('unnormalized file observations retain their exact legacy envelope binding without accepting corruption', () => {
  const projected=makeSourcePublication({workspace:'synthetic_local',namespace:'synthetic_csv',generation:randomUUID(),batch:randomUUID(),
    dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),source_namespace:'lmps_transfer',row_number:1,
    values:['1','2026-11-03 00:00:00','1.00','LAK','ERROR','2026-11-03 00:00:01'],observed_at:'2026-11-04T00:00:00.000Z',expected_revision:0});
  const raw={format:1,provenance:'local_synthetic',execution_mode:'test',workspace_key:'synthetic_local',expected_revision:0,...projected};
  const target={namespace:'synthetic_csv',transaction_id:raw.transaction.transaction_id,revision_number:1};
  const observation=riskObservation(target,raw),canonical=validateTransactionRevision(raw);
  assert.equal(observation.status,'not_normalized');
  assert.notEqual(observation.revision_sha256,riskHash(canonical));
  assert.equal(observationMatchesRevision(observation,canonical),true);
  for(const change of [o=>o.revision_sha256='f'.repeat(64),o=>o.amount='1.00',o=>o.status='invalid']){
    const corrupt=structuredClone(observation);change(corrupt);assert.equal(observationMatchesRevision(corrupt,canonical),false);
  }
  const changed=structuredClone(canonical);changed.transaction.amount='2.00';
  assert.equal(observationMatchesRevision(observation,changed),false);
  const f=transactionRiskFixture();
  assert.equal(observationMatchesRevision(f.observation,f.revision),true);
  assert.equal(observationMatchesRevision({...f.observation,revision_sha256:riskHash({...f.revision,provenance:'user_supplied_file'})},f.revision),false);
});

async function driver(t, handle) {
  const calls = [], client = { async query(sql, args) { calls.push(sql); return handle(sql, args); }, release() {} };
  const connect = t.mock.method(pg.Pool.prototype, 'connect', async () => client);
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = 'lmps_intake'; url.password = randomUUID();
  const repo = createTransactionRisks(url.toString()); t.after(() => repo.close()); return { repo, calls, connect };
}
test('one risk run freezes source features, scores and policy; driver rolls back policy registration on downstream failure', async t => {
  const f = transactionRiskFixture(); let fail = false; const policy = validateRiskRequest(f.request).policy;
  const { repo, calls } = await driver(t, async sql => {
    if (sql.includes('SELECT payload,publication')) return { rows: [{ payload: f.revision.transaction, publication: f.revision.publication }] };
    if (sql.startsWith('SELECT policy,')) return { rows: [{ policy, policy_sha256: riskHash(policy) }] };
    if (fail && sql.includes('INSERT INTO platform.local_transaction_risks')) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    return { rows: [] };
  });
  const first = await repo.evaluate(f.request); assert.equal(first.status, 'inserted'); assert.deepEqual(first.result, evaluateTransactionRisk(f.request, f.observation));
  assert.equal(first.result.risk_types.length, 15); assert.equal(calls.at(-1), 'COMMIT'); calls.length = 0; fail = true;
  await assert.rejects(repo.evaluate(f.request), e => e.code === 'RISK_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE'));
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(!calls.includes('COMMIT'));
});
test('frozen replay does not re-read mutable source; changed manifest and policy version conflicts reject', async t => {
  const f = transactionRiskFixture(); const request = validateRiskRequest(f.request), observation = f.observation;
  const snapshot = { request, observation, result: evaluateTransactionRisk(request, observation) }; let saved = true;
  const { repo, calls } = await driver(t, async sql => {
    if (saved && sql.startsWith('SELECT snapshot,')) return { rows: [{ snapshot, snapshot_sha256: riskHash(snapshot) }] };
    if (sql.includes('SELECT payload,publication')) return { rows: [{ payload: f.revision.transaction, publication: f.revision.publication }] };
    if (sql.startsWith('SELECT policy,')) { const policy = structuredClone(request.policy); policy.window_seconds = 10; return { rows: [{ policy, policy_sha256: riskHash(policy) }] }; }
    return { rows: [] };
  });
  assert.equal((await repo.evaluate(request)).status, 'duplicate'); assert.ok(calls.every(sql => !sql.includes('local_transaction_revisions')));
  const changed = structuredClone(request); changed.policy.minimum_amount = '501.00';
  await assert.rejects(repo.evaluate(changed), e => e.code === 'RISK_RUN_CONFLICT');
  saved = false; await assert.rejects(repo.evaluate({ ...request, run_id: randomUUID() }), e => e.code === 'RISK_POLICY_CONFLICT');
});
test('stored risk validation detects rehashed corruption and rejects extra/private data', () => {
  const f = transactionRiskFixture(), request = validateRiskRequest(f.request), observation = f.observation;
  const snapshot = { request, observation, result: evaluateTransactionRisk(request, observation) };
  assert.deepEqual(validateFrozenTransactionRisk(snapshot, riskHash(snapshot)), snapshot);
  for (const change of [s => { s.result.fraud_score.value = 0; }, s => { s.result.extra = 'SYNTHETIC_PRIVATE_VALUE'; }, s => { s.observation.extra = 'SYNTHETIC_PRIVATE_VALUE'; }, s => { s.request.context.events[0].amount = '999.00'; }]) {
    const bad = structuredClone(snapshot); change(bad); assert.throws(() => validateFrozenTransactionRisk(bad, riskHash(bad)), /RISK_STORAGE_UNAVAILABLE/);
  }
  assert.throws(() => validateFrozenTransactionRisk(snapshot, '0'.repeat(64)));
});
test('source proof is checked and corrupt raw values are withheld; invalid input rejects before a connection', async t => {
  const f = transactionRiskFixture();
  assert.equal(f.observation.status, 'available');
  const corrupt = structuredClone(f.revision); corrupt.publication.normalization_input.status_code = 'SYNTHETIC_PRIVATE_VALUE';
  const unavailable = riskObservation(f.request.target, corrupt); assert.equal(unavailable.status, 'invalid'); assert.equal(unavailable.amount, null);
  assert.ok(!JSON.stringify(unavailable).includes('PRIVATE'));
  assert.equal(riskObservation(f.request.target, null).status, 'missing');
  const { repo, connect } = await driver(t, async () => { throw new Error('Must not query'); });
  await assert.rejects(repo.evaluate({ ...f.request, execution_mode: 'live' }), e => e.code === 'RISK_INPUT_INVALID'); assert.equal(connect.mock.calls.length, 0);
});
