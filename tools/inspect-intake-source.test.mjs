import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDatabase, createTransactionRevisions } from '../packages/database/dist/index.js';
import { availablePort, initializeCluster, startCluster, stopCluster, dsn } from '../packages/database/scripts/local.mjs';
import { migrations } from '../packages/database/scripts/migrations.mjs';
import { auditFixture } from '../packages/contracts/fixtures/intake-audit.mjs';
import { makeSourcePublication } from '../packages/contracts/dist/source-publication.js';
import { inspectIntakeSource } from './inspect-intake-source.mjs';

test('real read-only repeatable-read audit binds v1/v2 history and preserves revisions, risk jobs and Alerts', async () => {
  const directory = await mkdtemp('/tmp/lmps-source-audit-');
  let state, owner, reader, writer;
  try {
    state = await initializeCluster(join(directory, 'pg'), await availablePort());
    await startCluster(state); await migrations(dsn(state, 'migration'), true);
    owner = createDatabase(dsn(state, 'migration'), 'migration');
    reader = createDatabase(dsn(state), 'app', 'synthetic_csv');
    writer = createTransactionRevisions(dsn(state, 'intake'));
    const rows = auditFixture();
    for (const row of rows) await writer.append({ format: 1, execution_mode: 'test', provenance: row.provenance,
      workspace_key: row.workspace_key, expected_revision: row.revision_number - 1, transaction: row.payload, publication: row.publication });
    const snapshot = async () => (await owner.pool.query(`SELECT 'revisions' AS kind,to_jsonb(row) AS content FROM platform.local_transaction_revisions row
      UNION ALL SELECT 'risks',to_jsonb(row) FROM platform.local_transaction_risks row
      UNION ALL SELECT 'jobs',to_jsonb(row) FROM platform.local_risk_jobs row
      UNION ALL SELECT 'alerts',to_jsonb(row) FROM platform.local_alerts row ORDER BY kind,content`)).rows;
    const before = await snapshot(), statements = [];
    let appendDuringRead = false;
    const original = rows[0].publication, correctedValues = [...original.origin.values]; correctedValues[2] = '1.00';
    const correction = makeSourcePublication({ workspace: 'synthetic_local', namespace: 'synthetic_csv', generation: original.source.source_generation,
      batch: original.capture_id, dataset_sha256: original.snapshot_sha256, rows_sha256: original.evidence_sha256,
      source_namespace: original.origin.source_namespace, row_number: original.origin.row_number, values: correctedValues,
      observed_at: '2026-11-05T00:00:00.000Z', expected_revision: 1 });
    const database = { pool: { connect: async () => {
      const client = await reader.pool.connect();
      return { release: discard => client.release(discard), query: async (sql, values) => {
        statements.push(sql);
        if (sql.startsWith('SELECT count')) {
          assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
          assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read');
        }
        const result = await client.query(sql, values);
        if (sql.startsWith('SELECT count') && appendDuringRead) {
          appendDuringRead = false;
          await writer.append({ format: 1, execution_mode: 'test', provenance: 'user_supplied_file', workspace_key: 'synthetic_local',
            expected_revision: 1, ...correction });
        }
        return result;
      } };
    } } };
    const report = await inspectIntakeSource(database);
    assert.equal(report.transactions, 4); assert.equal(report.stored_revisions, 6);
    assert.deepEqual(report.currencies[0], { currency: 'LAK', transactions: 3, succeeded: 1, failed: 1, unknown: 1 });
    assert.equal(report.refund_instruction.required, 1); assert.equal(report.identity.verified_transactions, 0);
    assert.deepEqual(await inspectIntakeSource(reader), report); assert.deepEqual(await snapshot(), before);
    assert.ok(statements.every(sql => /^(BEGIN|SELECT|COMMIT)/.test(sql)));
    appendDuringRead = true;
    assert.deepEqual(await inspectIntakeSource(database), report);
    const updated = await inspectIntakeSource(reader);
    assert.equal(updated.transactions, 4); assert.equal(updated.stored_revisions, 7);
    assert.notEqual(updated.evidence_sha256, report.evidence_sha256);
    await stopCluster(state);
    await assert.rejects(inspectIntakeSource(reader), /^Error: INTAKE_REVISION_AUDIT_INVALID; private values withheld\.$/);
    await startCluster(state);
    assert.deepEqual(await inspectIntakeSource(reader), updated);
  } finally {
    for (const service of [writer, reader, owner]) await service?.close();
    if (state) await stopCluster(state);
    await rm(directory, { recursive: true, force: true });
  }
});

test('oversized reads, corruption and rollback failure never return partial success and discard broken clients', async () => {
  for (const scenario of ['oversized', 'oversized_bytes', 'corrupt', 'count_mismatch', 'rollback_failed', 'connect_failed']) {
    const statements = []; let released;
    const database = { pool: { connect: async () => {
      if (scenario === 'connect_failed') throw Error('private diagnostic');
      return { release: value => { released = value; }, query: async sql => {
      statements.push(sql);
      if (sql === 'ROLLBACK' && scenario === 'rollback_failed') throw Error('private diagnostic');
      if (sql.startsWith('SELECT count')) return { rows: [{ revisions: scenario === 'oversized' ? 10001 : scenario === 'count_mismatch' ? 2 : 1,
        bytes: scenario === 'oversized_bytes' ? '67108865' : '1' }] };
      return { rows: [null] };
    } };
    } } };
    await assert.rejects(inspectIntakeSource(database), /^Error: INTAKE_REVISION_AUDIT_INVALID; private values withheld\.$/);
    assert.equal(statements.includes('ROLLBACK'), scenario !== 'connect_failed'); assert.ok(!statements.includes('COMMIT'));
    assert.equal(released, scenario === 'connect_failed' ? undefined : scenario === 'rollback_failed');
    if (scenario.startsWith('oversized')) assert.equal(statements.filter(sql => sql.startsWith('SELECT')).length, 1);
  }
});

test('CLI rejects unknown arguments and production before touching persistent state or echoing inputs', () => {
  const value = 'private-canary-value';
  for (const attempt of [{ args: ['--input', value], env: { NODE_ENV: 'test' } },
    { args: [], env: { NODE_ENV: 'production' } }, { args: [], env: { NODE_ENV: 'test', LMPS_RUNTIME_PROFILE: 'local' } }]) {
    const child = spawnSync(process.execPath, ['tools/inspect-intake-source.mjs', ...attempt.args], {
      encoding: 'utf8', env: { ...process.env, ...attempt.env }, timeout: 5000,
    });
    assert.equal(child.status, 1); assert.equal(child.stdout, '');
    assert.equal(child.stderr.trim(), 'INTAKE_REVISION_AUDIT_INVALID; private values withheld.');
    assert.ok(!child.stderr.includes(value));
  }
});
