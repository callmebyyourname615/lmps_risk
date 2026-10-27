import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createLocalOutbox, enqueueLocalIntent, OutboxError } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';

let temporary, state, owner, reader, worker, intake, queue;
const input = scope => ({ workspace_key: scope, semantic_key: 'synthetic_' + randomUUID(), notification_ref: randomUUID(), expires_at: '2030-01-01T00:00:00.000Z' });
const events = async scope => (await reader.pool.query('SELECT * FROM platform.audit_events WHERE workspace_key=$1 ORDER BY audit_id', [scope])).rows;
const storageFailure = error => error instanceof OutboxError && error.code === 'STORAGE_FAILED';
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-audit-'); state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state);
  const legacyFolder = join(temporary, 'legacy-migrations'); await cp(new URL('../migrations/', import.meta.url), legacyFolder, { recursive: true });
  const journalPath = join(legacyFolder, 'meta/_journal.json'); const journal = JSON.parse(await readFile(journalPath, 'utf8')); journal.entries = journal.entries.slice(0, 4);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(state, 'migration'), true, legacyFolder);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state));
  await owner.pool.query("INSERT INTO platform.local_outbox_intents(workspace_key,semantic_key,notification_ref,expires_at,state) VALUES ('synthetic_audit_legacy','synthetic_before_audit',gen_random_uuid(),'2030-01-01','accepted')");
  await migrations(dsn(state, 'migration'), true);
  worker = createDatabase(dsn(state, 'outbox'), 'outbox'); intake = createDatabase(dsn(state, 'intake'), 'intake'); queue = createLocalOutbox(dsn(state, 'outbox'));
});
after(async () => {
  await queue?.close(); await intake?.close(); await worker?.close(); await reader?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('outbox service changes produce correlated versioned evidence without payloads, keys or lease secrets', async () => {
  const scope = 'synthetic_audit_flow'; const value = input(scope); value.semantic_key = 'synthetic_private_canary';
  const inserted = await queue.enqueue(value); const work = await queue.claim(scope); assert.equal(work.status, 'claimed');
  await queue.finish(work.claim, 'accepted');
  const rows = await events(scope); assert.equal(rows.length, 5);
  assert.equal(rows.filter(row => row.action === 'outbox.intent_created').length, 1);
  assert.equal(rows.filter(row => row.action === 'outbox.intent_updated').length, 2);
  assert.equal(rows.find(row => row.action === 'outbox.attempt_started').outcome, 'unknown');
  assert.equal(rows.find(row => row.action === 'outbox.attempt_finished').outcome, 'accepted');
  for (const row of rows) {
    assert.equal(row.actor_role, 'lmps_outbox'); assert.equal(row.actor_type, 'service'); assert.equal(row.schema_version, 1);
    assert.equal(row.execution_mode, 'test'); assert.equal(row.correlation_id, inserted.intent_ref); assert.equal(row.target_ref, inserted.intent_ref);
    assert.equal(typeof row.audit_id, 'string'); assert.match(row.event_ref, /^[0-9a-f-]{36}$/); assert.ok(row.occurred_at instanceof Date);
  }
  const text = JSON.stringify(rows);
  for (const privateValue of [value.semantic_key, value.notification_ref, work.claim.lease_token, ...Object.values(state.passwords)]) assert.ok(!text.includes(privateValue));
  const finished = rows.find(row => row.action === 'outbox.intent_updated' && row.state === 'accepted');
  assert.equal(finished.previous_state, 'leased'); assert.equal(finished.attempt_number, 1);
});

test('concurrent duplicate/conflict/stale calls do not manufacture successful activity evidence', async () => {
  const scope = 'synthetic_audit_dedup'; const value = input(scope);
  const results = await Promise.all(Array.from({ length: 6 }, () => queue.enqueue(value)));
  assert.equal(results.filter(row => row.status === 'inserted').length, 1); assert.equal((await events(scope)).length, 1);
  await assert.rejects(queue.enqueue({ ...value, notification_ref: randomUUID() }), error => error.code === 'INTENT_CONFLICT');
  assert.equal((await events(scope)).length, 1);
  const work = await queue.claim(scope); await queue.finish(work.claim, 'accepted');
  assert.equal((await queue.finish(work.claim, 'accepted')).status, 'stale');
  assert.equal((await events(scope)).length, 5);
});

test('caller rollback removes domain intent and audit together; sequence gaps carry no success meaning', async () => {
  const scope = 'synthetic_audit_rollback'; const client = await worker.pool.connect();
  try {
    await client.query('BEGIN'); await enqueueLocalIntent(client, input(scope));
    assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.audit_events WHERE workspace_key=$1', [scope])).rows[0].n, 0);
    await assert.rejects(client.query('SELECT 1/0')); await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await events(scope)).length, 0);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_outbox_intents WHERE workspace_key=$1', [scope])).rows[0].n, 0);
});

test('ordinary roles cannot insert, rewrite, truncate, disable or call the protected audit writer', async () => {
  for (const database of [reader, worker, intake]) {
    for (const sql of ['INSERT INTO platform.audit_events DEFAULT VALUES', 'UPDATE platform.audit_events SET actor_role=actor_role', 'DELETE FROM platform.audit_events', 'TRUNCATE platform.audit_events', 'SELECT platform.record_local_outbox_audit()', 'ALTER TABLE platform.local_outbox_intents DISABLE TRIGGER local_outbox_intents_audit', "SET session_replication_role='replica'", 'SET ROLE lmps_migrator']) {
      await assert.rejects(database.pool.query(sql), error => error.code === '42501');
    }
  }
  const definition = (await owner.pool.query("SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='platform.record_local_outbox_audit()'::regprocedure")).rows[0];
  assert.equal(definition.prosecdef, true); assert.equal(definition.owner, 'lmps_migrator'); assert.deepEqual(definition.proconfig, ['search_path=pg_catalog']);
});

test('database role identity overrides caller context and direct SQL state changes still emit audit', async () => {
  const scope = 'synthetic_audit_actor'; const client = await worker.pool.connect(); let ref;
  try {
    await client.query('BEGIN'); await client.query("SELECT set_config('lmps.actor','synthetic_forged_employee',true)");
    ref = (await enqueueLocalIntent(client, input(scope))).intent_ref; await client.query('COMMIT');
  } finally { client.release(); }
  await owner.pool.query("UPDATE platform.local_outbox_intents SET available_at=available_at+interval '1 second' WHERE intent_ref=$1", [ref]);
  const rows = await events(scope); assert.equal(rows.length, 2);
  assert.equal(rows[0].actor_role, 'lmps_outbox'); assert.equal(rows[1].actor_role, 'lmps_migrator'); assert.equal(rows[1].actor_type, 'database_operator');
  assert.ok(!JSON.stringify(rows).includes('synthetic_forged_employee'));
  await owner.pool.query('UPDATE platform.local_outbox_intents SET state=state WHERE intent_ref=$1', [ref]);
  assert.equal((await events(scope)).length, 2);
});

test('audit storage failure rolls back enqueue, claim and finish rather than committing unaudited work', async () => {
  const scope = 'synthetic_audit_failure'; const ref = await queue.enqueue(input(scope));
  async function blocked(action) {
    const client = await owner.pool.connect();
    try {
      await client.query('BEGIN'); await client.query('LOCK TABLE platform.audit_events IN ACCESS EXCLUSIVE MODE');
      await assert.rejects(action(), storageFailure);
    } finally { await client.query('ROLLBACK'); client.release(); }
  }
  await blocked(() => queue.enqueue(input('synthetic_audit_failed_insert')));
  assert.equal((await events('synthetic_audit_failed_insert')).length, 0);
  assert.equal((await reader.pool.query("SELECT count(*)::int AS n FROM platform.local_outbox_intents WHERE workspace_key='synthetic_audit_failed_insert'")).rows[0].n, 0);
  await blocked(() => queue.claim(scope));
  assert.equal((await events(scope)).length, 1);
  assert.equal((await reader.pool.query('SELECT state,attempt_count FROM platform.local_outbox_intents WHERE intent_ref=$1', [ref.intent_ref])).rows[0].state, 'pending');
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_outbox_attempts WHERE intent_ref=$1', [ref.intent_ref])).rows[0].n, 0);
  const work = await queue.claim(scope); await blocked(() => queue.finish(work.claim, 'accepted'));
  assert.equal((await events(scope)).length, 3);
  assert.equal((await reader.pool.query('SELECT state FROM platform.local_outbox_intents WHERE intent_ref=$1', [ref.intent_ref])).rows[0].state, 'leased');
  assert.equal((await reader.pool.query('SELECT outcome FROM platform.local_outbox_attempts WHERE intent_ref=$1', [ref.intent_ref])).rows[0].outcome, 'unknown');
  assert.equal((await queue.finish(work.claim, 'accepted')).status, 'accepted'); assert.equal((await events(scope)).length, 5);
});

test('retry and expired work remain distinct from fake acceptance and generate only committed state evidence', async () => {
  const scope = 'synthetic_audit_retry'; await queue.enqueue(input(scope));
  const work = await queue.claim(scope); assert.equal((await queue.finish(work.claim, 'retry')).status, 'pending');
  const rows = await events(scope);
  assert.equal(rows.find(row => row.action === 'outbox.attempt_finished').outcome, 'retry');
  assert.equal(rows.at(-2).state, 'pending'); assert.ok(!rows.some(row => row.outcome === 'accepted'));
  const expired = 'synthetic_audit_expired'; await queue.enqueue({ ...input(expired), expires_at: '2020-01-01T00:00:00.000Z' });
  assert.equal((await queue.claim(expired)).status, 'expired');
  const expiredRows = await events(expired); assert.equal(expiredRows.length, 2); assert.equal(expiredRows.at(-1).state, 'expired');
});


test('additive audit migration preserves old intents without fabricating pre-migration history', async () => {
  const legacy = (await reader.pool.query("SELECT state FROM platform.local_outbox_intents WHERE workspace_key='synthetic_audit_legacy'")).rows;
  assert.deepEqual(legacy, [{ state: 'accepted' }]); assert.equal((await events('synthetic_audit_legacy')).length, 0);
});
