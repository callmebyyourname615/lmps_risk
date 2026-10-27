import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRisks, createTransactionRevisions, validateFrozenTransactionRisk } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { transactionRiskFixture } from './fixtures/transaction-risk.mjs';
import { evaluateTransactionRisk, riskHash } from '@lmps/risk';

let temporary, state, owner, reader, intake, writer, repository, f;
const count = async table => (await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-risk-native-'); state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state)); intake = createDatabase(dsn(state, 'intake'), 'intake');
  writer = createTransactionRevisions(dsn(state, 'intake')); repository = createTransactionRisks(dsn(state, 'intake'));
});
beforeEach(async () => {
  await owner.pool.query('TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies,platform.local_transaction_revisions');
  f = transactionRiskFixture(); await writer.append(f.revision);
});
after(async () => {
  await repository?.close(); await writer?.close(); await reader?.close(); await intake?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
test('concurrent same-run retries store exactly one frozen per-transaction result and policy', async () => {
  const results = await Promise.all([repository.evaluate(f.request), repository.evaluate(f.request)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['duplicate', 'inserted']); assert.deepEqual(results[0].result, results[1].result);
  assert.equal(results[0].result.risk_types.length, 15); assert.equal(results[0].result.fraud_score.value, 1);
  assert.equal(await count('local_transaction_risks'), 1); assert.equal(await count('local_risk_policies'), 1);
  const saved = (await reader.pool.query('SELECT snapshot,snapshot_sha256 FROM platform.local_transaction_risks')).rows[0];
  assert.deepEqual(validateFrozenTransactionRisk(saved.snapshot, saved.snapshot_sha256).result, results[0].result);
  for (const table of ['source_events', 'audit_events', 'local_outbox_intents', 'local_sync_jobs']) assert.equal(await count(table), 0);
});
test('changed run manifests and immutable policy versions conflict; a new policy version can be stored', async () => {
  await repository.evaluate(f.request);
  const changed = structuredClone(f.request); changed.policy.minimum_amount = '501.00';
  await assert.rejects(repository.evaluate(changed), e => e.code === 'RISK_RUN_CONFLICT'); changed.run_id = randomUUID();
  await assert.rejects(repository.evaluate(changed), e => e.code === 'RISK_POLICY_CONFLICT');
  assert.equal(await count('local_transaction_risks'), 1); assert.equal(await count('local_risk_policies'), 1);
  changed.policy.version = 'synthetic_v2'; assert.equal((await repository.evaluate(changed)).status, 'inserted');
  assert.equal(await count('local_risk_policies'), 2);
});
test('separate concurrent runs cannot register different content under the same policy version', async () => {
  const other = structuredClone(f.request); other.run_id = randomUUID(); other.policy.minimum_amount = '501.00';
  const results = await Promise.allSettled([repository.evaluate(f.request), repository.evaluate(other)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'RISK_POLICY_CONFLICT');
  assert.equal(await count('local_transaction_risks'), 1);
});
test('frozen replay keeps its original scores if source disappears; a new run records unavailable inputs', async () => {
  const original = await repository.evaluate(f.request); await owner.pool.query('TRUNCATE platform.local_transaction_revisions');
  assert.deepEqual((await repository.evaluate(f.request)).result, original.result);
  const missing = await repository.evaluate({ ...f.request, run_id: randomUUID() }); assert.equal(missing.result.fraud_score.value, null);
  assert.equal(missing.result.assessment_status, 'unavailable'); assert.ok(missing.result.findings.every(f => f.reason_code === 'INPUT_MISSING'));
});
test('reader and intake cannot mutate history, spoof recording identity or bypass policy linkage', async () => {
  await repository.evaluate(f.request);
  for (const table of ['local_risk_policies', 'local_transaction_risks']) for (const db of [reader, intake])
    for (const sql of [`UPDATE platform.${table} SET workspace_key='synthetic_other'`, `DELETE FROM platform.${table}`, `TRUNCATE platform.${table}`])
      await assert.rejects(db.pool.query(sql), e => e.code === '42501');
  await assert.rejects(intake.pool.query("INSERT INTO platform.local_risk_policies(workspace_key,policy_id,policy_version,policy,policy_sha256,recorded_by) VALUES('synthetic_local','synthetic_bad','synthetic_v1','{}',$1,'spoofed')", ['a'.repeat(64)]), e => e.code === '42501');
  await assert.rejects(reader.pool.query('INSERT INTO platform.local_transaction_risks(workspace_key,run_id,snapshot,snapshot_sha256) SELECT workspace_key,run_id,snapshot,snapshot_sha256 FROM platform.local_transaction_risks'), e => e.code === '42501');
  const snapshot = (await reader.pool.query('SELECT snapshot FROM platform.local_transaction_risks')).rows[0].snapshot;
  snapshot.request.run_id = randomUUID(); snapshot.request.policy.policy_id = 'synthetic_missing_policy';
  snapshot.result = evaluateTransactionRisk(snapshot.request, snapshot.observation);
  await assert.rejects(intake.pool.query(`INSERT INTO platform.local_transaction_risks(workspace_key,run_id,namespace,transaction_id,revision_number,policy_id,policy_version,snapshot,snapshot_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ['synthetic_local', snapshot.request.run_id, f.request.target.namespace, f.request.target.transaction_id, 1,
    'synthetic_missing_policy', f.request.policy.version, JSON.stringify(snapshot), riskHash(snapshot)]), e => e.code === '23503');
});
test('assessment insert failure rolls back a new policy and outage recovery allows safe replay', async () => {
  await owner.pool.query("CREATE FUNCTION platform.synthetic_fail_risk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_VALUE'; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_fail_risk BEFORE INSERT ON platform.local_transaction_risks FOR EACH ROW EXECUTE FUNCTION platform.synthetic_fail_risk()');
  try {
    await assert.rejects(repository.evaluate(f.request), e => e.code === 'RISK_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE'));
    assert.equal(await count('local_risk_policies'), 0);
  } finally { await owner.pool.query('DROP TRIGGER synthetic_fail_risk ON platform.local_transaction_risks'); await owner.pool.query('DROP FUNCTION platform.synthetic_fail_risk()'); }
  await stopCluster(state); try { await assert.rejects(repository.evaluate(f.request), e => e.code === 'RISK_STORAGE_UNAVAILABLE'); } finally { await startCluster(state); }
  assert.equal((await repository.evaluate(f.request)).status, 'inserted');
});
