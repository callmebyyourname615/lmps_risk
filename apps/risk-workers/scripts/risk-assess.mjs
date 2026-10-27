import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransactionRisks } from '@lmps/database';
import { MAX_RISK_INPUT_BYTES } from '@lmps/contracts/transaction-risk';
import { ROOT, dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson } from './private-json.mjs';

export async function assessTransactionRisk(base, id, intakeDsn) {
  let repository;
  try {
    localMode();
    if (!isAbsolute(base) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error();
    for (const directory of [dirname(base), base, join(base, 'v1'), join(base, 'v1', id)]) await privateDirectory(directory);
    const request = await readPrivateJson(join(base, 'v1', id, 'input.json'), MAX_RISK_INPUT_BYTES);
    if (request.run_id !== id) throw new Error();
    repository = createTransactionRisks(intakeDsn);
    const { status, result } = await repository.evaluate(request);
    return { status, run_id: id, assessment_status: result.assessment_status, response_code: result.response_code, triggered_types: result.risk_types.length };
  } catch { throw new Error('Local transaction risk failed; private input/storage diagnostics withheld.'); }
  finally { await repository?.close(); }
}
export async function main(args = process.argv.slice(2)) {
  try {
    localMode(); if (args.length !== 1) throw new Error();
    const result = await assessTransactionRisk(join(ROOT, '.local/transaction-risk-inputs'), args[0], dsn(await loadState(), 'intake'));
    console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...result }));
    return ['complete', 'not_applicable'].includes(result.assessment_status) ? 0 : 2;
  } catch { console.error('Local transaction risk failed; private input/storage diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
