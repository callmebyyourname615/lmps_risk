import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, dsn, loadState } from '../../../packages/database/scripts/local.mjs';
import { localMode } from '../dist/snapshot.js';
import { MAX_BACKTEST_MANIFEST_BYTES, MAX_BACKTEST_REPORT_BYTES, runBacktest } from '../dist/rule-backtest.js';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';

export async function backtestRun(inputBase, reportBase, id, appDsn) {
  try {
    localMode();
    if (!isAbsolute(inputBase) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error();
    for (const directory of [dirname(inputBase), inputBase, join(inputBase, 'v1'), join(inputBase, 'v1', id)]) await privateDirectory(directory);
    const manifest = await readPrivateJson(join(inputBase, 'v1', id, 'input.json'), MAX_BACKTEST_MANIFEST_BYTES);
    if (manifest.run_id !== id) throw new Error();
    const report = await runBacktest(manifest, appDsn);
    const created = await savePrivateReport(reportBase, 'v1', id, 'backtest.json', report, MAX_BACKTEST_REPORT_BYTES);
    return { status: created ? 'evaluated' : 'duplicate', run_id: id, report_status: report.status, counts: report.counts };
  } catch { throw new Error('Local synthetic rule backtest failed; input/report/storage diagnostics withheld.'); }
}

export async function main(args = process.argv.slice(2)) {
  try {
    localMode();
    if (args.length !== 1) throw new Error();
    const result = await backtestRun(join(ROOT, '.local/rule-backtests'), join(ROOT, '.local/rule-backtest-reports'), args[0], dsn(await loadState()));
    console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, ...result }));
    return result.report_status === 'complete' ? 0 : 2;
  } catch { console.error('Local synthetic rule backtest failed; input/report/storage diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
