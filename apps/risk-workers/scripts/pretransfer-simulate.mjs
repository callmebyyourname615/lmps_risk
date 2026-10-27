import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MAX_SIMULATION_INPUT_BYTES, isSimulationCaller, isSimulationScenario } from '@lmps/contracts/pretransfer-simulation';
import { riskHash } from '@lmps/risk';
import { simulatePretransfer } from '../dist/pretransfer-simulator.js';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';

async function codeVersion() {
  const files = ['apps/risk-workers/dist/pretransfer-simulator.js', 'apps/risk-workers/scripts/pretransfer-simulate.mjs',
    'apps/risk-workers/scripts/private-json.mjs', 'packages/contracts/dist/pretransfer-simulation.js',
    'packages/risk/dist/pretransfer-simulation.js', 'packages/risk/dist/pretransfer-reservations.js', 'packages/risk/dist/index.js'];
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update(await readFile(new URL('../../../' + file, import.meta.url))); }
  return hash.digest('hex');
}
export async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 3 || !args.every(isAbsolute)) throw new Error();
    const [scenarioPath, callerPath, output] = args;
    await privateDirectory(dirname(scenarioPath));
    await privateDirectory(dirname(callerPath));
    const scenario = await readPrivateJson(scenarioPath, MAX_SIMULATION_INPUT_BYTES);
    const caller = await readPrivateJson(callerPath, MAX_SIMULATION_INPUT_BYTES);
    if (!isSimulationScenario(scenario) || !isSimulationCaller(caller)) throw new Error();
    const report = await simulatePretransfer(scenario, caller, await codeVersion());
    const digest = riskHash({ caller, run: scenario.run_id });
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    await savePrivateReport(output, 'v1', id, 'report.json', report, MAX_SIMULATION_INPUT_BYTES);
    console.info(JSON.stringify({ status: 'reported', ...report.counts }));
    return 0;
  } catch {
    console.error('SIMULATION_FAILED; private input/storage diagnostics withheld.');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
