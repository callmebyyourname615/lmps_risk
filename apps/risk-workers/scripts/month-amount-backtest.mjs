import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { datasetMode } from '@lmps/contracts/offline-dataset';
import { declaredIntakeLifecycle } from '@lmps/contracts/intake-source-contract';
import { classifyProductAmount, LAK_PRODUCT_AMOUNT_PROFILE, riskHash, RISK_CATALOG } from '@lmps/risk';
import { privateDirectory, readPrivateJson, savePrivateReportFiles } from './private-json.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const execute = promisify(execFile), MAXIMUM = 2 * 1024**2;
const producerNames = ['month-readiness.mjs', 'dataset_readiness.py', 'dataset_month_stream.py', 'dataset_profile.py', 'dataset_pilot.py', 'export_transfer.py'];
const tools = ['apps/risk-workers/scripts/month-amount-backtest.mjs', 'apps/risk-workers/scripts/dataset_amount_backtest.py',
  'apps/risk-workers/scripts/private-json.mjs',
  ...producerNames.map(n => 'apps/risk-workers/scripts/' + n),
  'packages/contracts/src/intake-source-contract.ts', 'packages/contracts/dist/intake-source-contract.js',
  'packages/risk/src/product-amount.ts', 'packages/risk/dist/product-amount.js', 'packages/risk/src/index.ts', 'packages/risk/dist/index.js',
  'packages/contracts/src/offline-dataset.ts', 'packages/contracts/dist/offline-dataset.js'];
const uid = digest => `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
async function hashes(paths) {
  return Promise.all(paths.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(join(ROOT, name))).digest('hex') })));
}
async function producerBinding() {
  return riskHash((await hashes(producerNames.map(n => 'apps/risk-workers/scripts/' + n))).map((h, i) => ({ ...h, name: producerNames[i] })));
}

export function amountParityCases() {
  const amounts = ['-1.00', '0.00', '0.01', '19999999.99', '20000000.00', '49999999.99', '50000000.00',
    '99999999.99', '100000000.00', '179999999.99', '180000000.00', '200000000.00', '200000000.01', '9999999999999999999999.99'];
  const rows = [];
  for (const result of ['OK', 'ERROR', 'TRANSACTION_FAILED', null, '', ' OK', 'OK ', '\ufeffOK', '\u0085X', '😀']) {
    for (const shouldrevert of ['0', '1', '2', null]) {
      const source = { result, shouldrevert, reference: 'synthetic_new', originalreference: 'synthetic_old' };
      const amount = { amount: amounts[rows.length % amounts.length], currency: rows.length % 3 ? 'LAK' : 'THB' };
      rows.push({ source, facts: declaredIntakeLifecycle(source), amount, classification: classifyProductAmount(amount) });
    }
  }
  for (const amount of amounts) {
    const source = { result: 'OK', shouldrevert: '1', reference: 'synthetic_same', originalreference: 'synthetic_same' };
    const input = { amount, currency: 'LAK' };
    rows.push({ source, facts: declaredIntakeLifecycle(source), amount: input, classification: classifyProductAmount(input) });
  }
  return rows;
}

async function python(request, long = false) {
  const child = execute(join(ROOT, '.venv/bin/python'), ['-B', join(ROOT, 'apps/risk-workers/scripts/dataset_amount_backtest.py')],
    { timeout: long ? 1830000 : 30000, maxBuffer: 2 * MAXIMUM + 1024, encoding: 'utf8' });
  child.child.stdin.on('error', () => {});
  child.child.stdin.end(JSON.stringify(request));
  const { stdout, stderr } = await child;
  if (stderr) throw Error();
  return JSON.parse(stdout);
}

export async function runAmountBacktest({ planPath, profilePath, output }) {
  datasetMode();
  if (![planPath, profilePath, output].every(p => typeof p === 'string' && isAbsolute(p) && resolve(p) === p)) throw Error();
  for (const p of [dirname(planPath), dirname(profilePath), dirname(output)]) await privateDirectory(p);
  const [plan, prior] = await Promise.all([readPrivateJson(planPath, 1024**2), readPrivateJson(profilePath, MAXIMUM)]);
  if (prior.format !== 'lmps-month-readiness-1' || prior.production_ready !== false || prior.source_semantics !== 'unverified'
    || prior.request_sha256 !== riskHash(plan) || prior.tool_binding_sha256 !== await producerBinding()
    || prior.catalog_sha256 !== riskHash(RISK_CATALOG) || basename(dirname(profilePath)) !== uid(riskHash(prior))) throw Error();
  const target = join(await realpath(dirname(output)), basename(output));
  const overlaps = p => p === target || p.startsWith(target + '/') || target.startsWith(p + '/');
  for (const p of [planPath, profilePath, ...plan.files.map(f => f.path)]) if (overlaps(await realpath(p))) throw Error();
  const binding = await hashes(tools), profileHash = riskHash(prior), requestHash = riskHash(plan);
  const profile = LAK_PRODUCT_AMOUNT_PROFILE, cases = amountParityCases();
  const parity = await python({ profile, cases, check_only: true });
  if (parity.parity !== 'passed') throw Error();
  const result = await python({ profile, cases, plan, prior, scratch: dirname(output) }, true);
  if (riskHash(binding) !== riskHash(await hashes(tools)) || riskHash(await readPrivateJson(planPath, 1024**2)) !== requestHash
    || riskHash(await readPrivateJson(profilePath, MAXIMUM)) !== profileHash || result.report.format !== 'lmps-product-amount-backtest-1'
    || riskHash(result.report.profile) !== riskHash(profile) || result.report.production_ready !== false) throw Error();
  // Re-run bounded amount bands through TS; replay full source facts with the private reader.
  for (const trace of result.traces) {
    if (classifyProductAmount({ amount: trace.recorded_amount, currency: trace.currency_label }).band !== trace.band
      || trace.account_identity !== 'unverified' || trace.net_executed_amount !== null) throw Error();
  }
  const traceVerification = await python({ profile, cases, plan, traces: result.traces }, true);
  if (traceVerification.status !== 'passed' || traceVerification.rows !== result.traces.length
    || riskHash(binding) !== riskHash(await hashes(tools)) || riskHash(await readPrivateJson(planPath, 1024**2)) !== requestHash
    || riskHash(await readPrivateJson(profilePath, MAXIMUM)) !== profileHash) throw Error();
  const report = { ...result.report, request_sha256: requestHash, source_profile_sha256: profileHash,
    tool_binding: binding, tool_binding_sha256: riskHash(binding), parity_cases: cases.length,
    core_pattern_results: RISK_CATALOG.map(p => ({ code: p.code, status: 'not_evaluated', matched_count: null,
      reason: p.requires.length ? 'VERIFIED_CONTEXT_UNAVAILABLE' : 'VERIFIED_NORMALIZED_NET_AMOUNT_UNAVAILABLE' })),
    trace_sha256: riskHash(result.traces), trace_verification: traceVerification };
  const id = uid(riskHash(report));
  const created = await savePrivateReportFiles(output, 'v1', id, [
    { filename: 'report.json', content: JSON.stringify(report), maximum: MAXIMUM },
    { filename: 'traces.json', content: JSON.stringify(result.traces), maximum: MAXIMUM },
  ]);
  return { status: created ? 'backtested' : 'duplicate', analysis_id: id, observed_rows: report.observed_rows,
    profile_version: profile.version, mapping: report.mapping, assessment_performed: false, production_ready: false };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args, options: { plan: { type: 'string' }, profile: { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
    if (!values.plan || !values.profile || !values.output) throw Error();
    console.info(JSON.stringify(await runAmountBacktest({ planPath: values.plan, profilePath: values.profile, output: values.output })));
    return 0;
  } catch { console.error('AMOUNT_BACKTEST_FAILED; private diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
