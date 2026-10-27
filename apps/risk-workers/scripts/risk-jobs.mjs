import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRiskJobs } from '@lmps/database';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import { MAX_JOB_INPUT_BYTES } from '@lmps/contracts/risk-job';
import { ROOT, dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson } from './private-json.mjs';
import { runRiskJob } from '../dist/risk-job.js';

export async function enqueueRiskJob(base, id, intakeDsn, approved = false) {
  let jobs;
  try {
    localMode(); if (!isAbsolute(base) || !ALERT_UUID.test(id)) throw new Error();
    for (const path of [dirname(base), base, join(base, 'v1'), join(base, 'v1', id)]) await privateDirectory(path);
    const input = await readPrivateJson(join(base, 'v1', id, 'input.json'), MAX_JOB_INPUT_BYTES);
    const manifest = approved ? input?.job : input;
    if (manifest?.job_ref !== id || (approved && Object.keys(input).sort().join() !== 'job,selection')) throw new Error();
    jobs = createRiskJobs(intakeDsn); return approved ? await jobs.enqueueApproved(manifest, input.selection) : await jobs.enqueue(manifest);
  } catch { throw new Error('Local risk job enqueue failed; private diagnostics withheld.'); }
  finally { await jobs?.close(); }
}
export async function main(args = process.argv.slice(2)) {
  try {
    localMode(); const [action, value] = args;
    if (!['enqueue', 'enqueue-approved', 'run', 'retry', 'work'].includes(action) || args.length !== 2
      || (action === 'work' ? !/^(?:[1-9]|1[0-9]|20)$/.test(value) : !ALERT_UUID.test(value))) throw new Error();
    const intakeDsn = dsn(await loadState(), 'intake');
    if (action === 'enqueue' || action === 'enqueue-approved') {
      const result = await enqueueRiskJob(join(ROOT, '.local/risk-job-inputs'), value, intakeDsn, action === 'enqueue-approved');
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...result })); return 0;
    }
    let exit = 0;
    for (let index = 0; index < (action === 'work' ? Number(value) : 1); index++) {
      const result = await runRiskJob(intakeDsn, action === 'work' ? undefined : value);
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...result }));
      if (!['completed', 'idle'].includes(result.status)) exit = 2;
      if (result.status === 'idle') break;
    }
    return exit;
  } catch { console.error('Local risk job failed; private diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
