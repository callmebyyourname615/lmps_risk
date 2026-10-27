import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mariadb from 'mariadb';
import { createDatabase } from '@lmps/database';
import { BATCH_SIZE, captureSnapshot, importSnapshot, pageQuery, validateConfig, validateSnapshot } from '../dist/snapshot.js';
import { readSnapshot, saveSnapshot } from '../scripts/spool.mjs';
import { admin, availablePort, initializeServer, loadState, startServer, stopServer } from '../../../packages/source-preflight/scripts/local.mjs';
import { dsn, initializeCluster, loadState as loadPostgres, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { prepareSnapshotFixture, readerConfig } from '../../../infrastructure/mariadb/snapshot-fixture.mjs';

let scratch, source, postgres, config, snapshot, app;
const failure = code => error => error.code === code && !error.message.includes('SYNTHETIC_PRIVATE_VALUE');
async function alter(sql, params = []) {
  const connection = await admin(source);
  try { return await connection.query(sql, params); } finally { await connection.end(); }
}
async function addRows(count) {
  for (let index = 0; index < count; index++) await alter(`INSERT INTO lmps_source_local.transfer(id,requesttime,txtime,reference,frommember,tomember,fromaccount,toaccount,totype,amount,ccy,isreconciled,issettled)
    VALUES (?, '2026-01-03 00:00:00','2026-01-03 00:00:00',?,'SYNTHETIC_A','SYNTHETIC_B','SYNTHETIC_PRIVATE_VALUE','SYNTHETIC_PRIVATE_VALUE','synthetic','1.23','RAW_CCY',0,0)`, [100 + index, `SYNTHETIC_EXTRA_${index}`]);
}

before(async () => {
  scratch = await mkdtemp('/tmp/lmps-snap-');
  source = await initializeServer(join(scratch, 'source'), await availablePort());
  await startServer(source);
  config = await prepareSnapshotFixture(source);
  postgres = await initializeCluster(join(scratch, 'postgres'), await availablePort());
  await startCluster(postgres);
  await migrations(dsn(postgres, 'migration'), true);
  app = createDatabase(dsn(postgres));
});
after(async () => {
  await app?.close();
  if (!source && scratch) { try { source = await loadState(join(scratch, 'source')); } catch { return; } }
  if (source) await stopServer(source);
  if (!postgres && scratch) { try { postgres = await loadPostgres(join(scratch, 'postgres')); } catch { return; } }
  if (postgres) await stopCluster(postgres);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('synthetic seed is repeatable without overwriting rows or rotating credentials', async () => {
  const before = await readFile(join(source.base, 'state.json'));
  await prepareSnapshotFixture(source);
  assert.deepEqual(await readFile(join(source.base, 'state.json')), before);
  await alter("UPDATE lmps_source_local.member SET status='changed' WHERE code='SYNTHETIC_A'");
  try { await assert.rejects(prepareSnapshotFixture(source), /details withheld/); }
  finally { await alter("UPDATE lmps_source_local.member SET status=NULL WHERE code='SYNTHETIC_A'"); }
});

test('read-only TLS reader has only selected columns and no account, system or replication access', async () => {
  const connection = await mariadb.createConnection({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
    ssl: { ca: await readFile(config.caFile, 'utf8'), servername: 'localhost', rejectUnauthorized: true }, connectTimeout: 1000 });
  try {
    assert.ok((await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'"))[0].Value);
    for (const sql of ['SELECT fromaccount FROM transfer', 'SELECT toaccount FROM transfer_hist', 'SELECT requesttime FROM transfer_old', 'SELECT iin FROM member', 'SELECT * FROM transfer', 'SELECT * FROM mysql.global_priv', 'SHOW ALL REPLICAS STATUS', 'UPDATE member SET status=NULL', 'DELETE FROM member', 'CREATE TABLE forbidden(id int)']) {
      await assert.rejects(connection.query(sql), error => [1044, 1142, 1143, 1227, 1290].includes(error.errno));
    }
    await assert.rejects(connection.query({ sql: 'SELECT SLEEP(2)', timeout: 100 }), error => error.errno === 1969);
  } finally { await connection.end(); }
  await assert.rejects(captureSnapshot({ ...config, password: randomUUID() }), failure('CAPTURE_FAILED'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(scratch, 'wrong.key'), '-out', join(scratch, 'wrong.crt'), '-subj', '/CN=Wrong Local CA'], { stdio: 'pipe' });
  await assert.rejects(captureSnapshot({ ...config, caFile: join(scratch, 'wrong.crt') }), failure('CAPTURE_FAILED'));
});

test('native capture preserves exact decimals, naive dates, full keys and distinct history records', async () => {
  snapshot = await captureSnapshot(config);
  assert.equal(snapshot.events.length, 7);
  assert.equal(snapshot.events[1].fields.amount, '9999999999999999999999.99');
  assert.equal(snapshot.events[0].source_key.requesttime, '2026-01-01 00:00:00');
  assert.equal(snapshot.events[0].fields.ccy, 'RAW_CCY');
  assert.equal(snapshot.events[0].fields.result, null);
  assert.equal(snapshot.events[2].fields.result, '');
  assert.equal(snapshot.events[0].source_key.id, snapshot.events[1].source_key.id);
  assert.notDeepEqual(snapshot.events[0].source_key, snapshot.events[1].source_key);
  assert.equal(snapshot.events[3].source_table, 'transfer_hist');
  assert.ok(!JSON.stringify(snapshot).includes('account'));
});

test('private durable spool survives process reload and rejects overwrite, partial files and unsafe paths', async () => {
  const base = join(scratch, 'snapshots');
  await saveSnapshot(base, snapshot);
  assert.equal((await lstat(join(base, snapshot.capture_id, 'snapshot.json'))).mode & 0o077, 0);
  assert.deepEqual(await readSnapshot(base, snapshot.capture_id), snapshot);
  await assert.rejects(saveSnapshot(base, snapshot), { code: 'EEXIST' });
  const file = join(base, snapshot.capture_id, 'snapshot.json');
  await chmod(file, 0o644);
  try { await assert.rejects(readSnapshot(base, snapshot.capture_id), /Unsafe/); }
  finally { await chmod(file, 0o600); }
  await symlink(base, join(scratch, 'linked-spool'));
  await assert.rejects(readSnapshot(join(scratch, 'linked-spool'), snapshot.capture_id), /Unsafe/);
  await assert.rejects(readSnapshot(base, '../source'), /Invalid/);
  const fifoId = randomUUID(); await mkdir(join(base, fifoId), { mode: 0o700 });
  execFileSync('mkfifo', ['-m', '600', join(base, fifoId, 'snapshot.json')]);
  await assert.rejects(readSnapshot(base, fifoId), /Unsafe/);
  const fresh = { ...snapshot, capture_id: randomUUID(), events: [] };
  await saveSnapshot(base, fresh);
  const pending = join(base, fresh.capture_id, 'snapshot.json');
  await writeFile(pending, '{', { mode: 0o600 });
  await assert.rejects(readSnapshot(base, fresh.capture_id));
});

test('MariaDB to PostgreSQL import commits all 7 events and replay is all duplicates', async () => {
  const persisted = await readSnapshot(join(scratch, 'snapshots'), snapshot.capture_id);
  assert.deepEqual(await importSnapshot(persisted, dsn(postgres, 'intake')), { status: 'complete', total: 7, inserted: 7, duplicate: 0, conflict: 0, failed: 0, unattempted: 0 });
  assert.equal((await importSnapshot(persisted, dsn(postgres, 'intake'))).duplicate, 7);
  const rows = (await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows;
  assert.equal(rows[0].n, 7);
  assert.equal((await app.pool.query("SELECT count(*)::int AS n FROM platform.source_records WHERE source_table IN ('transfer','transfer_hist')")).rows[0].n, 4);
});

test('same event identity with modified content is a redacted conflict and stops the import', async () => {
  const altered = structuredClone(snapshot);
  altered.events[0].fields.amount = '222.22';
  assert.deepEqual(await importSnapshot(altered, dsn(postgres, 'intake')), { status: 'failed', total: 7, inserted: 0, duplicate: 0, conflict: 1, failed: 0, unattempted: 6 });
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows[0].n, 7);
});

test('PostgreSQL outage retains frozen snapshot and retry works while MariaDB is stopped', async () => {
  await stopCluster(postgres);
  const failed = await importSnapshot(await readSnapshot(join(scratch, 'snapshots'), snapshot.capture_id), dsn(postgres, 'intake'));
  assert.equal(failed.status, 'failed'); assert.equal(failed.failed, 1); assert.equal(failed.unattempted, 6);
  await stopServer(source);
  await startCluster(postgres);
  try { assert.equal((await importSnapshot(await readSnapshot(join(scratch, 'snapshots'), snapshot.capture_id), dsn(postgres, 'intake'))).duplicate, 7); }
  finally { await startServer(source); }
});

test('partial target commit can be replayed to finish without duplicating earlier commits', async () => {
  const next = await captureSnapshot(config);
  const { createSourceIntake } = await import('@lmps/database');
  const intake = createSourceIntake(dsn(postgres, 'intake'));
  try { await intake.append(next.events[0]); await intake.append(next.events[1]); }
  finally { await intake.close(); }
  const report = await importSnapshot(next, dsn(postgres, 'intake'));
  assert.equal(report.inserted, 5); assert.equal(report.duplicate, 2);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_records')).rows[0].n, 7);
});

test('keyset pagination covers multiple pages without losing equal-id composite keys', async () => {
  await addRows(BATCH_SIZE + 1);
  try {
    const captured = await captureSnapshot(config);
    assert.equal(captured.events.filter(event => event.source_table === 'transfer').length, 29);
    assert.equal(new Set(captured.events.map(event => event.event_key)).size, captured.events.length);
  } finally { await alter('DELETE FROM lmps_source_local.transfer WHERE id>=100'); }
});

test('one InnoDB snapshot excludes concurrent inserts and cross-table updates', async () => {
  const original = mariadb.createConnection;
  let changed = false;
  const replacement = mock.method(mariadb, 'createConnection', async options => {
    const connection = await original.call(mariadb, options);
    if (options.user === 'lmps_snapshot') {
      const query = connection.query.bind(connection);
      connection.query = async (options, values) => {
        const result = await query(options, values);
        if (!changed && options.sql.includes('FROM `transfer`')) {
          changed = true;
          await alter("UPDATE lmps_source_local.transfer_hist SET amount='888.88'");
          await addRows(1);
        }
        return result;
      };
    }
    return connection;
  });
  try {
    const captured = await captureSnapshot(config);
    assert.equal(changed, true);
    assert.equal(captured.events.length, 7);
    assert.equal(captured.events.find(event => event.source_table === 'transfer_hist').fields.amount, '123.45');
  } finally {
    replacement.mock.restore();
    await alter("UPDATE lmps_source_local.transfer_hist SET amount='123.45'");
    await alter('DELETE FROM lmps_source_local.transfer WHERE id>=100');
  }
});

test('oversized source and unsupported table engine fail capture without publishing a partial snapshot', async () => {
  await addRows(98);
  try { await assert.rejects(captureSnapshot(config), failure('CAPTURE_FAILED')); }
  finally { await alter('DELETE FROM lmps_source_local.transfer WHERE id>=100'); }
  await alter('ALTER TABLE lmps_source_local.member ENGINE=MyISAM');
  try { await assert.rejects(captureSnapshot(config), failure('CAPTURE_FAILED')); }
  finally { await alter('ALTER TABLE lmps_source_local.member ENGINE=InnoDB'); }
});

test('failed source capture is redacted and does not change target evidence', async () => {
  await stopServer(source);
  try { await assert.rejects(captureSnapshot(config), failure('CAPTURE_FAILED')); }
  finally { await startServer(source); }
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows[0].n, 14);
  for (const state of [source, postgres]) {
    const log = await readFile(join(state.base, 'server.log'), 'utf8');
    for (const secret of [source.snapshotPassword, source.adminPassword, ...Object.values(postgres.passwords), 'SYNTHETIC_PRIVATE_VALUE']) assert.ok(!log.includes(secret));
  }
});

test('input boundaries reject remote/admin/live config and edited snapshot scope/order/identities', () => {
  assert.deepEqual(validateConfig(config), config);
  for (const change of [{ host: 'example.invalid' }, { user: 'root' }, { ssl: false }, { sourceGeneration: 'guessed' }, { port: 0 }]) assert.throws(() => validateConfig({ ...config, ...change }), failure('INVALID_CONFIG'));
  const previous = process.env.LMPS_EXECUTION_MODE;
  try { process.env.LMPS_EXECUTION_MODE = 'live'; assert.throws(() => validateSnapshot(snapshot), failure('INVALID_CONFIG')); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
  for (const change of [{ capture_id: randomUUID() }, { extra: true }, { events: [...snapshot.events].reverse() }]) assert.throws(() => validateSnapshot({ ...snapshot, ...change }), failure('INVALID_SNAPSHOT'));
  for (const change of [{ workspace_key: 'synthetic_other' }, { event_key: 'transfer:9' }, { operation: 'insert' }, { source_generation: randomUUID() }, { fields: { ...snapshot.events[0].fields, fromaccount: 'SYNTHETIC_PRIVATE_VALUE' } }]) {
    const invalid = structuredClone(snapshot); Object.assign(invalid.events[0], change);
    assert.throws(() => validateSnapshot(invalid), failure('INVALID_SNAPSHOT'));
  }
  const query = pageQuery('transfer', { id: '1', requesttime: '2026-01-01 00:00:00' });
  assert.deepEqual(query.parameters, ['1', '1', '2026-01-01 00:00:00']);
  assert.ok(!query.sql.includes('OFFSET')); assert.ok(!query.sql.includes('account'));
});
