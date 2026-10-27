import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuleAssessments, MAX_BACKTEST_MANIFEST_BYTES } from '@lmps/database';
import { ROOT, dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson } from './private-json.mjs';

export async function assessRun(inputBase, id, intakeDsn) {
  let repository;
  try {
    localMode();
    if (!isAbsolute(inputBase) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error();
    for (const directory of [dirname(inputBase), inputBase, join(inputBase, 'v1'), join(inputBase, 'v1', id)]) await privateDirectory(directory);
    const manifest = await readPrivateJson(join(inputBase, 'v1', id, 'input.json'), MAX_BACKTEST_MANIFEST_BYTES);
    if (manifest.run_id !== id) throw new Error();
    repository = createRuleAssessments(intakeDsn);
    const { status, report } = await repository.evaluate(manifest);
    return { status, run_id: id, report_status: report.status, counts: report.counts };
  } catch { throw new Error('Local synthetic assessment failed; input/storage diagnostics withheld.'); }
  finally { await repository?.close(); }
}

export async function main(args = process.argv.slice(2)) {
  try {
    localMode();
    if (args.length !== 1) throw new Error();
    const result = await assessRun(join(ROOT, '.local/rule-backtests'), args[0], dsn(await loadState(), 'intake'));
    console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, ...result }));
    return result.report_status === 'complete' ? 0 : 2;
  } catch { console.error('Local synthetic assessment failed; input/storage diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
