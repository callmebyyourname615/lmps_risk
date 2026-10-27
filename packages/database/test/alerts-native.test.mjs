import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions, createTransactionRisks, createLocalAlerts, createAlertReviews, readLocalAlert } from '../dist/index.js';
import { riskHash } from '@lmps/risk';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { alertFixture } from './fixtures/alert.mjs';

let temporary, state, owner, reader, intake, reviewer, writer, risks, alerts, reviews, f;
const count = async table => (await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-alert-native-'); state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state));
  intake = createDatabase(dsn(state, 'intake'), 'intake'); reviewer = createDatabase(dsn(state, 'reviewer'), 'reviewer');
  writer = createTransactionRevisions(dsn(state, 'intake')); risks = createTransactionRisks(dsn(state, 'intake'));
  alerts = createLocalAlerts(dsn(state, 'intake')); reviews = createAlertReviews(dsn(state, 'reviewer'));
});
beforeEach(async () => {
  await owner.pool.query('TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies,platform.local_transaction_revisions');
  f = alertFixture(); await writer.append(f.f.revision); await risks.evaluate(f.f.request);
});
after(async () => {
  for (const repo of [reviews, alerts, risks, writer, reader, reviewer, intake, owner]) await repo?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
test('concurrent generation stores one grouped alert, policy and pinned evidence; source changes cannot rewrite it', async () => {
  const result = await Promise.all([alerts.generate(f.generation), alerts.generate(f.generation)]);
  assert.deepEqual(result.map(x => x.status).sort(), ['duplicate', 'inserted']); assert.equal(result[0].alert_id, result[1].alert_id);
  assert.equal(await count('local_alerts'), 1); assert.equal(await count('local_alert_policies'), 1);
  const original = await readLocalAlert(reader.pool, 'synthetic_local', result[0].alert_id); assert.equal(original.snapshot.selected_risk_types.length, 15);
  await owner.pool.query('TRUNCATE platform.local_transaction_revisions');
  assert.deepEqual(await readLocalAlert(reader.pool, 'synthetic_local', result[0].alert_id), original);
  for (const table of ['audit_events', 'local_outbox_intents', 'source_events']) assert.equal(await count(table), 0);
});
test('immutable policy conflicts roll back; a separate version may deliberately create another alert', async () => {
  await alerts.generate(f.generation); const changed = structuredClone(f.generation); changed.policy.minimum_severity = 'medium';
  await assert.rejects(alerts.generate(changed), e => e.code === 'ALERT_POLICY_CONFLICT'); assert.equal(await count('local_alerts'), 1);
  changed.policy.version = 'synthetic_v2'; assert.equal((await alerts.generate(changed)).status, 'inserted');
  const skipped = structuredClone(changed); skipped.policy.version = 'synthetic_v3'; skipped.policy.minimum_severity = 'critical';
  assert.equal((await alerts.generate(skipped)).status, 'skipped'); assert.equal(await count('local_alerts'), 2);
});
test('concurrent acknowledge/review actions cannot overwrite outcomes; retries are exact including actor and note', async () => {
  const generated = await alerts.generate(f.generation), id = generated.alert_id;
  const acknowledgements = [f.ack, { ...f.ack, request_id: randomUUID() }];
  const ackResults = await Promise.allSettled(acknowledgements.map(c => reviews.review('synthetic_local', id, 'synthetic_reviewer', c)));
  assert.equal(ackResults.filter(r => r.status === 'fulfilled').length, 1); assert.equal(ackResults.find(r => r.status === 'rejected').reason.code, 'ALERT_REVIEW_CONFLICT');
  const winner = acknowledgements[ackResults.findIndex(r => r.status === 'fulfilled')];
  assert.equal((await reviews.review('synthetic_local', id, 'synthetic_reviewer', winner)).status, 'duplicate');
  await assert.rejects(reviews.review('synthetic_local', id, 'synthetic_other', winner), e => e.code === 'ALERT_REVIEW_CONFLICT');
  const commands = [f.review, { ...f.review, request_id: randomUUID(), note: 'Another synthetic review.' }];
  const results = await Promise.allSettled(commands.map(c => reviews.review('synthetic_local', id, 'synthetic_reviewer', c)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ALERT_REVIEW_CONFLICT');
  const view = await readLocalAlert(reader.pool, 'synthetic_local', id); assert.equal(view.version, 2); assert.equal(view.outcome, 'unknown');
  assert.equal(await count('local_alert_reviews'), 2);
  const retry = await reviews.review('synthetic_local', id, 'synthetic_reviewer', winner); assert.equal(retry.status, 'duplicate'); assert.equal(retry.view.version, 2);
  await assert.rejects(reviews.review('synthetic_other', id, 'synthetic_reviewer', winner), e => e.code === 'ALERT_NOT_FOUND');
});
test('reader/intake/reviewer cannot bypass the protected review ledger, mutate alerts or spoof recording role', async () => {
  const generated = await alerts.generate(f.generation);
  for (const db of [reader, intake, reviewer]) for (const table of ['local_alert_policies', 'local_alerts', 'local_alert_reviews']) {
    for (const sql of [`UPDATE platform.${table} SET workspace_key='synthetic_other'`, `DELETE FROM platform.${table}`, `TRUNCATE platform.${table}`])
      await assert.rejects(db.pool.query(sql), e => e.code === '42501');
  }
  for (const db of [reader, intake, reviewer]) await assert.rejects(db.pool.query('INSERT INTO platform.local_alert_reviews SELECT * FROM platform.local_alert_reviews'), e => e.code === '42501');
  for (const db of [reader, intake]) await assert.rejects(db.pool.query('SELECT * FROM platform.review_local_alert($1,$2,0,$3,$4,NULL,NULL,$5)',
    ['synthetic_local', generated.alert_id, randomUUID(), 'acknowledge', 'synthetic_reviewer']), e => e.code === '42501');
  await assert.rejects(reviewer.pool.query('INSERT INTO platform.local_transaction_risks(workspace_key,run_id,snapshot,snapshot_sha256) SELECT workspace_key,run_id,snapshot,snapshot_sha256 FROM platform.local_transaction_risks'), e => e.code === '42501');
  await assert.rejects(intake.pool.query("INSERT INTO platform.local_alert_policies(workspace_key,policy_id,policy_version,policy,policy_sha256,recorded_by) VALUES('synthetic_local','synthetic_bad','synthetic_v1','{}',$1,'forged')", ['a'.repeat(64)]), e => e.code === '42501');
});
test('alert and review insert failures atomically roll back new evidence and redact diagnostics', async () => {
  await owner.pool.query("CREATE FUNCTION platform.synthetic_alert_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_VALUE'; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_alert_fail BEFORE INSERT ON platform.local_alerts FOR EACH ROW EXECUTE FUNCTION platform.synthetic_alert_fail()');
  try { await assert.rejects(alerts.generate(f.generation), e => e.code === 'ALERT_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE')); assert.equal(await count('local_alert_policies'), 0); }
  finally { await owner.pool.query('DROP TRIGGER synthetic_alert_fail ON platform.local_alerts'); }
  const generated = await alerts.generate(f.generation);
  await owner.pool.query('CREATE TRIGGER synthetic_review_fail BEFORE INSERT ON platform.local_alert_reviews FOR EACH ROW EXECUTE FUNCTION platform.synthetic_alert_fail()');
  try { await assert.rejects(reviews.review('synthetic_local', generated.alert_id, 'synthetic_reviewer', f.ack), e => e.code === 'ALERT_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE')); assert.equal(await count('local_alert_reviews'), 0); }
  finally { await owner.pool.query('DROP TRIGGER synthetic_review_fail ON platform.local_alert_reviews'); await owner.pool.query('DROP FUNCTION platform.synthetic_alert_fail()'); }
});
test('rehashed corrupt assessment proof prevents review writes and outage recovery preserves retry safety', async () => {
  const generated = await alerts.generate(f.generation), original = f.row.risk_snapshot;
  const changed = structuredClone(original); changed.result.fraud_score.value = 0;
  await owner.pool.query('UPDATE platform.local_transaction_risks SET snapshot=$1,snapshot_sha256=$2', [changed, riskHash(changed)]);
  await assert.rejects(reviews.review('synthetic_local', generated.alert_id, 'synthetic_reviewer', f.ack), e => e.code === 'ALERT_STORAGE_UNAVAILABLE');
  assert.equal(await count('local_alert_reviews'), 0);
  await owner.pool.query('UPDATE platform.local_transaction_risks SET snapshot=$1,snapshot_sha256=$2', [original, riskHash(original)]);
  await stopCluster(state); try { await assert.rejects(alerts.generate(f.generation), e => e.code === 'ALERT_STORAGE_UNAVAILABLE'); } finally { await startCluster(state); }
  assert.equal((await alerts.generate(f.generation)).status, 'duplicate');
});
