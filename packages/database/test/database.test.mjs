import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cp, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createDatabase, localPoolConfig } from '../dist/index.js';
import { availablePort, binaryDirectory, dsn, initializeCluster, loadState, localMode, running, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';

let temporary;
let state;
let app;
let migration;
const folder = fileURLToPath(new URL('../migrations/', import.meta.url));

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'lmps-db-test-'));
  state = await initializeCluster(join(temporary, 'cluster'), await availablePort());
  await startCluster(state);
  app = createDatabase(dsn(state));
  migration = createDatabase(dsn(state, 'migration'), 'migration');
});

after(async () => {
  await app?.close();
  await migration?.close();
  if (temporary && !state) {
    try { state = await loadState(join(temporary, 'cluster')); }
    catch { return; } // Preserve failed/unverifiable scratch state rather than delete a live cluster.
  }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('local config fixes role/host/db, bounds pools and rejects credential/options overrides', () => {
  const options = localPoolConfig(dsn(state));
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.database, 'lmps_risk_local');
  assert.equal(options.user, 'lmps_app');
  assert.equal(options.max, 4);
  assert.equal(localPoolConfig(dsn(state, 'migration'), 'migration').max, 1);
  assert.throws(() => localPoolConfig(dsn(state, 'migration'), 'unknown'));
  const previous = process.env.LMPS_PG_BIN;
  try {
    process.env.LMPS_PG_BIN = 'relative-directory';
    assert.throws(() => binaryDirectory(), /absolute directory/);
  } finally {
    if (previous === undefined) delete process.env.LMPS_PG_BIN;
    else process.env.LMPS_PG_BIN = previous;
  }
  const example = dsn(state);
  for (const invalid of ['', example.replace('127.0.0.1', 'example.invalid'), example.replace('lmps_app', 'lmps_migrator'), example.replace(':' + state.port + '/', ':0/'), example.replace('lmps_risk_local', 'postgres'), example + '?host=example.invalid', example + '#override', example.replace(state.passwords.app, '%zz')]) {
    assert.throws(() => localPoolConfig(invalid), error => error.message === 'Invalid local PostgreSQL configuration.');
  }
  assert.throws(() => localMode({ LMPS_ENVIRONMENT: 'production' }));
  assert.throws(() => localMode({ LMPS_EXECUTION_MODE: 'live' }));
});

test('owned cluster is loopback-only with private state, no Unix socket and SCRAM', async () => {
  assert.equal(running(state), true);
  assert.equal((await loadState(state.base)).port, state.port);
  assert.equal((await lstat(join(state.base, 'state.json'))).mode & 0o077, 0);
  assert.equal((await lstat(join(state.base, 'app.env'))).mode & 0o077, 0);
  await assert.rejects(lstat(join(state.base, 'init-password')), { code: 'ENOENT' });
  const admin = new pg.Client({ host: '127.0.0.1', port: state.port, user: 'lmps_bootstrap', password: state.passwords.bootstrap, database: 'postgres', ssl: false, connectionTimeoutMillis: 1000 });
  try {
    await admin.connect();
    for (const [setting, expected] of [['listen_addresses', '127.0.0.1'], ['unix_socket_directories', ''], ['password_encryption', 'scram-sha-256']]) {
      assert.equal((await admin.query('SELECT current_setting($1) AS value', [setting])).rows[0].value, expected);
    }
  } finally { await admin.end(); }
  assert.match((await migration.pool.query('SHOW server_version')).rows[0].server_version, /^18\./);
});

test('initialization refuses an existing cluster and unowned/symlink state', async () => {
  const before = await readFile(join(state.base, 'state.json'));
  await assert.rejects(initializeCluster(state.base, state.port), { code: 'EEXIST' });
  assert.equal(Buffer.compare(before, await readFile(join(state.base, 'state.json'))), 0);
  const link = join(temporary, 'link');
  await symlink(state.base, link);
  await assert.rejects(loadState(link));
  await assert.rejects(loadState(temporary));
});

test('status is non-mutating and concurrent Drizzle migration applies foundation once', async () => {
  assert.deepEqual(await migrations(dsn(state, 'migration')), [{ migration: '0000_foundation', status: 'pending' }, { migration: '0001_local_source_intake', status: 'pending' }, { migration: '0002_intake_column_grants', status: 'pending' }, { migration: '0003_local_outbox', status: 'pending' }, { migration: '0004_local_audit', status: 'pending' }, { migration: '0005_local_sync_jobs', status: 'pending' }, { migration: '0006_local_transaction_revisions', status: 'pending' }, { migration: '0007_local_normalization_publications', status: 'pending' }, { migration: '0008_local_rule_assessments', status: 'pending' }, { migration: '0009_local_transaction_risks', status: 'pending' }, { migration: '0010_local_alerts', status: 'pending' }, { migration: '0011_local_risk_jobs', status: 'pending' }, { migration: '0012_offline_datasets', status: 'pending' }, { migration: '0013_local_risk_policy_lifecycle', status: 'pending' }, { migration: '0014_local_cases', status: 'pending' }, { migration: '0015_local_model_receipts', status: 'pending' }, { migration: '0016_local_label_adjudications', status: 'pending' }]);
  assert.equal((await migration.pool.query("SELECT to_regclass('lmps_migrations.__drizzle_migrations') AS name")).rows[0].name, null);
  // A contender may exhaust the configured lock budget while thirteen migrations run; wait for both before retrying.
  const attempts = await Promise.allSettled([migrations(dsn(state, 'migration'), true), migrations(dsn(state, 'migration'), true)]);
  assert.ok(attempts.some(result => result.status === 'fulfilled'));
  for (const result of attempts) if (result.status === 'rejected') assert.equal(result.reason.message, 'Local database migration check/apply failed.');
  await migrations(dsn(state, 'migration'), true);
  assert.deepEqual(await migrations(dsn(state, 'migration')), [{ migration: '0000_foundation', status: 'applied' }, { migration: '0001_local_source_intake', status: 'applied' }, { migration: '0002_intake_column_grants', status: 'applied' }, { migration: '0003_local_outbox', status: 'applied' }, { migration: '0004_local_audit', status: 'applied' }, { migration: '0005_local_sync_jobs', status: 'applied' }, { migration: '0006_local_transaction_revisions', status: 'applied' }, { migration: '0007_local_normalization_publications', status: 'applied' }, { migration: '0008_local_rule_assessments', status: 'applied' }, { migration: '0009_local_transaction_risks', status: 'applied' }, { migration: '0010_local_alerts', status: 'applied' }, { migration: '0011_local_risk_jobs', status: 'applied' }, { migration: '0012_offline_datasets', status: 'applied' }, { migration: '0013_local_risk_policy_lifecycle', status: 'applied' }, { migration: '0014_local_cases', status: 'applied' }, { migration: '0015_local_model_receipts', status: 'applied' }, { migration: '0016_local_label_adjudications', status: 'applied' }]);
  assert.equal((await migration.pool.query('SELECT count(*)::int AS count FROM lmps_migrations.__drizzle_migrations')).rows[0].count, 17);
  assert.equal((await migration.pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'platform'")).rows[0].count, 30);
});

test('app role cannot create schema/table/temp/roles, switch role or read migration ledger', async () => {
  const flags = (await app.pool.query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
  assert.equal(Object.values(flags).some(Boolean), false);
  for (const query of ['CREATE SCHEMA forbidden', 'CREATE TABLE platform.forbidden (id int)', 'CREATE TEMP TABLE forbidden (id int)', 'CREATE ROLE forbidden', 'SET ROLE lmps_migrator', 'SELECT * FROM lmps_migrations.__drizzle_migrations']) {
    await assert.rejects(app.pool.query(query), error => error.code === '42501');
  }
});

test('SCRAM rejects wrong passwords and app cannot connect to administrative database', async () => {
  const incorrect = new pg.Client({ ...localPoolConfig(dsn(state)), password: String.fromCharCode(120) });
  try { await assert.rejects(incorrect.connect(), error => error.code === '28P01'); }
  finally { await incorrect.end(); }
  const other = new pg.Client({ ...localPoolConfig(dsn(state)), database: 'postgres' });
  try { await assert.rejects(other.connect(), error => error.code === '28000'); }
  finally { await other.end(); }
});

test('real commit/rollback and driver/Drizzle preserve bigint, numeric and leading-zero text', async () => {
  await migration.pool.query('CREATE TABLE platform.synthetic_probe (id bigint PRIMARY KEY, amount numeric(24,2) NOT NULL, label text NOT NULL)');
  await migration.pool.query('GRANT SELECT, INSERT ON platform.synthetic_probe TO lmps_app');
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO platform.synthetic_probe VALUES ($1, $2, $3)', ['9007199254740993', '9999999999999999999999.99', '000001']);
    await client.query('COMMIT');
    await client.query('BEGIN');
    await client.query('INSERT INTO platform.synthetic_probe VALUES (2, 1.00, $1)', ['synthetic-rollback']);
    await assert.rejects(client.query('INSERT INTO platform.synthetic_probe VALUES (2, 2.00, $1)', ['synthetic-duplicate']), error => error.code === '23505');
    await client.query('ROLLBACK');
  } finally { client.release(); }
  const rows = await drizzle(app.pool).execute(sql`SELECT id, amount, label FROM platform.synthetic_probe`);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.rows)), [{ id: '9007199254740993', amount: '9999999999999999999999.99', label: '000001' }]);
});

test('statement timeout cancels work and the pool remains usable', async () => {
  await assert.rejects(app.pool.query('SELECT pg_sleep(3)'), error => error.code === '57014');
  assert.equal(await app.health(), 'available');
});

test('pool exhaustion has a bounded wait and releases all checked-out clients', async () => {
  const clients = [];
  try {
    for (let index = 0; index < 4; index++) clients.push(await app.pool.connect());
    const started = Date.now();
    await assert.rejects(app.pool.connect());
    assert.ok(Date.now() - started < 3000);
    assert.equal(app.pool.totalCount, 4);
  } finally { clients.forEach(client => client.release()); }
  assert.equal(await app.health(), 'available');
});

test('migration drift is rejected before applying and preserves ledger', async () => {
  const edited = join(temporary, 'edited');
  await cp(folder, edited, { recursive: true });
  const source = await readFile(join(edited, '0000_foundation.sql'), 'utf8');
  await writeFile(join(edited, '0000_foundation.sql'), source + '\n-- synthetic drift\n');
  await assert.rejects(migrations(dsn(state, 'migration'), true, edited), error => error.message === 'Local database migration check/apply failed.');
  assert.equal((await migration.pool.query('SELECT count(*)::int AS count FROM lmps_migrations.__drizzle_migrations')).rows[0].count, 17);
});

test('failed pending migration rolls back SQL effects and journal entry', async () => {
  const failed = join(temporary, 'failed');
  await cp(folder, failed, { recursive: true });
  const journal = JSON.parse(await readFile(join(failed, 'meta/_journal.json'), 'utf8'));
  journal.entries.push({ idx: 17, version: '7', when: journal.entries.at(-1).when + 1, tag: '0017_failure', breakpoints: true });
  await writeFile(join(failed, 'meta/_journal.json'), JSON.stringify(journal));
  await writeFile(join(failed, '0017_failure.sql'), 'CREATE TABLE platform.synthetic_failure (id int);\n--> statement-breakpoint\nSELECT 1 / 0;');
  await assert.rejects(migrations(dsn(state, 'migration'), true, failed));
  assert.equal((await migration.pool.query("SELECT to_regclass('platform.synthetic_failure') AS name")).rows[0].name, null);
  assert.equal((await migration.pool.query('SELECT count(*)::int AS count FROM lmps_migrations.__drizzle_migrations')).rows[0].count, 17);
});

test('migration lock contention fails within lock budget without applying anything', async () => {
  const client = await migration.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(18503, 8)');
    await assert.rejects(migrations(dsn(state, 'migration'), true));
  } finally { client.release(true); }
});

test('errors do not put password or bound-value canaries in the local server log', async () => {
  const canary = 'SYNTHETIC_PRIVATE_VALUE';
  await assert.rejects(app.pool.query('SELECT $1::integer', [canary]));
  const log = await readFile(join(state.base, 'server.log'), 'utf8');
  for (const value of [canary, ...Object.values(state.passwords)]) {
    if (log.includes(value)) throw new Error('Sensitive values found in local server log.');
  }
});

test('stopped database reports unavailable and restart preserves committed test data', async () => {
  await stopCluster(state);
  assert.equal(await app.health(), 'unavailable');
  await startCluster(state);
  assert.equal(await app.health(), 'available');
  assert.equal((await app.pool.query('SELECT count(*)::int AS count FROM platform.synthetic_probe')).rows[0].count, 1);
});
