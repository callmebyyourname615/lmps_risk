import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalAlerts } from '@lmps/database';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import { ROOT, dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson } from './private-json.mjs';

export async function generateAlerts(base, assessmentId, intakeDsn) {
  let repository;
  try {
    localMode(); if (!isAbsolute(base) || !ALERT_UUID.test(assessmentId)) throw new Error();
    for (const path of [dirname(base), base, join(base, 'v1'), join(base, 'v1', assessmentId)]) await privateDirectory(path);
    const request = await readPrivateJson(join(base, 'v1', assessmentId, 'input.json'), 16384);
    if (request.assessment_run_id !== assessmentId) throw new Error();
    repository = createLocalAlerts(intakeDsn); return await repository.generate(request);
  } catch { throw new Error('Local alert generation failed; private input/storage diagnostics withheld.'); }
  finally { await repository?.close(); }
}
export async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 1) throw new Error(); localMode();
    const result = await generateAlerts(join(ROOT, '.local/alert-inputs'), args[0], dsn(await loadState(), 'intake'));
    console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...result })); return 0;
  } catch { console.error('Local alert generation failed; private input/storage diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
