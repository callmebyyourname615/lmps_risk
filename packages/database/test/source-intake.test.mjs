import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, createSourceIntake, validateSourceEvent, IntakeError, localPoolConfig } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, prepareIntake, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/source-event.json', import.meta.url), 'utf8'));
const event = (changes = {}) => ({ ...structuredClone(fixture), ...changes });
const fails = code => error => error instanceof IntakeError && error.code === code && !error.message.includes('SYNTHETIC_PRIVATE_VALUE');
let temporary, state, app, migration, writer, intake;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'lmps-intake-'));
  state = await initializeCluster(join(temporary, 'cluster'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  app = createDatabase(dsn(state));
  migration = createDatabase(dsn(state, 'migration'), 'migration');
  writer = createDatabase(dsn(state, 'intake'), 'intake');
  intake = createSourceIntake(dsn(state, 'intake'));
});
after(async () => {
  await intake?.close(); await writer?.close(); await app?.close(); await migration?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'cluster')); } catch { return; } }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('local envelope rejects real/live profiles, incomplete/extra keys, invalid amounts/time and account fields', () => {
  assert.deepEqual(validateSourceEvent(fixture), fixture);
  const invalid = [null, [], {}, event({ provenance: 'real_source' }), event({ execution_mode: 'live' }), event({ workspace_key: 'production' }), event({ source_namespace: 'lmps' }), event({ observed_at: '2026-02-30T00:00:00.000Z' }), event({ observed_at: '2026-01-01T07:00:00+07:00' }), event({ event_key: '' }), event({ source_table: 'other' }), event({ source_key: { id: '1' } }), event({ source_key: { id: '01', requesttime: fixture.source_key.requesttime } }), event({ source_key: { id: '2147483648', requesttime: fixture.source_key.requesttime } }), event({ source_key: { id: '1', requesttime: '2026-02-30 00:00:00' } }), event({ fields: { ...fixture.fields, fromaccount: 'SYNTHETIC_PRIVATE_VALUE' } }), event({ fromaccount: 'SYNTHETIC_PRIVATE_VALUE' }), event({ fields: { ...fixture.fields, ccy: null } }), event({ fields: { ...fixture.fields, amount: '1.001' } }), event({ fields: { ...fixture.fields, amount: 1.23 } }), event({ fields: { ...fixture.fields, amount: '10000000000000000000000.00' } }), event({ fields: { ...fixture.fields, result: { account: 'SYNTHETIC_PRIVATE_VALUE' } } }), event({ fields: { ...fixture.fields, result: '\u0000' } }), event({ fields: { ...fixture.fields, result: '\ud800' } }), event({ operation: 'delete' }), event({ source_key: { ...fixture.source_key, toaccount: 'SYNTHETIC_PRIVATE_VALUE' } })];
  for (const value of invalid) assert.throws(() => validateSourceEvent(value), fails('INVALID_EVENT'));
  for (const amount of ['0.00', '-1.00', '9999999999999999999999.99']) assert.equal(validateSourceEvent(event({ fields: { ...fixture.fields, amount } })).fields.amount, amount);
  assert.equal(validateSourceEvent(event({ source_key: { id: '-2147483648', requesttime: fixture.source_key.requesttime } })).source_key.id, '-2147483648');
});

test('validation returns a detached snapshot and accepts member/old/delete fixture shapes', () => {
  const input = event(); const snapshot = validateSourceEvent(input); input.fields.amount = '99.99';
  assert.equal(snapshot.fields.amount, '123.45');
  assert.equal(validateSourceEvent(event({ source_table: 'transfer_old', source_key: { id: '1' } })).source_key.id, '1');
  assert.equal(validateSourceEvent(event({ source_table: 'member', source_key: { code: '000001' }, fields: { status: null, member_type: 'synthetic' } })).source_key.code, '000001');
  assert.equal(validateSourceEvent(event({ operation: 'delete', fields: null })).fields, null);
});

test('bounded intake connection fixes role and cannot accept app credentials or production mode', async () => {
  assert.equal(localPoolConfig(dsn(state, 'intake'), 'intake').max, 2);
  assert.throws(() => createSourceIntake(dsn(state)));
  assert.throws(() => dsn(state, 'unknown'));
  const previous = process.env.LMPS_EXECUTION_MODE;
  try { process.env.LMPS_EXECUTION_MODE = 'live'; assert.throws(() => createSourceIntake(dsn(state, 'intake'))); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
  const original = await readFile(join(state.base, 'state.json'));
  await prepareIntake(state);
  assert.equal(Buffer.compare(original, await readFile(join(state.base, 'state.json'))), 0);
  await assert.rejects(writer.pool.query('SELECT * FROM lmps_migrations.__drizzle_migrations'), error => error.code === '42501');
});

test('concurrent copies commit one record/event and retries reuse the original IDs', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => intake.append(event())));
  assert.equal(results.filter(row => row.status === 'inserted').length, 1);
  assert.equal(results.filter(row => row.status === 'duplicate').length, 11);
  assert.equal(new Set(results.map(row => row.record_id)).size, 1);
  assert.equal(new Set(results.map(row => row.event_id)).size, 1);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_records')).rows[0].n, 1);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows[0].n, 1);
});

test('same event with changed fields/operation/time or source record is a redacted conflict, leaving no orphan', async () => {
  for (const override of [{ fields: { ...fixture.fields, amount: '88.00' } }, { operation: 'update' }, { observed_at: '2026-01-01T00:00:02.000Z' }, { source_key: { ...fixture.source_key, id: '2' } }, { source_table: 'transfer_hist' }]) {
    await assert.rejects(intake.append(event(override)), fails('EVENT_CONFLICT'));
  }
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_records')).rows[0].n, 1);
  assert.equal((await app.pool.query('SELECT fields->>\'amount\' AS amount FROM platform.source_events')).rows[0].amount, '123.45');
});

test('distinct events with equal data remain distinct, and source updates/deletes retain prior evidence', async () => {
  for (const [key, operation, fields] of [['equal-data', 'insert', fixture.fields], ['changed', 'update', { ...fixture.fields, amount: '9999999999999999999999.99' }], ['deleted', 'delete', null]]) {
    assert.equal((await intake.append(event({ event_key: key, operation, fields }))).status, 'inserted');
  }
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_records')).rows[0].n, 1);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows[0].n, 4);
  assert.equal((await app.pool.query("SELECT fields->>'amount' AS amount FROM platform.source_events WHERE event_key='changed'")).rows[0].amount, '9999999999999999999999.99');
});

test('scoped identities isolate workspaces, namespaces, generations, tables and complete composite keys', async () => {
  const rows = [];
  for (const override of [{ workspace_key: 'synthetic_other' }, { source_namespace: 'synthetic_other' }, { source_generation: 'fixture_v2' }, { source_table: 'transfer_hist', event_key: 'history' }, { source_key: { ...fixture.source_key, requesttime: '2026-01-02 00:00:00' }, event_key: 'other-date' }, { source_table: 'member', source_key: { code: '000001' }, event_key: 'member', fields: { status: null, member_type: 'synthetic' } }]) rows.push(await intake.append(event(override)));
  assert.equal(new Set(rows.map(row => row.record_id)).size, rows.length);
  const epoch = await intake.append(event({ capture_epoch: 'fixture_epoch_2' }));
  assert.equal(epoch.status, 'inserted');
  assert.equal(epoch.record_id, (await intake.append(event())).record_id);
});

test('reader cannot write; intake writer is append-only and cannot escalate or create objects', async () => {
  for (const connection of [app, writer]) {
    for (const sql of ['UPDATE platform.source_events SET operation=\'update\'', 'DELETE FROM platform.source_events', 'TRUNCATE platform.source_events', 'UPDATE platform.source_records SET source_table=\'member\'', 'DELETE FROM platform.source_records', 'SET ROLE lmps_migrator', 'CREATE TABLE platform.forbidden(id int)']) await assert.rejects(connection.pool.query(sql), error => error.code === '42501');
  }
  await assert.rejects(app.pool.query("INSERT INTO platform.source_records(workspace_key) VALUES ('synthetic_forbidden')"), error => error.code === '42501');
  for (const sql of ["INSERT INTO platform.source_records(record_id) OVERRIDING SYSTEM VALUE VALUES (999)", "INSERT INTO platform.source_records(record_ref) VALUES (gen_random_uuid())", "INSERT INTO platform.source_records(created_at) VALUES (now())", "INSERT INTO platform.source_events(recorded_at) VALUES (now())", "INSERT INTO platform.source_records(provenance) VALUES ('local_synthetic')"]) await assert.rejects(writer.pool.query(sql), error => error.code === '42501');
});

test('database rejects cross-workspace references, raw account JSON keys and missing identities', async () => {
  const record = (await app.pool.query('SELECT record_id FROM platform.source_records ORDER BY record_id LIMIT 1')).rows[0].record_id;
  await assert.rejects(writer.pool.query("INSERT INTO platform.source_events(workspace_key,source_namespace,source_generation,capture_epoch,event_key,record_id,operation,observed_at,fields) VALUES ('synthetic_missing','synthetic_lmps','fixture_v1','epoch','forbidden',$1,'delete',now(),NULL)", [record]), error => error.code === '23503');
  await assert.rejects(writer.pool.query("INSERT INTO platform.source_events(workspace_key,source_namespace,source_generation,capture_epoch,event_key,record_id,operation,observed_at,fields) VALUES ('synthetic_local','synthetic_lmps','fixture_v1','epoch','forbidden',$1,'insert',now(),$2::jsonb)", [record, JSON.stringify({ toaccount: 'SYNTHETIC_PRIVATE_VALUE' })]), error => error.code === '23514');
  await assert.rejects(writer.pool.query("INSERT INTO platform.source_records(workspace_key,source_namespace,source_generation,source_table,source_key) VALUES ('synthetic_local','synthetic_lmps','fixture_v1','transfer',$1::jsonb)", [JSON.stringify({ id: '3' })]), error => error.code === '23514');
});

test('event-table failure rolls back the new source record and leaves the pool usable', async () => {
  const locker = await migration.pool.connect();
  const value = event({ event_key: 'lock-failure', source_key: { ...fixture.source_key, id: '99' } });
  try {
    await locker.query('BEGIN'); await locker.query('LOCK TABLE platform.source_events IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(intake.append(value), fails('STORAGE_FAILED'));
  } finally { await locker.query('ROLLBACK'); locker.release(); }
  assert.equal((await app.pool.query("SELECT count(*)::int AS n FROM platform.source_records WHERE source_key->>'id'='99'")).rows[0].n, 0);
  assert.equal((await intake.append(value)).status, 'inserted');
});

test('racing contradictory events commit one winner and roll back the losing record', async () => {
  const results = await Promise.allSettled(['101', '102'].map(id => intake.append(event({ event_key: 'racing-conflict', source_key: { ...fixture.source_key, id } }))));
  assert.equal(results.filter(row => row.status === 'fulfilled' && row.value.status === 'inserted').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected' && row.reason.code === 'EVENT_CONFLICT').length, 1);
  assert.equal((await app.pool.query("SELECT count(*)::int AS n FROM platform.source_records WHERE source_key->>'id' IN ('101','102')")).rows[0].n, 1);
});

test('committed event survives restart and replay stays idempotent without raw diagnostics in logs', async () => {
  await stopCluster(state);
  await assert.rejects(intake.append(event()), fails('STORAGE_FAILED'));
  await startCluster(state);
  assert.equal((await intake.append(event())).status, 'duplicate');
  const log = await readFile(join(state.base, 'server.log'), 'utf8');
  for (const value of ['SYNTHETIC_PRIVATE_VALUE', ...Object.values(state.passwords)]) if (log.includes(value)) throw new Error('Sensitive value appeared in local server log.');
});
