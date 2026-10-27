import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_QA_POOL_BYTES, MAX_QA_REPORT_BYTES } from '@lmps/contracts/qa-sampling';
import { riskHash } from '@lmps/risk';
import { sampleQa } from '../dist/qa-sampling.js';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 4 || !args.every(isAbsolute)) throw new Error();
    const [callerPath, poolPath, policyPath, output] = args;
    for (const path of [callerPath, poolPath, policyPath]) await privateDirectory(dirname(path));
    const caller = await readPrivateJson(callerPath, MAX_QA_POOL_BYTES);
    const pool = await readPrivateJson(poolPath, MAX_QA_POOL_BYTES);
    const policy = await readPrivateJson(policyPath, MAX_QA_POOL_BYTES);
    const report = sampleQa(caller, pool, policy);
    // Caller/pool identity is an immutable run slot; content changes conflict.
    const digest = riskHash({ caller: report.caller, pool_id: report.pool_id });
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    const created = await savePrivateReport(output, 'v1', id, 'report.json', report, MAX_QA_REPORT_BYTES);
    console.info(JSON.stringify({ status: created ? 'reported' : 'acknowledged', row_count: report.row_count, selected_count: report.selected_count }));
    return 0;
  } catch {
    console.error(JSON.stringify({ status: 'failed' }));
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
