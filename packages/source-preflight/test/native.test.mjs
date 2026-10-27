import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import mariadb from 'mariadb';
import { inspect } from '../dist/index.js';
import { admin, availablePort, initializeServer, loadState, running, startServer, stopServer } from '../scripts/local.mjs';
import { readLocalConfig } from '../scripts/preflight.mjs';

let scratch, state, config;
async function inspector(overrides = {}) {
  return mariadb.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database, connectTimeout: 1000, socketTimeout: 1500,
    ssl: { ca: await readFile(config.caFile, 'utf8'), servername: 'localhost', rejectUnauthorized: true, minVersion: 'TLSv1.2' }, ...overrides });
}
async function alter(sql) {
  const connection = await admin(state);
  try { return await connection.query(sql); }
  finally { await connection.end(); }
}

before(async () => {
  // Short private path also fits macOS Unix-socket limits in fresh-source runs.
  scratch = await mkdtemp('/tmp/lmps-src-');
  state = await initializeServer(join(scratch, 'db'), await availablePort());
  await startServer(state);
  config = await readLocalConfig(state.base);
});
after(async () => {
  if (scratch && !state) {
    try { state = await loadState(join(scratch, 'db')); }
    catch { return; } // Preserve incomplete/unverifiable state rather than delete a possibly live server.
  }
  if (state) await stopServer(state);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('real TLS metadata preflight matches selected DDL, estimates rows and never approves CDC/identity', async () => {
  const report = await inspect(config);
  assert.equal(report.status, 'complete_for_local_metadata');
  assert.equal(report.provenance, 'local_synthetic');
  assert.equal(report.full_source_ddl_verified, false);
  assert.equal(report.cdc_readiness_approved, false);
  assert.equal(report.account_identity_verified, false);
  assert.match(report.version.value, /^11\.8\./);
  assert.equal(report.variables.read_only.value, true);
  assert.equal(report.variables.log_bin.value, true);
  assert.equal(report.variables.binlog_format.value, 'ROW');
  assert.equal(report.variables.binlog_row_image.value, 'FULL');
  assert.equal(report.replication.value.channel_count, 0);
  for (const table of Object.values(report.schema)) {
    assert.equal(table.status, 'OBSERVED');
    assert.equal(table.estimate_is_exact, false);
    assert.deepEqual(table.differences, []);
  }
  for (const secret of [state.adminPassword, state.inspectorPassword]) if (JSON.stringify(report).includes(secret)) throw new Error('Report exposed generated credential.');
});

test('local credentials/state stay private and initialization refuses overwrite/symlink', async () => {
  const original = await readFile(join(state.base, 'state.json'));
  await assert.rejects(initializeServer(state.base, state.port), { code: 'EEXIST' });
  assert.equal(Buffer.compare(original, await readFile(join(state.base, 'state.json'))), 0);
  for (const name of ['state.json', 'preflight.json', 'ca.key', 'server.key', 'server.log']) assert.equal((await lstat(join(state.base, name))).mode & 0o077, 0);
  await symlink(state.base, join(scratch, 'link'));
  await assert.rejects(loadState(join(scratch, 'link')));
  await chmod(join(state.base, 'preflight.json'), 0o644);
  try { await assert.rejects(readLocalConfig(state.base)); }
  finally { await chmod(join(state.base, 'preflight.json'), 0o600); }
});

test('real authentication rejects wrong password, cleartext, wrong CA and wrong TLS identity', async () => {
  await assert.rejects(inspector({ password: String.fromCharCode(120) }), error => error.errno === 1045);
  await assert.rejects(inspector({ ssl: false }), error => error.errno === 1045 || error.errno === 3159);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(scratch, 'wrong.key'), '-out', join(scratch, 'wrong.crt'), '-subj', '/CN=Other Synthetic CA'], { stdio: 'pipe' });
  await assert.rejects(inspect({ ...config, caFile: join(scratch, 'wrong.crt') }), { message: 'Local metadata preflight failed; connection/transport details withheld.' });
  await assert.rejects(inspector({ ssl: { ca: await readFile(config.caFile, 'utf8'), servername: 'wrong.invalid', rejectUnauthorized: true } }), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
});

test('least privilege prevents mutation, system-table reads, DDL and replication administration', async () => {
  const connection = await inspector();
  try {
    for (const sql of ["INSERT INTO member (code) VALUES ('synthetic')", 'UPDATE member SET status = NULL', 'DELETE FROM member', 'CREATE TABLE forbidden (id int)', 'SELECT * FROM mysql.global_priv', 'SET GLOBAL read_only = OFF', 'STOP ALL REPLICAS']) {
      await assert.rejects(connection.query(sql), error => [1044, 1142, 1227, 1290].includes(error.errno));
    }
    assert.equal((await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'"))[0].Value.length > 0, true);
  } finally { await connection.end(); }
});

test('missing replica-monitor grant stays UNVERIFIED while schema checks continue', async () => {
  await alter("REVOKE REPLICA MONITOR ON *.* FROM 'lmps_preflight'@'127.0.0.1'");
  try {
    const report = await inspect(config);
    assert.equal(report.status, 'partial');
    assert.equal(report.replication.reason, 'PERMISSION_DENIED');
    assert.equal(report.schema.transfer.status, 'OBSERVED');
  } finally { await alter("GRANT REPLICA MONITOR ON *.* TO 'lmps_preflight'@'127.0.0.1'"); }
});

test('schema changes flag amount precision and unique-key drift without reading source rows', async () => {
  await alter('ALTER TABLE lmps_source_local.transfer MODIFY amount decimal(23,2) NOT NULL');
  try {
    const report = await inspect(config);
    assert.equal(report.schema.transfer.status, 'MISMATCH');
    assert.ok(report.schema.transfer.differences.some(item => item.column === 'amount' && item.issue === 'PRECISION_SCALE_MISMATCH'));
  } finally { await alter('ALTER TABLE lmps_source_local.transfer MODIFY amount decimal(24,2) NOT NULL'); }
  await alter('ALTER TABLE lmps_source_local.member ADD UNIQUE (iin)');
  try { assert.ok((await inspect(config)).schema.member.differences.some(item => item.issue === 'KEYS_DIFFER_OR_NOT_VISIBLE')); }
  finally { await alter('ALTER TABLE lmps_source_local.member DROP INDEX iin'); }
});

test('revoked table visibility is not reported as an empty verified table', async () => {
  await alter("REVOKE SELECT ON lmps_source_local.transfer_old FROM 'lmps_preflight'@'127.0.0.1'");
  try { assert.equal((await inspect(config)).schema.transfer_old.reason, 'TABLE_NOT_VISIBLE'); }
  finally { await alter("GRANT SELECT ON lmps_source_local.transfer_old TO 'lmps_preflight'@'127.0.0.1'"); }
});

test('native query deadline cancels bounded work and credential canaries stay out of server log', async () => {
  const connection = await inspector();
  try { await assert.rejects(connection.query({ sql: 'SELECT SLEEP(3)', timeout: 100 }), error => error.errno === 1969); }
  finally { connection.destroy(); }
  const log = await readFile(join(state.base, 'server.log'), 'utf8');
  for (const secret of [state.adminPassword, state.inspectorPassword]) if (log.includes(secret)) throw new Error('Server log exposed generated credential.');
});

test('stopped source fails redacted within connection budget; restart preserves fixture', async () => {
  await stopServer(state);
  assert.equal(await running(state), false);
  const started = Date.now();
  await assert.rejects(inspect(config), { message: 'Local metadata preflight failed; connection/transport details withheld.' });
  assert.ok(Date.now() - started < 3000);
  await startServer(state);
  assert.equal((await inspect(config)).status, 'complete_for_local_metadata');
});
