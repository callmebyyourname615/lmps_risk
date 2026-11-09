import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { datasetMode } from '@lmps/contracts/offline-dataset';
import { RISK_CATALOG, RISK_CATALOG_VERSION, riskHash } from '@lmps/risk';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const execute = promisify(execFile);
const MAXIMUM = 2 * 1024 * 1024;
const reason = { identity: 'ACCOUNT_IDENTITY_UNVERIFIED', history: 'HISTORY_COMPLETENESS_UNVERIFIED',
  baseline: 'ELIGIBLE_BASELINE_UNAVAILABLE', graph: 'VERIFIED_ACCOUNT_GRAPH_UNAVAILABLE', flags: 'AUTHORIZED_FLAG_REFERENCE_UNAVAILABLE' };

export function monthPatternReadiness(profile) {
  if (profile?.format !== 'lmps-month-profile-1' || profile.source_semantics !== 'unverified'
    || profile.account_identity !== 'unverified' || profile.production_ready !== false
    || !Array.isArray(profile.tables) || !profile.tables.length) throw Error();
  const common = ['id', 'requesttime', 'reference', 'amount', 'ccy', 'result', 'txtype', 'totype',
    'shouldrevert', 'originalreference', 'isreconciled', 'issettled'];
  return RISK_CATALOG.map(entry => {
    const columns = [...common, ...(entry.requires.includes('identity') ? ['fromaccount', 'toaccount', 'frommember', 'tomember'] : []),
      ...(entry.requires.includes('history') ? ['txtime'] : [])];
    return { code: entry.code, dimension: entry.dimension, readiness: 'blocked', requirements: entry.requires,
      candidate_source_columns: columns, column_coverage: profile.tables.map(table => ({ source_table: table.source_table,
        missing_columns: columns.filter(name => !table.columns.includes(name)) })),
      reason_codes: ['SOURCE_LIFECYCLE_AND_UNITS_UNVERIFIED', 'NET_EXECUTION_AND_REVERSALS_UNVERIFIED',
        'BUSINESS_PAYMENT_IDENTITY_UNVERIFIED', 'APPROVED_CURRENCY_POLICY_REQUIRED',
        ...(entry.requires.length ? ['SOURCE_TIME_AND_KNOWN_AT_UNVERIFIED'] : []),
        ...entry.requires.map(key => reason[key] ?? 'REQUIRED_CONTEXT_UNAVAILABLE')] };
  });
}

async function toolBinding() {
  const paths = ['month-readiness.mjs', 'dataset_readiness.py', 'dataset_month_stream.py', 'dataset_profile.py', 'dataset_pilot.py', 'export_transfer.py'];
  return riskHash(await Promise.all(paths.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(join(ROOT, 'apps/risk-workers/scripts', name))).digest('hex') }))));
}

export async function runMonthReadiness({ planPath, output, streaming = false, hourly = false }) {
  datasetMode();
  if (typeof streaming !== 'boolean' || typeof hourly !== 'boolean' || (hourly && !streaming)) throw Error();
  if (![planPath, output].every(p => typeof p === 'string' && isAbsolute(p) && resolve(p) === p)) throw Error();
  await privateDirectory(dirname(planPath));
  await privateDirectory(dirname(output));
  const plan = await readPrivateJson(planPath, 1024 * 1024), binding = await toolBinding();
  const target = join(await realpath(dirname(output)), basename(output));
  for (const file of plan.files ?? []) {
    const source = await realpath(file.path);
    if (source === target || source.startsWith(target + sep) || target.startsWith(source + sep)) throw Error();
  }
  const requestHash = riskHash(plan);
  const script = streaming ? 'dataset_month_stream.py' : 'dataset_readiness.py';
  const child = execute(join(ROOT, '.venv/bin/python'), ['-B', join(ROOT, 'apps/risk-workers/scripts', script)],
    { timeout: streaming ? 7230000 : 330000, maxBuffer: MAXIMUM, encoding: 'utf8' });
  child.child.stdin.on('error', () => {});
  child.child.stdin.end(JSON.stringify({ plan, scratch: dirname(output), ...(hourly ? { hourly: true } : {}) }));
  const { stdout, stderr } = await child;
  if (stderr || binding !== await toolBinding() || riskHash(await readPrivateJson(planPath, 1024 * 1024)) !== requestHash) throw Error();
  const profile = JSON.parse(stdout), patterns = monthPatternReadiness(profile);
  const report = { ...profile, format: 'lmps-month-readiness-1', request_sha256: requestHash, tool_binding_sha256: binding,
    catalog_version: RISK_CATALOG_VERSION, catalog_sha256: riskHash(RISK_CATALOG), patterns,
    production_ready_patterns: 0, source_connection_authorized: false, accuracy: null,
    accuracy_reason: 'REPRESENTATIVE_REVIEWED_LABELS_AND_HELD_OUT_EVALUATION_REQUIRED' };
  const digest = riskHash(report), id = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const created = await savePrivateReport(output, 'v1', id, 'report.json', report, MAXIMUM);
  return { status: created ? 'profiled' : 'duplicate', requested_month: report.requested_month,
    observed_rows: report.observed_rows, patterns: patterns.length, production_ready_patterns: 0,
    analysis_id: id, capacity_mode: report.capacity_mode ?? 'bounded_sqlite_v1', assessment_performed: false, production_ready: false };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args, options: { plan: { type: 'string' }, output: { type: 'string' }, streaming: { type: 'boolean' }, hourly: { type: 'boolean' } }, allowPositionals: false });
    if (!values.plan || !values.output) throw Error();
    console.info(JSON.stringify(await runMonthReadiness({ planPath: values.plan, output: values.output, streaming: values.streaming, hourly: values.hourly })));
    return 0;
  } catch {
    console.error('MONTH_READINESS_FAILED; private diagnostics withheld.');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
