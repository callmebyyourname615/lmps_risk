import assert from 'node:assert/strict';
import test from 'node:test';
import { fork, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createOfflineDatasets, createTransactionRevisions } from '../packages/database/dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster } from '../packages/database/scripts/local.mjs';
import { migrations } from '../packages/database/scripts/migrations.mjs';
import { readPrivateJson } from '../apps/risk-workers/scripts/private-json.mjs';
import { readOfflineDataset } from '../apps/risk-workers/scripts/dataset-import.mjs';
import { automatedFixture, seedAutomatedPolicy } from '../apps/risk-workers/test/fixtures/automated-intake.mjs';
import { runAutomatedIntakeBatch } from './automated-intake.mjs';
import { revision } from '../packages/database/test/fixtures/transaction-revision.mjs';

test('private verified file resumes a real committed prefix and killed publisher, serializes owners, detects/reconciles/retries and preserves old evidence', { timeout: 90000 }, async () => {
  const directory = await mkdtemp('/tmp/lmps-auto-test-');
  let state, owner, staging, child;
  try {
    state = await initializeCluster(join(directory, 'pg'), await availablePort()); await startCluster(state);
    await migrations(dsn(state, 'migration'), true); await seedAutomatedPolicy(state);
    owner = createDatabase(dsn(state, 'migration'), 'migration');
    staging = createOfflineDatasets(dsn(state, 'intake'));
    const input = await automatedFixture(join(directory, 'first'));
    const snapshot = await readOfflineDataset(await readPrivateJson(input.manifestPath, 16384), input.inputPath);
    await staging.register(snapshot.manifest); await staging.append(snapshot.manifest, 1, snapshot.rows.slice(0, 1));
    assert.equal((await staging.status(snapshot.manifest.workspace_key, snapshot.manifest.batch_ref)).loaded_rows, 1);
    const requestPath = join(directory, 'request.json'); await writeFile(requestPath, JSON.stringify(input), { mode: 0o600 });
    child = fork(new URL('../apps/risk-workers/test/fixtures/automated-intake-child.mjs', import.meta.url), [state.base, requestPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let timer;
    try {
      await Promise.race([new Promise((resolve, reject) => { child.once('message', message => message.stage === 'published' ? resolve() : reject(Error('Unexpected progress'))); }),
        exited.then(() => { throw Error('Child exited before publication'); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Publication deadline')), 20000); })]);
    } finally { clearTimeout(timer); child.kill('SIGKILL'); await exited; }
    child = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const held = (await owner.pool.query('SELECT count(*)::int AS count FROM pg_locks WHERE locktype=$1 AND classid=$2 AND objid=$3', ['advisory', 18513, 33])).rows[0].count;
      if (!held) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const count = async table => (await owner.pool.query(`SELECT count(*)::int AS count FROM platform.${table}`)).rows[0].count;
    assert.equal(await count('offline_dataset_rows'), 4); assert.equal(await count('local_transaction_revisions'), 4);
    assert.equal(await count('local_transaction_risks'), 0);
    const phases = [], resumed = await runAutomatedIntakeBatch(state, input, async stage => { phases.push(stage); });
    assert.deepEqual(phases, ['verified', 'staged', 'published', 'detected', 'reconciled']);
    assert.equal(resumed.publication.duplicates, 4); assert.equal(resumed.detection.counts.with_assessment, 3);
    assert.equal(resumed.status, 'partial'); assert.equal(resumed.detection.counts.waiting_policy, 1);
    assert.equal(resumed.monitoring.alerts, 1); assert.equal(resumed.checkpoint.loaded_rows, 4);
    assert.deepEqual(resumed.currency_totals, [{ currency: 'LAK', rows: 3, recorded_amount: '1000030.00' }, { currency: 'THB', rows: 1, recorded_amount: '30.00' }]);
    const evidence = async () => (await owner.pool.query(`SELECT 'source' AS kind,to_jsonb(record) AS content FROM platform.source_records record
      UNION ALL SELECT 'events',to_jsonb(record) FROM platform.source_events record
      UNION ALL SELECT 'revisions',to_jsonb(record) FROM platform.local_transaction_revisions record
      UNION ALL SELECT 'risks',to_jsonb(record) FROM platform.local_transaction_risks record
      UNION ALL SELECT 'jobs',to_jsonb(record) FROM platform.local_risk_jobs record
      UNION ALL SELECT 'alerts',to_jsonb(record) FROM platform.local_alerts record ORDER BY kind,content`)).rows;
    const frozen = await evidence();
    const retry = await runAutomatedIntakeBatch(state, input);
    assert.equal(retry.detection.enqueued, 0); assert.equal(retry.detection.processed, 0); assert.deepEqual(await evidence(), frozen);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const active = runAutomatedIntakeBatch(state, input, async stage => { if (stage === 'verified') { enter(); await hold; } });
    try { await Promise.race([entered, active]); await assert.rejects(runAutomatedIntakeBatch(state, input), /AUTOMATED_INTAKE_FAILED/); }
    finally { release(); await active; }
    assert.deepEqual(await evidence(), frozen);
    const correction = await automatedFixture(join(directory, 'correction'), { amount: '1.00', generation: input.generation, observedAt: '2026-10-03T00:00:00.000Z' });
    const corrected = await runAutomatedIntakeBatch(state, correction);
    assert.equal(corrected.publication.corrected, 1); assert.equal(corrected.monitoring.alerts, 0); assert.equal(corrected.stored_alerts, 1); assert.equal(corrected.monitoring.flagged, 0);
    assert.equal(corrected.currency_totals[0].recorded_amount, '31.00'); assert.equal(await count('local_transaction_risks'), 5);
    const afterCorrection = await evidence();
    for (const row of frozen.filter(row => row.kind === 'risks' || row.kind === 'alerts')) assert.ok(afterCorrection.some(candidate => JSON.stringify(candidate) === JSON.stringify(row)));
    const stale = await automatedFixture(join(directory, 'stale'), { amount: '2.00', generation: input.generation, observedAt: '2026-10-01T00:00:00.000Z' });
    await assert.rejects(runAutomatedIntakeBatch(state, stale), /AUTOMATED_INTAKE_FAILED/); assert.deepEqual(await evidence(), afterCorrection);
    const invalid = await automatedFixture(join(directory, 'invalid'));
    await writeFile(invalid.inputPath, 'private-canary-invalid-file');
    await assert.rejects(runAutomatedIntakeBatch(state, invalid), /AUTOMATED_INTAKE_FAILED/); assert.deepEqual(await evidence(), afterCorrection);
    const allLak = await automatedFixture(join(directory, 'all-lak'), { amount: '1.00', generation: input.generation, observedAt: '2026-10-04T00:00:00.000Z', fourthCurrency: 'LAK' });
    const complete = await runAutomatedIntakeBatch(state, allLak);
    assert.equal(complete.status, 'complete'); assert.equal(complete.detection.counts.waiting_policy, 0); assert.equal(complete.detection.counts.with_assessment, 4);
    assert.equal(complete.production_ready, false); assert.equal(complete.account_identity, 'unverified');
    await owner.pool.query('ALTER TABLE platform.local_transaction_risks ADD CONSTRAINT automated_storage_failure CHECK (revision_number<3)');
    const failureInput = await automatedFixture(join(directory, 'failure'), { amount: '2.00', generation: input.generation, observedAt: '2026-10-05T00:00:00.000Z', fourthCurrency: 'LAK' });
    const failed = await runAutomatedIntakeBatch(state, failureInput);
    assert.equal(failed.status, 'partial'); assert.equal(failed.detection.counts.retry_wait, 1);
    assert.equal(failed.detection.counts.with_assessment, 3);
    await owner.pool.query('ALTER TABLE platform.local_transaction_risks DROP CONSTRAINT automated_storage_failure');
    await owner.pool.query("UPDATE platform.local_risk_jobs SET next_attempt_at=clock_timestamp() WHERE status='retry_wait'");
    const recovered = await runAutomatedIntakeBatch(state, failureInput);
    assert.equal(recovered.status, 'complete'); assert.equal(recovered.detection.enqueued, 0); assert.equal(recovered.detection.counts.with_assessment, 4);
    const retried = (await owner.pool.query("SELECT attempt_number FROM platform.local_risk_jobs WHERE transaction_id='lmps_1_20261001120000' AND revision_number=3")).rows;
    assert.deepEqual(retried, [{ attempt_number: 2 }]);
    const writer = createTransactionRevisions(dsn(state, 'intake'));
    try { await writer.append(revision()); } finally { await writer.close(); }
    const foreign = await evidence();
    await assert.rejects(runAutomatedIntakeBatch(state, failureInput), /AUTOMATED_INTAKE_FAILED/);
    assert.deepEqual(await evidence(), foreign);
  } finally {
    if (child) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await closed; }
    await staging?.close(); await owner?.close(); if (state) await stopCluster(state);
    await rm(directory, { recursive: true, force: true });
  }
});

test('a completed missing-target job cannot make a later source revision look assessed or complete', async () => {
  const directory = await mkdtemp('/tmp/lmps-auto-missing-'); let state;
  try {
    state = await initializeCluster(join(directory, 'pg'), await availablePort()); await startCluster(state);
    await migrations(dsn(state, 'migration'), true); await seedAutomatedPolicy(state, 'lmps_1_20261001120000');
    const input = await automatedFixture(join(directory, 'input'), { fourthCurrency: 'LAK' });
    const result = await runAutomatedIntakeBatch(state, input);
    assert.equal(result.detection.counts.completed, 4); assert.equal(result.detection.counts.waiting_policy, 0);
    assert.equal(result.detection.counts.with_assessment, 3); assert.equal(result.monitoring.not_assessed, 1);
    assert.equal(result.status, 'partial'); assert.equal(result.stored_alerts, 0);
  } finally { if (state) await stopCluster(state); await rm(directory, { recursive: true, force: true }); }
});

test('persistent ports and production refuse before IO, and importing the module starts no runner', async () => {
  for (const port of [18503, 18513]) await assert.rejects(runAutomatedIntakeBatch({ port }, {}), /AUTOMATED_INTAKE_FAILED/);
  let calls = 0;
  const input = {}; Object.defineProperty(input, 'manifestPath', { enumerable: true, get() { calls++; } });
  await assert.rejects(runAutomatedIntakeBatch({ port: 12345 }, input), /AUTOMATED_INTAKE_FAILED/); assert.equal(calls, 0);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./tools/automated-intake.mjs')"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  for (const args of [[], ['--input', 'private-canary']]) {
    const child = spawnSync(process.execPath, ['tools/automated-intake.mjs', ...args], { encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_ENV: 'production' } });
    assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.ok(!child.stderr.includes('private-canary'));
  }
});
