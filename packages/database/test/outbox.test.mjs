import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createLocalOutbox, enqueueLocalIntent, localPoolConfig, OutboxError } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, prepareOutbox, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';

let scratch, state, queue, owner, reader, worker;
const input = (change = {}) => ({ workspace_key: 'synthetic_local', semantic_key: 'synthetic_' + randomUUID(), notification_ref: randomUUID(), expires_at: new Date(Date.now() + 600000).toISOString(), ...change });
const fails = code => error => error instanceof OutboxError && error.code === code && !error.message.includes('SYNTHETIC_PRIVATE_VALUE');
async function claim(scope) { const result = await queue.claim(scope); assert.equal(result.status, 'claimed'); return result.claim; }
async function expireLease(ref) { await owner.pool.query("UPDATE platform.local_outbox_intents SET lease_until=clock_timestamp()-interval '1 second' WHERE intent_ref=$1", [ref]); }
async function makeDue(ref) { await owner.pool.query("UPDATE platform.local_outbox_intents SET available_at=clock_timestamp()-interval '1 second' WHERE intent_ref=$1", [ref]); }
before(async () => {
  scratch = await mkdtemp('/tmp/lmps-outbox-'); state = await initializeCluster(join(scratch, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  queue = createLocalOutbox(dsn(state, 'outbox')); owner = createDatabase(dsn(state, 'migration'), 'migration');
  reader = createDatabase(dsn(state)); worker = createDatabase(dsn(state, 'outbox'), 'outbox');
});
after(async () => {
  await queue?.close(); await worker?.close(); await reader?.close(); await owner?.close();
  if (scratch && !state) { try { state = await loadState(join(scratch, 'pg')); } catch { return; } }
  if (state) await stopCluster(state);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('strict local intent boundary rejects real providers, payload/account fields, invalid dates/scope and production', async () => {
  for (const value of [null, {}, input({ workspace_key: 'real_bank' }), input({ provider: 'fcm' }), input({ execution_mode: 'live' }), input({ payload: 'SYNTHETIC_PRIVATE_VALUE' }), input({ account: 'SYNTHETIC_PRIVATE_VALUE' }), input({ expires_at: '2026-02-30T00:00:00.000Z' }), input({ notification_ref: 'not-uuid' })]) assert.throws(() => queue.enqueue(value), fails('INVALID_INTENT'));
  const previous = process.env.LMPS_EXECUTION_MODE;
  try { process.env.LMPS_EXECUTION_MODE = 'live'; assert.throws(() => createLocalOutbox(dsn(state, 'outbox')), fails('INVALID_INTENT')); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
  assert.throws(() => createLocalOutbox(dsn(state)), /Invalid local PostgreSQL/);
  assert.equal(localPoolConfig(dsn(state, 'outbox'), 'outbox').max, 2);
  const original = await readFile(join(state.base, 'state.json')); await prepareOutbox(state);
  assert.deepEqual(await readFile(join(state.base, 'state.json')), original);
});

test('concurrent identical intents deduplicate with exact evidence and contradictory reuse is rejected', async () => {
  const value = input({ workspace_key: 'synthetic_dedup' });
  const results = await Promise.all(Array.from({ length: 8 }, () => queue.enqueue(value)));
  assert.equal(results.filter(row => row.status === 'inserted').length, 1); assert.equal(new Set(results.map(row => row.intent_ref)).size, 1);
  assert.equal(results.filter(row => row.status === 'duplicate').length, 7);
  await assert.rejects(queue.enqueue({ ...value, notification_ref: randomUUID() }), fails('INTENT_CONFLICT'));
  await assert.rejects(queue.enqueue({ ...value, expires_at: '2027-01-01T00:00:00.000Z' }), fails('INTENT_CONFLICT'));
  const result = await queue.enqueue({ ...value, workspace_key: 'synthetic_other' }); assert.equal(result.status, 'inserted');
});

test('domain write and intent share the caller transaction and rollback together', async () => {
  await owner.pool.query('CREATE TABLE platform.synthetic_outbox_domain(id int PRIMARY KEY)');
  const client = await owner.pool.connect(); const value = input({ workspace_key: 'synthetic_atomic' });
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await client.query('INSERT INTO platform.synthetic_outbox_domain VALUES (1)');
    await enqueueLocalIntent(client, value); await assert.rejects(client.query('SELECT 1/0')); await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM platform.synthetic_outbox_domain')).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM platform.local_outbox_intents WHERE workspace_key=$1', [value.workspace_key])).rows[0].n, 0);
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await client.query('INSERT INTO platform.synthetic_outbox_domain VALUES (1)'); await enqueueLocalIntent(client, value); await client.query('COMMIT');
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('concurrent workers claim one lease per intent and cannot claim another workspace', async () => {
  const value = input({ workspace_key: 'synthetic_race' }); const inserted = await queue.enqueue(value);
  const results = await Promise.all(Array.from({ length: 8 }, () => queue.claim(value.workspace_key)));
  assert.equal(results.filter(row => row.status === 'claimed').length, 1); assert.equal(results.filter(row => row.status === 'empty').length, 7);
  const lease = results.find(row => row.status === 'claimed').claim;
  assert.equal(lease.intent_ref, inserted.intent_ref); assert.equal(lease.attempt_number, 1);
  assert.equal((await queue.finish({ ...lease, workspace_key: 'synthetic_other' }, 'accepted')).status, 'stale');
  assert.equal((await queue.finish(lease, 'accepted')).status, 'accepted');
  assert.equal((await queue.finish(lease, 'accepted')).status, 'stale');
  assert.equal((await reader.pool.query('SELECT outcome FROM platform.local_outbox_attempts WHERE intent_ref=$1', [inserted.intent_ref])).rows[0].outcome, 'accepted');
});

test('SKIP LOCKED lets another intent progress while a worker transaction holds a row lock', async () => {
  const scope = 'synthetic_locked'; const a = await queue.enqueue(input({ workspace_key: scope })); const b = await queue.enqueue(input({ workspace_key: scope }));
  const client = await owner.pool.connect();
  try {
    await client.query('BEGIN'); await client.query('SELECT 1 FROM platform.local_outbox_intents WHERE intent_ref=$1 FOR UPDATE', [a.intent_ref]);
    const work = await claim(scope); assert.equal(work.intent_ref, b.intent_ref); await queue.finish(work, 'accepted');
  } finally { await client.query('ROLLBACK'); client.release(); }
  const work = await claim(scope); assert.equal(work.intent_ref, a.intent_ref); await queue.finish(work, 'accepted');
});

test('crash recovery rotates fencing token, preserves unknown attempt and prevents stale acknowledgement', async () => {
  const scope = 'synthetic_recovery'; await queue.enqueue(input({ workspace_key: scope }));
  const first = await claim(scope); await expireLease(first.intent_ref);
  const second = await claim(scope); assert.notEqual(second.lease_token, first.lease_token); assert.equal(second.attempt_number, 2);
  assert.equal((await queue.finish(first, 'accepted')).status, 'stale');
  assert.equal((await queue.finish(second, 'accepted')).status, 'accepted');
  const outcomes = (await reader.pool.query('SELECT outcome FROM platform.local_outbox_attempts WHERE intent_ref=$1 ORDER BY attempt_number', [first.intent_ref])).rows.map(row => row.outcome);
  assert.deepEqual(outcomes, ['unknown', 'accepted']);
});

test('transient failure schedules bounded jittered backoff and stops after three attempts', async () => {
  const scope = 'synthetic_retry'; const enqueued = await queue.enqueue(input({ workspace_key: scope }));
  for (let number = 1; number <= 3; number++) {
    const work = await claim(scope); assert.equal(work.attempt_number, number);
    const response = await queue.finish(work, 'retry'); assert.equal(response.status, number === 3 ? 'dead' : 'pending');
    if (number < 3) {
      const wait = (await reader.pool.query('SELECT extract(epoch FROM available_at-clock_timestamp())::float8 AS n FROM platform.local_outbox_intents WHERE intent_ref=$1', [enqueued.intent_ref])).rows[0].n;
      assert.ok(wait > 0 && wait <= Math.pow(2, number - 1) + 1);
      assert.equal((await queue.claim(scope)).status, 'empty'); await makeDue(enqueued.intent_ref);
    }
  }
  assert.equal((await queue.claim(scope)).status, 'empty');
});

test('expiry and permanent error are terminal, expired leases cannot acknowledge, repeated crashes have an attempt cap', async () => {
  await queue.enqueue(input({ workspace_key: 'synthetic_expired', expires_at: '2020-01-01T00:00:00.000Z' }));
  assert.equal((await queue.claim('synthetic_expired')).status, 'expired');
  await queue.enqueue(input({ workspace_key: 'synthetic_permanent' })); const permanent = await claim('synthetic_permanent');
  assert.equal((await queue.finish(permanent, 'permanent')).status, 'dead');
  await queue.enqueue(input({ workspace_key: 'synthetic_crashes' }));
  for (let i = 0; i < 3; i++) { const work = await claim('synthetic_crashes'); await expireLease(work.intent_ref); assert.equal((await queue.finish(work, 'accepted')).status, 'stale'); }
  assert.equal((await queue.claim('synthetic_crashes')).status, 'dead');
});

test('attempt-write failure rolls back acknowledgement and claim failures leave no partial lease', async () => {
  const scope = 'synthetic_failure'; const ref = await queue.enqueue(input({ workspace_key: scope }));
  const locker = await owner.pool.connect();
  try {
    await locker.query('BEGIN'); await locker.query('LOCK TABLE platform.local_outbox_attempts IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(queue.claim(scope), fails('STORAGE_FAILED'));
  } finally { await locker.query('ROLLBACK'); locker.release(); }
  assert.equal((await reader.pool.query('SELECT state FROM platform.local_outbox_intents WHERE intent_ref=$1', [ref.intent_ref])).rows[0].state, 'pending');
  const work = await claim(scope); const second = await owner.pool.connect();
  try {
    await second.query('BEGIN'); await second.query('LOCK TABLE platform.local_outbox_attempts IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(queue.finish(work, 'accepted'), fails('STORAGE_FAILED'));
  } finally { await second.query('ROLLBACK'); second.release(); }
  assert.equal((await reader.pool.query('SELECT state FROM platform.local_outbox_intents WHERE intent_ref=$1', [ref.intent_ref])).rows[0].state, 'leased');
  assert.equal((await queue.finish(work, 'accepted')).status, 'accepted');
});

test('least privilege protects intent payload, fixed provider, generated metadata and old source/migration tables', async () => {
  for (const sql of ["UPDATE platform.local_outbox_intents SET notification_ref=gen_random_uuid()", "UPDATE platform.local_outbox_intents SET semantic_key='synthetic_bad'", "UPDATE platform.local_outbox_intents SET provider='fcm'", 'DELETE FROM platform.local_outbox_attempts', 'TRUNCATE platform.local_outbox_intents', 'CREATE TABLE platform.forbidden(id int)', 'SET ROLE lmps_migrator', 'SELECT * FROM lmps_migrations.__drizzle_migrations', 'SELECT * FROM platform.source_events']) await assert.rejects(worker.pool.query(sql), error => error.code === '42501');
  await assert.rejects(worker.pool.query('INSERT INTO platform.local_outbox_intents(intent_ref) VALUES (gen_random_uuid())'), error => error.code === '42501');
  await assert.rejects(reader.pool.query("UPDATE platform.local_outbox_intents SET state='dead'"), error => error.code === '42501');
  await assert.rejects(owner.pool.query("INSERT INTO platform.local_outbox_intents(workspace_key,semantic_key,notification_ref,expires_at,provider) VALUES ('synthetic_local','synthetic_forbidden',gen_random_uuid(),now(),'fcm')"), error => error.code === '23514');
});

test('database restart preserves unknown work and redacted outage errors; rejected inputs cannot leak in logs', async () => {
  const scope = 'synthetic_restart'; await queue.enqueue(input({ workspace_key: scope })); const work = await claim(scope);
  await assert.rejects(queue.finish({ ...work, notification_ref: 'SYNTHETIC_PRIVATE_VALUE' }, 'accepted'), fails('INVALID_INTENT'));
  await stopCluster(state); await assert.rejects(queue.claim(scope), fails('STORAGE_FAILED')); await startCluster(state);
  await expireLease(work.intent_ref); const recovered = await claim(scope); assert.equal(recovered.attempt_number, 2); await queue.finish(recovered, 'accepted');
  const log = await readFile(join(state.base, 'server.log'), 'utf8');
  for (const value of [...Object.values(state.passwords), 'SYNTHETIC_PRIVATE_VALUE']) assert.ok(!log.includes(value));
});
