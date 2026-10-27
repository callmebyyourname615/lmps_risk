import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { OfflineDatasetError } from '@lmps/contracts/offline-dataset';
import { MAX_REPLAY_INPUT_BYTES, MAX_REPLAY_REPORT_BYTES, OfflineReplayError, validateReplayInput } from '@lmps/contracts/offline-replay';
import { dsn, loadState } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson, savePrivateReportFiles } from './private-json.mjs';
import { replayOfflineDataset, replayCsv } from '../dist/offline-replay.js';

export async function main(args = process.argv.slice(2), targetDsn) {
  try {
    const { values } = parseArgs({ args, options: { manifest: { type: 'string' }, output: { type: 'string' } } });
    if (Object.keys(values).sort().join(',') !== 'manifest,output' || !isAbsolute(values.manifest) || !isAbsolute(values.output)) throw new OfflineReplayError('REPLAY_INVALID_INPUT');
    await privateDirectory(dirname(values.manifest)); await privateDirectory(dirname(values.output));
    const input = validateReplayInput(await readPrivateJson(values.manifest, MAX_REPLAY_INPUT_BYTES));
    const report = await replayOfflineDataset(targetDsn ?? dsn(await loadState(), 'intake'), input);
    const created = await savePrivateReportFiles(values.output, 'v1', input.run_id, [
      { filename: 'replay.json', content: JSON.stringify(report), maximum: MAX_REPLAY_REPORT_BYTES },
      { filename: 'replay.csv', content: replayCsv(report), maximum: MAX_REPLAY_REPORT_BYTES },
    ]);
    console.info(JSON.stringify({ run_id: report.run_id, batch_ref: report.dataset.batch_ref, status: report.status,
      publication: created ? 'created' : 'duplicate', execution_mode: 'offline_analysis', source_semantics: 'unverified', purpose: 'simulation_only', counts: report.counts }));
    return report.status === 'complete' ? 0 : 2;
  } catch (error) {
    console.error((error instanceof OfflineDatasetError || error instanceof OfflineReplayError ? error.code : 'REPLAY_REPORT_UNAVAILABLE') + '; private diagnostics withheld.'); return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
