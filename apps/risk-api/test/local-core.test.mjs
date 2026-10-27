import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import { createDatabase, createSourceIntake, createLocalOutbox, createSyncJobs } from '@lmps/database';
import { availablePort, dsn, initializeCluster, loadState, prepareReviewer, preparePolicy, prepareCase, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { createBackup, restoreDrill, verifyBackup } from '../../../packages/database/scripts/backup.mjs';
import { CORE_ROLES, openCoreApi, startCore } from '../scripts/local-core.mjs';
import { CORE_DEMO, runCoreDemo } from '../scripts/core-demo.mjs';

let temp, state, owner, original, first, saved;
const oldTables = ['source_records', 'source_events', 'local_outbox_intents', 'local_outbox_attempts', 'audit_events', 'local_sync_jobs', 'local_sync_attempts'];
const tableCount = async () => Number((await owner.pool.query("SELECT count(*) AS n FROM pg_tables WHERE schemaname IN ('platform','lmps_migrations')")).rows[0].n);
const legacyRows = async () => {
  const result = {};
  for (const name of oldTables) result[name] = (await owner.pool.query(`SELECT row_to_json(t) AS row FROM platform.${name} t ORDER BY row_to_json(t)::text`)).rows;
  return result;
};
before(async () => {
  temp = await mkdtemp('/tmp/lmps-core-test-');
  state = await initializeCluster(join(temp, 'pg'), await availablePort());
  await startCluster(state);
  const folder = join(temp, 'old-migrations');
  await cp(new URL('../../../packages/database/migrations/', import.meta.url), folder, { recursive: true });
  const path = join(folder, 'meta/_journal.json'), journal = JSON.parse(await readFile(path, 'utf8'));
  journal.entries = journal.entries.slice(0, 6); await writeFile(path, JSON.stringify(journal));
  await migrations(dsn(state, 'migration'), true, folder);
  owner = createDatabase(dsn(state, 'migration'), 'migration');
  const intake = createSourceIntake(dsn(state, 'intake')), outbox = createLocalOutbox(dsn(state, 'outbox')), sync = createSyncJobs(dsn(state, 'intake'));
  try {
    await intake.append(JSON.parse(await readFile(new URL('../../../packages/database/fixtures/source-event.json', import.meta.url), 'utf8')));
    await outbox.enqueue({ workspace_key: 'synthetic_local', semantic_key: 'synthetic_core_old', notification_ref: '39000000-0000-4000-8000-000000000001', expires_at: '2030-01-01T00:00:00.000Z' });
    await sync.register({ workspace_key: 'synthetic_local', capture_id: '39000000-0000-4000-8000-000000000002', snapshot_sha256: 'a'.repeat(64), total: 0 });
  } finally { await intake.close(); await outbox.close(); await sync.close(); }
  original = await legacyRows();
});
after(async () => {
  await owner?.close();
  if (temp && !state) { try { state = await loadState(join(temp, 'pg')); } catch {} }
  if (state) await stopCluster(state);
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('core startup refuses an old schema without applying migrations or seeding', async () => {
  assert.equal(await tableCount(), 8);
  await assert.rejects(openCoreApi(state, await availablePort()), /startup failed/);
  assert.equal(await tableCount(), 8);
  assert.deepEqual(await legacyRows(), original);
});
test('upgrade from six migrations preserves existing data, role credentials and migration prefix', async () => {
  const passwords = { ...state.passwords };
  for (const prepare of [prepareReviewer, preparePolicy, prepareCase]) await prepare(state);
  assert.deepEqual((await loadState(state.base)).passwords, passwords);
  const result = await migrations(dsn(state, 'migration'), true);
  assert.equal(result.length, 17); assert.ok(result.every(row => row.status === 'applied'));
  assert.equal(await tableCount(), 31);
  assert.deepEqual(await legacyRows(), original);
  assert.deepEqual(await migrations(dsn(state, 'migration'), true), result);
});
test('a failed outcome audit retains committed demo steps and exact rerun resumes the workflow', async () => {
  await owner.pool.query("CREATE FUNCTION platform.core_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='record_outcome' THEN RAISE EXCEPTION 'synthetic test failure'; END IF; RETURN NEW; END $$");
  await owner.pool.query('CREATE TRIGGER core_test_failure BEFORE INSERT ON platform.local_case_events FOR EACH ROW EXECUTE FUNCTION platform.core_test_failure()');
  try {
    await assert.rejects(runCoreDemo(state), /failed at case/);
    const row = (await owner.pool.query('SELECT state,version FROM platform.local_cases WHERE case_id=$1', [CORE_DEMO.case_id])).rows[0];
    assert.deepEqual(row, { state: 'in_review', version: 4 });
    assert.equal((await owner.pool.query('SELECT count(*)::int AS n FROM platform.local_case_outcomes')).rows[0].n, 0);
  } finally {
    await owner.pool.query('DROP TRIGGER core_test_failure ON platform.local_case_events');
    await owner.pool.query('DROP FUNCTION platform.core_test_failure()');
  }
  first = await runCoreDemo(state);
  assert.equal(first.case_state, 'closed'); assert.equal(first.case_version, 6);
  assert.equal(first.training_eligible, false);
  assert.deepEqual(await legacyRows(), original);
});
test('demo rerun after API restart preserves every table fingerprint and frozen approved-policy evidence', async () => {
  const before = await createBackup(state, join(temp, 'backups'));
  const again = await runCoreDemo(state);
  assert.equal(again.revision, 'duplicate'); assert.equal(again.job, 'duplicate');
  assert.equal(again.alert_id, first.alert_id);
  saved = await createBackup(state, join(temp, 'backups'));
  assert.deepEqual((await verifyBackup(saved.directory)).tables, (await verifyBackup(before.directory)).tables);
  const row = (await owner.pool.query('SELECT generation,policy_id FROM platform.local_risk_job_policy_bindings WHERE job_ref=$1', [CORE_DEMO.job_ref])).rows[0];
  assert.deepEqual(row, { generation: 1, policy_id: 'synthetic_core_demo' });
});
test('local runtime serves real TCP/OpenAPI with short-lived scoped tokens, normal auth and cleanup', async () => {
  const runtime = await startCore(state, await availablePort());
  try {
    assert.equal((await lstat(runtime.directory)).mode & 0o077, 0);
    for (const role of Object.keys(CORE_ROLES)) {
      const path = join(runtime.directory, role + '.json');
      assert.equal((await lstat(path)).mode & 0o077, 0);
      const token = JSON.parse(await readFile(path, 'utf8')).authorization.slice(7), claims = decodeJwt(token);
      assert.equal(claims.sub, CORE_ROLES[role].sub); assert.equal(claims.exp - claims.iat, 300);
      assert.equal(claims.scope, CORE_ROLES[role].scope); assert.equal(claims.workspace_key, 'synthetic_local');
    }
    assert.equal((await fetch(runtime.url + '/docs')).status, 200);
    assert.equal((await fetch(runtime.url + '/openapi.json')).status, 200);
    assert.equal((await fetch(runtime.url + '/health/ready')).status, 503);
    assert.equal((await fetch(runtime.url + '/v1/local/cases')).status, 401);
    await runtime.request('reader', 'POST', '/v1/local/cases/' + CORE_DEMO.case_id + '/close', {}, 403);
    await runtime.request('author', 'POST', '/v1/local/risk-policies/approvals', {}, 403);
    await assert.rejects(runtime.request('reader', 'GET', 'https://example.invalid'), /Invalid local core API path/);
    const detail = await runtime.request('reader', 'GET', '/v1/local/cases/' + CORE_DEMO.case_id);
    assert.equal(detail.case.state, 'closed');
  } finally { await runtime.close(); }
  await assert.rejects(lstat(runtime.directory), { code: 'ENOENT' });
});
test('current demo backup restores all 31 tables and reader grants in an isolated cluster', async () => {
  const restored = await restoreDrill(saved.directory);
  assert.equal(restored.status, 'PASS'); assert.equal(Object.keys(restored.table_counts).length, 31);
  assert.equal(restored.table_counts['platform.local_case_events'], 6);
  assert.equal(restored.app_read_only_checked, true); assert.equal(restored.workers_started, false);
});
test('invalid ports and live execution reject before opening the local core runtime', async () => {
  for (const port of [0, -1, 80, 65536, '18501']) await assert.rejects(openCoreApi(state, port), /startup failed/);
  const previous = process.env.LMPS_EXECUTION_MODE;
  process.env.LMPS_EXECUTION_MODE = 'live';
  try { await assert.rejects(runCoreDemo(state)); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
  assert.equal(await tableCount(), 31);
});
