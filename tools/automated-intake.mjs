import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DATASET_UUID, validateDatasetInput } from '../packages/contracts/dist/offline-dataset.js';
import { detachFeatureJSON } from '../packages/contracts/dist/feature-catalog.js';
import { makeSourcePublication, sourceContentHash, sourceEvidenceHash, sourcePublicationTransaction, sourceTransactionId } from '../packages/contracts/dist/source-publication.js';
import { parseDetectionFilters } from '../packages/contracts/dist/detection-health.js';
import { parseMonitoringFilters } from '../packages/contracts/dist/monitoring.js';
import { createDatabase, createDetectionHandoff, createOfflineDatasets, readDetectionHealth, readMonitoringSnapshot } from '../packages/database/dist/index.js';
import { ROOT, availablePort, dsn, identify, initializeCluster, localMode, startCluster, stopCluster } from '../packages/database/scripts/local.mjs';
import { migrations } from '../packages/database/scripts/migrations.mjs';
import { readOfflineDataset } from '../apps/risk-workers/scripts/dataset-import.mjs';
import { privateDirectory, readPrivateJson, savePrivateReport } from '../apps/risk-workers/scripts/private-json.mjs';
import { importOfflineDataset, reconcileOfflineDataset } from '../apps/risk-workers/dist/offline-dataset.js';
import { publishOfflineBatch } from '../apps/risk-workers/dist/offline-publication.js';

const namespace = 'synthetic_automated', workspace = 'synthetic_local';
const failure = () => new Error('AUTOMATED_INTAKE_FAILED; committed checkpoints retained; private diagnostics withheld.');

export async function runAutomatedIntakeBatch(state, input, onProgress = async () => {}) {
  let database, reader, detector, lock;
  try {
    localMode();
    if (!Number.isInteger(state?.port) || [18503, 18513].includes(state.port)) throw Error();
    const request = detachFeatureJSON(input, 16384);
    if (Object.keys(request).sort().join(',') !== 'generation,inputPath,manifestPath,observedAt'
      || typeof request.generation !== 'string' || !DATASET_UUID.test(request.generation)
      || ![request.manifestPath, request.inputPath].every(path => typeof path === 'string' && isAbsolute(path))
      || typeof request.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(request.observedAt)
      || !Number.isFinite(Date.parse(request.observedAt)) || new Date(request.observedAt).toISOString() !== request.observedAt) throw Error();
    await privateDirectory(dirname(request.manifestPath));
    const manifest = validateDatasetInput(await readPrivateJson(request.manifestPath, 16384));
    if (manifest.workspace_key !== 'offline_automated' || manifest.source_namespace !== 'offline_automated_transfer'
      || manifest.source_table !== 'transfer' || manifest.expected_rows > 500) throw Error();
    const snapshot = await readOfflineDataset(manifest, request.inputPath);
    for (const [index, values] of snapshot.rows.entries()) makeSourcePublication({ workspace, namespace, generation: request.generation,
      batch: manifest.batch_ref, dataset_sha256: manifest.dataset_sha256, rows_sha256: snapshot.manifest.rows_sha256,
      source_namespace: manifest.source_namespace, row_number: index + 1, values, observed_at: request.observedAt, expected_revision: 0 });
    const probe = await identify(state, 'lmps_risk_local'); await probe.end();
    database = createDatabase(dsn(state, 'intake'), 'intake');
    lock = await database.pool.connect();
    if (!(await lock.query('SELECT pg_try_advisory_lock(18513,33) AS acquired')).rows[0].acquired) throw Error();
    const foreign = await lock.query(`SELECT EXISTS(
      SELECT 1 FROM platform.local_transaction_revisions WHERE workspace_key<>$1 OR namespace<>$2
      UNION ALL SELECT 1 FROM platform.local_risk_jobs WHERE workspace_key<>$1 OR namespace<>$2
      UNION ALL SELECT 1 FROM platform.local_risk_policy_bindings WHERE workspace_key<>$1 OR namespace<>$2) AS present`, [workspace, namespace]);
    if (foreign.rows[0].present) throw Error();
    const current = (await lock.query('SELECT DISTINCT transaction_id FROM platform.local_transaction_revisions LIMIT 501')).rows;
    if (new Set([...current.map(row => row.transaction_id), ...snapshot.rows.map(sourceTransactionId)]).size > 500) throw Error();
    await onProgress('verified');
    const staged = await importOfflineDataset(dsn(state, 'intake'), snapshot);
    if (staged.status !== 'complete') throw Error();
    await onProgress('staged');
    const published = await publishOfflineBatch(dsn(state, 'intake'), { format: 1, source_workspace: manifest.workspace_key,
      batch_ref: staged.batch_ref, dataset_sha256: manifest.dataset_sha256, workspace, namespace, generation: request.generation,
      observed_at: request.observedAt, mapping: 'operator_intake_test_ok_failed_v1' });
    if (published.status !== 'complete') throw Error();
    await onProgress('published');
    detector = createDetectionHandoff(dsn(state, 'intake'));
    let enqueued = 0, processed = 0;
    for (let cycle = 0; cycle < 40; cycle++) {
      const added = await detector.handoff(100), worked = await detector.work(20);
      enqueued += added; processed += worked;
      if (!added && !worked) break;
    }
    await onProgress('detected');
    const reconciled = await reconcileOfflineDataset(dsn(state, 'intake'), snapshot);
    if (reconciled.status !== 'complete' || reconciled.reconciliation_status !== 'matched') throw Error();
    reader = createDatabase(dsn(state), 'app', namespace);
    const saved = (await reader.pool.query(`SELECT DISTINCT ON(transaction_id) transaction_id,payload,publication
      FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=ANY($3)
      ORDER BY transaction_id,revision_number DESC`, [workspace, namespace, snapshot.rows.map(sourceTransactionId)])).rows;
    if (saved.length !== snapshot.rows.length) throw Error();
    const byId = new Map(saved.map(row => [row.transaction_id, row])), totals = new Map();
    for (const values of snapshot.rows) {
      const row = byId.get(sourceTransactionId(values)), checked = sourcePublicationTransaction(row.publication);
      if (sourceContentHash(checked.publication.origin.values) !== sourceContentHash(values)
        || sourceEvidenceHash(checked.transaction) !== sourceEvidenceHash(row.payload)) throw Error();
      const total = totals.get(values[3]) ?? { currency: values[3], rows: 0, units: 0n };
      total.rows++; total.units += BigInt(values[2].replace('.', '')); totals.set(values[3], total);
    }
    const worker = { configured: true, enabled: true, state: 'running', last_completed_at: null, last_enqueued: enqueued, last_processed: processed, interval_seconds: 0 };
    const health = await readDetectionHealth(reader.pool, workspace, parseDetectionFilters({ namespace }), worker);
    const monitoring = await readMonitoringSnapshot(reader.pool, workspace, parseMonitoringFilters({ namespace }));
    const storedAlerts = (await reader.pool.query(`SELECT count(*)::int AS count FROM platform.local_alerts alert
      JOIN platform.local_transaction_risks risk ON (risk.workspace_key,risk.run_id)=(alert.workspace_key,alert.assessment_run_id)
      WHERE risk.workspace_key=$1 AND risk.namespace=$2`, [workspace, namespace])).rows[0].count;
    const complete = health.rows.every(row => ['completed', 'assessed'].includes(row.state) && row.assessment_status !== null);
    await onProgress('reconciled');
    return { format: 'automated-intake-test-1', status: complete ? 'complete' : 'partial', scope: 'isolated_fixture_only',
      input_sha256: sourceEvidenceHash({ manifest: snapshot.manifest, generation: request.generation, observed_at: request.observedAt }),
      checkpoint: { batch_ref: staged.batch_ref, loaded_rows: staged.loaded_rows, reconciliation: 'matched' },
      publication: published.counts, detection: { enqueued, processed, counts: health.counts }, monitoring: monitoring.summary.counts, stored_alerts: storedAlerts,
      currency_totals: [...totals.values()].sort((first, second) => first.currency.localeCompare(second.currency))
        .map(({ units, ...group }) => ({ ...group, recorded_amount: `${units / 100n}.${String(units % 100n).padStart(2, '0')}` })),
      source_semantics: 'unverified', account_identity: 'unverified', source_ordering: 'caller_declared_test_only',
      live_source_connected: false, production_ready: false };
  } catch { throw failure(); }
  finally {
    lock?.release(true);
    await Promise.all([detector?.close(), reader?.close(), database?.close()]);
  }
}

async function main() {
  localMode();
  if (process.argv.length !== 2 || process.env.LMPS_RUNTIME_PROFILE === 'intake') throw failure();
  const { automatedFixture, seedAutomatedPolicy } = await import('../apps/risk-workers/test/fixtures/automated-intake.mjs');
  const temporary = await mkdtemp('/tmp/lmps-automated-intake-');
  let state, result;
  try {
    state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state);
    await migrations(dsn(state, 'migration'), true); await seedAutomatedPolicy(state);
    const firstInput = await automatedFixture(join(temporary, 'first'));
    const snapshot = await readOfflineDataset(await readPrivateJson(firstInput.manifestPath, 16384), firstInput.inputPath);
    const staging = createOfflineDatasets(dsn(state, 'intake'));
    try {
      await staging.register(snapshot.manifest); await staging.append(snapshot.manifest, 1, snapshot.rows.slice(0, 1));
      assert.equal((await staging.status(snapshot.manifest.workspace_key, snapshot.manifest.batch_ref)).loaded_rows, 1);
    } finally { await staging.close(); }
    const first = await runAutomatedIntakeBatch(state, firstInput), retry = await runAutomatedIntakeBatch(state, firstInput);
    assert.equal(first.status, 'partial'); assert.equal(first.detection.counts.waiting_policy, 1);
    assert.equal(first.detection.counts.with_assessment, 3); assert.equal(first.monitoring.alerts, 1);
    assert.equal(retry.publication.duplicates, 4); assert.equal(retry.detection.enqueued, 0); assert.equal(retry.detection.processed, 0);
    const correction = await automatedFixture(join(temporary, 'correction'), { amount: '1.00', observedAt: '2026-10-03T00:00:00.000Z', generation: firstInput.generation });
    const corrected = await runAutomatedIntakeBatch(state, correction);
    assert.equal(corrected.publication.corrected, 1); assert.equal(corrected.monitoring.alerts, 0); assert.equal(corrected.stored_alerts, 1); assert.equal(corrected.monitoring.flagged, 0);
    result = { status: 'passed', first, retry, corrected, checks: ['verified_csv', 'staging_checkpoint', 'exact_retry', 'approved_detection', 'currency_reconciliation', 'correction', 'waiting_policy'], production_ready: false };
  } finally { if (state) await stopCluster(state); if (result) await rm(temporary, { recursive: true, force: true }); }
  const local = join(ROOT, '.local'); await mkdir(local, { recursive: true, mode: 0o700 }); await privateDirectory(local);
  const id = randomUUID(), base = join(local, 'automated-intake');
  await savePrivateReport(base, 'v1', id, 'acceptance.json', result, 65536);
  console.log(JSON.stringify({ status: 'passed', receipt: join(base, 'v1', id, 'acceptance.json'), production_ready: false }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error(failure().message); process.exitCode = 1; });
