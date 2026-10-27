import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import { BATCH_SIZE, captureSnapshot } from '../dist/snapshot.js';

const config = { kind: 'local_synthetic', host: '127.0.0.1', port: 18504, database: 'lmps_source_local', user: 'lmps_snapshot', password: randomUUID(), caFile: fileURLToPath(new URL('../../risk-api/README.md', import.meta.url)), sourceGeneration: randomUUID() };
const engines = ['transfer', 'transfer_hist', 'transfer_old', 'member'].map(TABLE_NAME => ({ TABLE_NAME, ENGINE: 'InnoDB' }));

test('capture uses verified TLS, exact driver types, read-only repeatable snapshot and bounded allowlisted queries', async () => {
  const calls = []; let destroyed = false;
  const replacement = mock.method(mariadb, 'createConnection', async options => {
    assert.equal(options.ssl.rejectUnauthorized, true); assert.equal(options.ssl.servername, 'localhost');
    assert.equal(options.ssl.minVersion, 'TLSv1.2'); assert.equal(options.dateStrings, true);
    assert.equal(options.decimalAsNumber, false); assert.equal(options.bigIntAsNumber, false);
    assert.equal(options.multipleStatements, false); assert.equal(options.permitLocalInfile, false);
    return { on() {}, destroy() { destroyed = true; }, async query(options, parameters) {
      assert.equal(options.timeout, 800); calls.push([options.sql, parameters]);
      if (options.sql.startsWith('SELECT VERSION')) return [{ version: '11.8.9-MariaDB', port: 18504, readonly: 1 }];
      if (options.sql.includes('information_schema')) return engines;
      if (options.sql.startsWith('SELECT')) return [];
      return {};
    } };
  });
  try {
    assert.equal((await captureSnapshot(config)).events.length, 0);
    assert.equal(calls[1][0], 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    assert.equal(calls[2][0], 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    assert.equal(calls.at(-1)[0], 'COMMIT');
    for (const [sql] of calls.slice(3, 7)) {
      assert.ok(sql.endsWith(`LIMIT ${BATCH_SIZE}`)); assert.ok(!/account|OFFSET|SELECT \*/.test(sql));
    }
    assert.equal(destroyed, true);
  } finally { replacement.mock.restore(); }
});

test('source failure after earlier tables destroys transaction and returns no partial snapshot or raw diagnostic', async () => {
  let destroyed = false;
  const replacement = mock.method(mariadb, 'createConnection', async () => ({ on() {}, destroy() { destroyed = true; }, async query({ sql }) {
    if (sql.startsWith('SELECT VERSION')) return [{ version: '11.8.9-MariaDB', port: 18504, readonly: 1 }];
    if (sql.includes('transfer_hist')) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    if (sql.startsWith('SELECT')) return [];
    return {};
  } }));
  try {
    await assert.rejects(captureSnapshot(config), error => error.code === 'CAPTURE_FAILED' && !error.message.includes('SYNTHETIC_PRIVATE_VALUE'));
    assert.equal(destroyed, true);
  } finally { replacement.mock.restore(); }
});

test('total capture watchdog cancels a nonresponding query even if driver timeout does not fire', async () => {
  let destroyed = false;
  const originalTimer = globalThis.setTimeout;
  const timer = mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => originalTimer(callback, delay === 10000 ? 20 : delay, ...args));
  const replacement = mock.method(mariadb, 'createConnection', async () => ({ on() {}, destroy() { destroyed = true; }, query() { return new Promise(() => {}); } }));
  try {
    await assert.rejects(captureSnapshot(config), { code: 'CAPTURE_FAILED' });
    assert.equal(destroyed, true);
  } finally { replacement.mock.restore(); timer.mock.restore(); }
});
