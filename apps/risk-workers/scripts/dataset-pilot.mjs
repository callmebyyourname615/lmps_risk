import { execFile } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { DATASET_COLUMNS, datasetMode } from '@lmps/contracts/offline-dataset';
import { validateReplayInput } from '@lmps/contracts/offline-replay';
import { RISK_CATALOG, RISK_CATALOG_VERSION, riskHash } from '@lmps/risk';
import { createBackup } from '../../../packages/database/scripts/backup.mjs';
import { ROOT, dsn, loadState } from '../../../packages/database/scripts/local.mjs';
import { importOfflineDataset, reconcileOfflineDataset } from '../dist/offline-dataset.js';
import { replayOfflineDataset, replayCsv } from '../dist/offline-replay.js';
import { readOfflineDataset } from './dataset-import.mjs';
import { privateDirectory, readPrivateJson, savePrivateReportFiles } from './private-json.mjs';

const execute = promisify(execFile);
const MAX_REPORT = 128 * 1024 * 1024;

export function pilotReadiness(rows) {
  const reasons = {
    identity: 'ACCOUNT_IDENTITY_UNVERIFIED', history: 'PILOT_HISTORY_INCOMPLETE',
    baseline: 'BASELINE_UNAVAILABLE', graph: 'ACCOUNT_GRAPH_UNAVAILABLE', flags: 'FLAGGED_ACCOUNTS_UNAVAILABLE',
  };
  return { format: 'lmps-pilot-readiness-1', catalog_version: RISK_CATALOG_VERSION, sample_rows: rows,
    source_semantics: 'unverified', account_identity: 'unverified', assessment_performed: false,
    canonical_emission: false, operational_alerts: false, enforcement: false,
    available_screening: ['RAW_AMOUNT_BY_EXACT_CURRENCY_SIMULATION'],
    patterns: RISK_CATALOG.map(entry => ({ code: entry.code, readiness: 'blocked',
      reason_codes: ['SOURCE_LIFECYCLE_UNVERIFIED', 'SOURCE_TIME_SEMANTICS_UNVERIFIED', 'BUSINESS_IDENTITY_UNVERIFIED',
        ...entry.requires.map(requirement => reasons[requirement] ?? 'REQUIRED_CONTEXT_UNAVAILABLE')] })) };
}

export async function runPilot({ bundle, output, amountGte }, stateOverride, backupBase) {
  datasetMode();
  let stage = 'validation';
  try {
    if (![bundle, output].every(path => typeof path === 'string' && isAbsolute(path))
      || typeof amountGte !== 'string' || !/^(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(amountGte)
      || BigInt(amountGte.replace('.', '')) <= 0n) throw new Error();
    await privateDirectory(dirname(output));
    const source = await realpath(bundle), target = join(await realpath(dirname(output)), basename(output));
    if (source === target || source.startsWith(target + sep) || target.startsWith(source + sep)) throw new Error();
    try { await mkdir(output, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await privateDirectory(output);
    stage = 'adapter';
    const adapted = join(output, 'adapted');
    const child = await execute(join(ROOT, '.venv/bin/python'), ['-B', join(ROOT, 'apps/risk-workers/scripts/dataset_pilot.py'),
      '--bundle', bundle, '--output', adapted], { timeout: 30000, maxBuffer: 65536 });
    if (child.stderr || !['created', 'duplicate'].includes(JSON.parse(child.stdout).status)) throw new Error();
    const receipt = await readPrivateJson(join(adapted, 'receipt.json'), 65536);
    const input = await readPrivateJson(join(adapted, 'input.json'), 16384);
    const snapshot = await readOfflineDataset(input, join(adapted, 'transfer.csv'));
    if (receipt.format !== 'lmps-pilot-adapter-1' || receipt.account_identity !== 'unverified'
      || receipt.account_fields_in_staging !== false || receipt.batch_ref !== input.batch_ref
      || receipt.staged_rows !== snapshot.rows.length || receipt.source_rows !== snapshot.rows.length
      || receipt.files['transfer.csv'].sha256 !== input.dataset_sha256) throw new Error();
    stage = 'policy';
    const currencyIndex = DATASET_COLUMNS.transfer.indexOf('ccy');
    const currencies = [...new Set(snapshot.rows.map(row => row[currencyIndex]))];
    const requestedReplay = validateReplayInput({ format: 1, execution_mode: 'offline_analysis', evaluator_version: 'offline-amount-screen-1',
      run_id: receipt.replay_run_id, workspace_key: input.workspace_key, batch_ref: input.batch_ref,
      dataset_sha256: input.dataset_sha256,
      policy: { version: 'simulation_pilot_smoke_v1', purpose: 'simulation_only', amount_semantics: 'raw_recorded_amount',
        amount_unit: 'as_recorded', lifecycle_scope: 'all_recorded_rows',
        thresholds: currencies.map(source_ccy => ({ source_ccy, amount_gte: amountGte })) } });
    const readiness = pilotReadiness(snapshot.rows.length);
    const context = { format: 'lmps-pilot-run-1', adapter_receipt_canonical_sha256: riskHash(receipt),
      source_manifest_sha256: receipt.source_manifest_sha256, requested_replay: requestedReplay };
    await savePrivateReportFiles(join(output, 'context'), 'v1', receipt.replay_run_id, [
      { filename: 'context.json', content: JSON.stringify(context), maximum: 65536 },
      { filename: 'readiness.json', content: JSON.stringify(readiness), maximum: 65536 },
    ]);
    const state = stateOverride ?? await loadState();
    stage = 'backup';
    const backup = await createBackup(state, backupBase);
    stage = 'import';
    const connection = dsn(state, 'intake');
    const imported = await importOfflineDataset(connection, snapshot);
    if (imported.status !== 'complete' || imported.reconciliation_status !== 'matched') throw new Error();
    stage = 'reconcile';
    const reconciled = await reconcileOfflineDataset(connection, snapshot);
    if (reconciled.status !== 'complete' || reconciled.counts.matched !== snapshot.rows.length) throw new Error();
    stage = 'replay';
    const replayInput = validateReplayInput({ ...requestedReplay, batch_ref: imported.batch_ref });
    const report = await replayOfflineDataset(connection, replayInput);
    stage = 'publication';
    const created = await savePrivateReportFiles(join(output, 'replay'), 'v1', receipt.replay_run_id, [
      { filename: 'replay.json', content: JSON.stringify(report), maximum: MAX_REPORT },
      { filename: 'replay.csv', content: replayCsv(report), maximum: MAX_REPORT },
    ]);
    return { format: 'lmps-pilot-pipeline-1', execution_mode: 'offline_analysis', purpose: 'simulation_only',
      source_semantics: 'unverified', account_identity: 'unverified', backup_id: backup.backup_id,
      batch_ref: imported.batch_ref, run_id: receipt.replay_run_id, registration: imported.registration,
      import_status: imported.status, reconciliation_status: reconciled.reconciliation_status,
      matched_rows: reconciled.counts.matched, replay_status: report.status, counts: report.counts,
      publication: created ? 'created' : 'duplicate', catalog_patterns: readiness.patterns.length,
      ready_patterns: 0, canonical_emission: false, operational_alerts: false, enforcement: false };
  } catch { throw new Error('PILOT_PIPELINE_FAILED_' + stage.toUpperCase()); }
}

export async function main(args = process.argv.slice(2), stateOverride, backupBase) {
  try {
    const { values } = parseArgs({ args, options: { bundle: { type: 'string' }, output: { type: 'string' }, 'amount-gte': { type: 'string' } } });
    if (Object.keys(values).sort().join(',') !== 'amount-gte,bundle,output') throw new Error();
    console.info(JSON.stringify(await runPilot({ bundle: values.bundle, output: values.output, amountGte: values['amount-gte'] }, stateOverride, backupBase)));
    return 0;
  } catch (error) {
    console.error(/^PILOT_PIPELINE_FAILED_[A-Z]+$/.test(error.message) ? error.message : 'PILOT_PIPELINE_INVALID_INPUT');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
