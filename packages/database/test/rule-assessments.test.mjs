import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createRuleAssessments, createTransactionRevisions, evaluateBacktest } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { assessmentFixture } from './fixtures/rule-assessment.mjs';

let temporary, state, owner, app, intake, repository, writer, f;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-assessments-');
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); app = createDatabase(dsn(state)); intake = createDatabase(dsn(state, 'intake'), 'intake');
  repository = createRuleAssessments(dsn(state, 'intake')); writer = createTransactionRevisions(dsn(state, 'intake'));
});
beforeEach(async () => {
  await owner.pool.query('TRUNCATE platform.local_assessment_runs,platform.local_rule_versions,platform.local_transaction_revisions');
  f = assessmentFixture(); await writer.append(f.revision);
});
after(async () => {
  await repository?.close(); await writer?.close(); await intake?.close(); await app?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('assessment commits registered rule versions and exact reference results together; concurrent retries deduplicate', async () => {
  const results = await Promise.all([repository.evaluate(f.manifest), repository.evaluate(f.manifest)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['duplicate', 'inserted']);
  assert.deepEqual(results[0].report, evaluateBacktest(f.manifest, f.observations));
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_rule_versions')).rows[0].n, 2);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_assessment_runs')).rows[0].n, 1);
  const saved = (await app.pool.query('SELECT report FROM platform.local_assessment_runs')).rows[0].report;
  assert.deepEqual(saved, results[0].report);
  for (const table of ['source_events', 'audit_events', 'local_sync_jobs', 'local_outbox_intents'])
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n, 0);
});

test('same rule version with changed definition conflicts and rolls back all newly registered rules and run', async () => {
  await repository.evaluate(f.manifest);
  const changed = structuredClone(f.manifest); changed.run_id = randomUUID(); changed.rules[1].threshold = '2.00';
  changed.rules.unshift({ ...changed.rules[0], rule_id: 'synthetic_aaa' });
  await assert.rejects(repository.evaluate(changed), e => e.code === 'RULE_VERSION_CONFLICT');
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_rule_versions')).rows[0].n, 2);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_assessment_runs')).rows[0].n, 1);
  changed.rules = changed.rules.slice(1); changed.rules[1].rule_version = 'synthetic_v2';
  const next = await repository.evaluate(changed); assert.equal(next.status, 'inserted');
  assert.notDeepEqual(next.report, (await repository.evaluate(f.manifest)).report);
});

test('same run rejects changed manifest and preserves missing-input results after input later appears', async () => {
  await owner.pool.query('TRUNCATE platform.local_transaction_revisions');
  const first = await repository.evaluate(f.manifest); assert.equal(first.report.status, 'partial');
  assert.equal(first.report.rows[0].results[0].outcome, 'unavailable');
  await writer.append(f.revision);
  const retry = await repository.evaluate(f.manifest); assert.equal(retry.status, 'duplicate'); assert.deepEqual(retry.report, first.report);
  const changed = structuredClone(f.manifest); changed.rules[0].threshold = '2.00';
  await assert.rejects(repository.evaluate(changed), e => e.code === 'ASSESSMENT_CONFLICT');
  const fresh = await repository.evaluate({ ...f.manifest, run_id: randomUUID() }); assert.equal(fresh.report.status, 'complete');
});

test('separate runs cannot race two different definitions into the same immutable rule version', async () => {
  const other = structuredClone(f.manifest); other.run_id = randomUUID(); other.rules[0].threshold = '2.00';
  const results = await Promise.allSettled([repository.evaluate(f.manifest), repository.evaluate(other)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'RULE_VERSION_CONFLICT');
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_assessment_runs')).rows[0].n, 1);
});

test('app is readonly; intake cannot update/delete/truncate evidence or spoof recording identity', async () => {
  await repository.evaluate(f.manifest);
  for (const table of ['local_rule_versions', 'local_assessment_runs']) {
    for (const database of [app, intake]) {
      for (const sql of [`UPDATE platform.${table} SET workspace_key='synthetic_other'`, `DELETE FROM platform.${table}`, `TRUNCATE platform.${table}`])
        await assert.rejects(database.pool.query(sql), error => error.code === '42501');
    }
  }
  await assert.rejects(app.pool.query('INSERT INTO platform.local_assessment_runs SELECT * FROM platform.local_assessment_runs'), error => error.code === '42501');
  await assert.rejects(intake.pool.query("INSERT INTO platform.local_rule_versions(workspace_key,rule_id,rule_version,definition,rule_sha256,recorded_by) VALUES ('synthetic_local','synthetic_bad','synthetic_v1','{}',$1,'spoofed')", ['a'.repeat(64)]), error => error.code === '42501');
});

test('storage failure rolls back registered versions; outage is redacted and recovery permits retry', async () => {
  await owner.pool.query("CREATE FUNCTION platform.synthetic_fail_assessment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_VALUE'; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_fail_assessment BEFORE INSERT ON platform.local_assessment_runs FOR EACH ROW EXECUTE FUNCTION platform.synthetic_fail_assessment()');
  try {
    await assert.rejects(repository.evaluate(f.manifest), e => e.code === 'STORAGE_FAILED' && !e.message.includes('PRIVATE'));
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_rule_versions')).rows[0].n, 0);
  } finally { await owner.pool.query('DROP TRIGGER synthetic_fail_assessment ON platform.local_assessment_runs'); await owner.pool.query('DROP FUNCTION platform.synthetic_fail_assessment()'); }
  await stopCluster(state);
  try { await assert.rejects(repository.evaluate(f.manifest), e => e.code === 'STORAGE_FAILED'); }
  finally { await startCluster(state); }
  assert.equal((await repository.evaluate(f.manifest)).status, 'inserted');
});

test('invalid or production execution rejects before any database write', async () => {
  await assert.rejects(repository.evaluate({ ...f.manifest, workspace_key: 'synthetic_other' }), e => e.code === 'INVALID_ASSESSMENT');
  for (const [key, value] of [['NODE_ENV', 'production'], ['LMPS_ENVIRONMENT', 'production'], ['LMPS_EXECUTION_MODE', 'live']]) {
    const prior = process.env[key]; process.env[key] = value;
    try { await assert.rejects(repository.evaluate(f.manifest), e => e.code === 'INVALID_ASSESSMENT'); }
    finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
  }
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.local_rule_versions')).rows[0].n, 0);
});
