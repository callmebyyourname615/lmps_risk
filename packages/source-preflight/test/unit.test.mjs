import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import { inspect, SQL, sanitizeReplication, sanitizeVariables, sanitizeVersion, validateConfig } from '../dist/index.js';
import { localMode, nativeDirectory, stopServer } from '../scripts/local.mjs';

const config = { kind: 'local_synthetic', host: '127.0.0.1', port: 18504, database: 'lmps_source_local', user: 'lmps_preflight', password: randomBytes(24).toString('base64url'), caFile: fileURLToPath(new URL('../../../README.md', import.meta.url)) };

test('local trust boundary rejects remote hosts, TLS overrides, other users and production', () => {
  assert.deepEqual(validateConfig(config), config);
  for (const override of [{ host: 'example.invalid' }, { host: 'localhost' }, { ssl: false }, { user: 'root' }, { database: 'mysql' }, { port: 0 }, { port: 65536 }, { caFile: 'relative' }, { kind: 'replica' }]) assert.throws(() => validateConfig({ ...config, ...override }));
  assert.throws(() => localMode({ NODE_ENV: 'production' }));
  assert.throws(() => localMode({ LMPS_EXECUTION_MODE: 'live' }));
  const previous = process.env.LMPS_MARIADB_BASE;
  try { process.env.LMPS_MARIADB_BASE = 'relative'; assert.throws(() => nativeDirectory(), /absolute/); }
  finally { if (previous === undefined) delete process.env.LMPS_MARIADB_BASE; else process.env.LMPS_MARIADB_BASE = previous; }
});

test('server suffixes, GTID positions, unknown settings and replication diagnostics are not disclosed', () => {
  const canary = 'SYNTHETIC_PRIVATE_VALUE';
  assert.deepEqual(sanitizeVersion([{ version: '11.8.9-MariaDB-' + canary }]), { status: 'OBSERVED', value: '11.8.9' });
  assert.equal(sanitizeVersion([{ version: '9.5.0' }]).status, 'UNVERIFIED');
  const variables = sanitizeVariables([{ Variable_name: 'gtid_binlog_pos', Value: '100-200-300' }, { Variable_name: 'unknown', Value: canary }, { Variable_name: 'read_only', Value: canary }]);
  assert.deepEqual(variables.gtid_binlog_pos, { status: 'OBSERVED', value: 'present' });
  assert.equal(variables.read_only.status, 'UNVERIFIED');
  assert.equal(variables.log_bin.reason, 'NOT_RETURNED');
  assert.ok(!JSON.stringify(variables).includes(canary));
  const replica = sanitizeReplication([{ Master_Host: canary, Master_User: canary, Connection_name: canary, Last_IO_Error: canary, Last_SQL_Error: canary, Slave_IO_Running: 'Connecting', Slave_SQL_Running: 'Yes', Seconds_Behind_Master: null, Last_IO_Errno: 123, Last_SQL_Errno: 0 }]);
  assert.ok(!JSON.stringify(replica).includes(canary));
  assert.equal(replica.value.channels[0].lag_seconds, null);
  assert.equal(replica.value.channels[0].last_io_errno, '123');
  assert.equal(sanitizeReplication(Array(33).fill({})).status, 'UNVERIFIED');
});

test('query allowlist uses bound schema/table names and redacts denied/raw backend errors', async () => {
  const calls = [];
  let destroyed = false;
  const connection = { on() {}, destroy() { destroyed = true; }, async query(options, parameters) {
    calls.push([options.sql, parameters]);
    assert.equal(options.timeout, 800);
    if (options.sql === SQL.readonly) return {};
    if (options.sql === SQL.version) return [{ version: '11.8.9-MariaDB' }];
    if (options.sql === SQL.replication) throw Object.assign(new Error('SYNTHETIC_PRIVATE_VALUE'), { errno: 1227 });
    if (options.sql === SQL.variables) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    return [];
  } };
  const replace = mock.method(mariadb, 'createConnection', async options => {
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.minVersion, 'TLSv1.2');
    assert.equal(options.multipleStatements, false);
    assert.equal(options.permitLocalInfile, false);
    assert.equal(options.maxAllowedPacket, 1048576);
    return connection;
  });
  try {
    const report = await inspect(config);
    assert.equal(report.replication.reason, 'PERMISSION_DENIED');
    assert.equal(report.variables.reason, 'QUERY_FAILED');
    assert.equal(report.schema.transfer.reason, 'TABLE_NOT_VISIBLE');
    assert.equal(report.status, 'partial');
    assert.equal(report.cdc_readiness_approved, false);
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC_PRIVATE_VALUE'));
    assert.deepEqual(calls.map(([sql]) => sql), Object.values(SQL));
    for (const [, parameters] of calls.slice(4)) assert.deepEqual(parameters, ['lmps_source_local', 'transfer', 'transfer_hist', 'transfer_old', 'member']);
    assert.equal(destroyed, true);
  } finally { replace.mock.restore(); }
});

test('oversized metadata results fail closed and timeout bounds even a nonresponding query', async () => {
  let mode = 'oversized';
  let destroyed = false;
  const replace = mock.method(mariadb, 'createConnection', async () => ({ on() {}, destroy() { destroyed = true; }, async query({ sql }) {
    if (sql === SQL.readonly) return {};
    if (mode === 'hung') return new Promise(() => {});
    return Array(2).fill({ version: '11.8.9-MariaDB' });
  } }));
  try {
    assert.equal((await inspect(config)).version.reason, 'INVALID_METADATA');
    mode = 'hung'; destroyed = false;
    const started = Date.now();
    assert.equal((await inspect(config)).version.reason, 'TIMEOUT');
    assert.ok(Date.now() - started < 3000);
    assert.equal(destroyed, true);
  } finally { replace.mock.restore(); }
});

test('connection errors have a fixed public message without credentials/CA contents', async () => {
  const replace = mock.method(mariadb, 'createConnection', async () => { throw new Error(config.password); });
  try { await assert.rejects(inspect(config), { message: 'Local metadata preflight failed; connection/transport details withheld.' }); }
  finally { replace.mock.restore(); }
});

test('owned shutdown handles late connection-killed events without hiding a rejected shutdown query', async () => {
  const scratch = await mkdtemp('/tmp/lmps-shutdown-');
  const state = { base: await realpath(scratch) };
  await mkdir(join(state.base, 'data'));
  let rejectShutdown = false, destroyed = 0, killed = 0;
  const replace = mock.method(mariadb, 'createConnection', async () => {
    const connection = new EventEmitter();
    connection.destroy = () => { destroyed++; };
    connection.query = async sql => {
      if (sql.startsWith('SELECT @@datadir')) return [{ directory: join(state.base, 'data') }];
      assert.equal(sql, 'SHUTDOWN');
      if (rejectShutdown) throw new Error('Synthetic shutdown query rejected.');
      queueMicrotask(() => { killed++; connection.emit('error', Object.assign(new Error('Connection was killed'), { errno: 1927 })); });
    };
    return connection;
  });
  try {
    await stopServer(state);
    assert.equal(killed, 1);
    rejectShutdown = true;
    await assert.rejects(stopServer(state), /Synthetic shutdown query rejected/);
    assert.equal(destroyed, 2);
  } finally { replace.mock.restore(); await rm(scratch, { recursive: true, force: true }); }
});
