import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { chmod, link, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions } from '@lmps/database';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { revision } from '../../../packages/database/test/fixtures/transaction-revision.mjs';
import { backtestRun } from '../scripts/backtest.mjs';
import { savePrivateReport } from '../scripts/private-json.mjs';
import { runBacktest, evaluateBacktest } from '../dist/rule-backtest.js';
import { backtestFixture, changePublication, observationFromRevision } from './fixtures/rule-backtest.mjs';

let temporary, state, owner, writer, f, inputs, reports;
const snapshots = async () => (await owner.pool.query(`SELECT
  (SELECT count(*) FROM platform.source_events)::int AS events,
  (SELECT count(*) FROM platform.local_transaction_revisions)::int AS revisions,
  (SELECT count(*) FROM platform.local_outbox_intents)::int AS outbox,
  (SELECT count(*) FROM platform.audit_events)::int AS audit,
  (SELECT count(*) FROM platform.local_sync_jobs)::int AS jobs`)).rows[0];
const saveInput = manifest => savePrivateReport(inputs, 'v1', manifest.run_id, 'input.json', manifest, 128 * 1024);
const file = manifest => join(inputs, 'v1', manifest.run_id, 'input.json');
const output = manifest => join(reports, 'v1', manifest.run_id, 'backtest.json');
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-rule-native-'); inputs = join(temporary, 'inputs'); reports = join(temporary, 'reports');
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); writer = createTransactionRevisions(dsn(state, 'intake'));
});
beforeEach(async () => {
  await owner.pool.query('TRUNCATE platform.local_transaction_revisions'); f = backtestFixture(); await writer.append(f.observations[0].revision);
});
after(async () => {
  await writer?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('readonly PG backtest matches the pure reference report without source/revision/job/audit/outbox writes', async () => {
  const before = await snapshots();
  const report = await runBacktest(f.manifest, dsn(state));
  assert.deepEqual(report, evaluateBacktest(f.manifest, f.observations)); assert.deepEqual(await snapshots(), before);
  assert.equal(report.counts.rule_matches, 1); assert.equal(report.rows[0].source.capture_id, f.observations[0].revision.publication.capture_id);
  await assert.rejects(runBacktest(f.manifest, dsn(state, 'intake')), /Invalid local PostgreSQL configuration/);
});

test('pinned old revision stays reproducible after a new published revision; explicit new target produces a new input fingerprint', async () => {
  const first = await runBacktest(f.manifest, dsn(state));
  const next = changePublication(f.observations[0], p => { p.binding.expected_revision = 1; p.binding.transaction_revision = 'synthetic_revision_2'; p.normalization_input.status_code = 'SYNTH_FAILED'; });
  await writer.append(next.revision); assert.deepEqual(await runBacktest(f.manifest, dsn(state)), first);
  f.manifest.targets = [next.target]; const result = await runBacktest(f.manifest, dsn(state));
  assert.notEqual(result.input_set_sha256, first.input_set_sha256); assert.equal(result.counts.not_applicable, 2);
});

test('missing and legacy unknown revisions are explicit unavailable; foreign workspace rows never satisfy the target', async () => {
  const unknown = revision(); await writer.append(unknown);
  const foreign = revision(); foreign.workspace_key = 'synthetic_other'; foreign.transaction.transaction_id = 'synthetic_foreign'; await writer.append(foreign);
  const legacy = observationFromRevision(unknown); f.manifest.targets.push(legacy.target, { namespace: foreign.transaction.source_reference.namespace, transaction_id: 'synthetic_foreign', revision_number: 1 });
  const report = await runBacktest(f.manifest, dsn(state));
  assert.equal(report.status, 'partial'); assert.equal(report.counts.available_inputs, 1); assert.equal(report.counts.unavailable_inputs, 2);
  assert.ok(report.rows.some(row => row.availability === 'not_normalized')); assert.ok(report.rows.some(row => row.availability === 'missing'));
  const bad = { ...f.manifest, workspace_key: 'synthetic_other' }; await assert.rejects(runBacktest(bad, dsn(state)), /details withheld/);
});

test('corrupt stored proof produces unavailable evidence without propagating raw canaries or creating a negative result', async () => {
  await owner.pool.query("UPDATE platform.local_transaction_revisions SET publication=jsonb_set(publication,'{normalization_input,status_code}',to_jsonb('SYNTHETIC_PRIVATE_VALUE'::text))");
  const report = await runBacktest(f.manifest, dsn(state)); assert.equal(report.status, 'partial'); assert.equal(report.counts.unavailable, 2);
  assert.equal(report.counts.no_matches, 0); assert.equal(report.rows[0].availability, 'invalid'); assert.equal(report.rows[0].source, null);
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('private backtest handler publishes an immutable report; same input replay acknowledges duplicate and changed rules cannot overwrite it', async () => {
  await saveInput(f.manifest); const frozenInput = await readFile(file(f.manifest)); const before = await snapshots();
  const result = await backtestRun(inputs, reports, f.manifest.run_id, dsn(state)); assert.equal(result.status, 'evaluated');
  const first = await readFile(output(f.manifest)); assert.equal((await lstat(output(f.manifest))).mode & 0o077, 0);
  assert.equal((await backtestRun(inputs, reports, f.manifest.run_id, dsn(state))).status, 'duplicate');
  assert.deepEqual(await readFile(file(f.manifest)), frozenInput); assert.deepEqual(await readFile(output(f.manifest)), first);
  f.manifest.rules[0].threshold = '43.00'; await writeFile(file(f.manifest), JSON.stringify(f.manifest), { mode: 0o600 });
  await assert.rejects(backtestRun(inputs, reports, f.manifest.run_id, dsn(state)), /diagnostics withheld/);
  assert.deepEqual(await readFile(output(f.manifest)), first); assert.deepEqual(await snapshots(), before);
});

test('unsafe permissions, links/FIFO, mismatched run ID and partial manifests reject without report publication', async () => {
  await saveInput(f.manifest); const path = file(f.manifest), original = await readFile(path);
  const reject = () => assert.rejects(backtestRun(inputs, reports, f.manifest.run_id, dsn(state)), /diagnostics withheld/);
  await chmod(path, 0o644); try { await reject(); } finally { await chmod(path, 0o600); }
  const hard = join(temporary, 'hardlink'); await link(path, hard); try { await reject(); } finally { await rm(hard); }
  const linked = join(temporary, 'linked'); await symlink(inputs, linked); await assert.rejects(backtestRun(linked, reports, f.manifest.run_id, dsn(state)));
  const bad = JSON.parse(original); bad.run_id = randomUUID(); await writeFile(path, JSON.stringify(bad), { mode: 0o600 }); await reject();
  await writeFile(path, '{', { mode: 0o600 }); await reject(); await rm(path); execFileSync('mkfifo', ['-m', '600', path]); await reject();
  await rm(path); await writeFile(path, original, { mode: 0o600 });
  await assert.rejects(lstat(output(f.manifest)), { code: 'ENOENT' });
});

test('database outage is unavailable storage and does not publish a report of invented missing rows; restart permits replay', async () => {
  await saveInput(f.manifest); await stopCluster(state);
  try {
    await assert.rejects(runBacktest(f.manifest, dsn(state)), /storage details withheld/);
    await assert.rejects(backtestRun(inputs, reports, f.manifest.run_id, dsn(state)), /diagnostics withheld/);
    await assert.rejects(lstat(output(f.manifest)), { code: 'ENOENT' });
  } finally { await startCluster(state); }
  assert.equal((await backtestRun(inputs, reports, f.manifest.run_id, dsn(state))).report_status, 'complete');
});

test('live/production execution rejects before opening a database or publishing files', async () => {
  await saveInput(f.manifest);
  for (const [name, value] of [['NODE_ENV', 'production'], ['LMPS_ENVIRONMENT', 'production'], ['LMPS_EXECUTION_MODE', 'live']]) {
    const previous = process.env[name]; process.env[name] = value;
    try { await assert.rejects(runBacktest(f.manifest, 'invalid-dsn')); await assert.rejects(backtestRun(inputs, reports, f.manifest.run_id, 'invalid-dsn')); }
    finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
  }
  await assert.rejects(lstat(output(f.manifest)), { code: 'ENOENT' });
});
