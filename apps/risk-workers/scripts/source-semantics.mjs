import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { DATASET_DIGEST, DATASET_UUID, datasetMode } from '@lmps/contracts/offline-dataset';
import { SOURCE_SEMANTICS_VERSION, SEMANTIC_SELECTOR_FIELDS, semanticSelectorKey, validateSourceSemantics } from '@lmps/contracts/source-semantics';
import { RISK_CATALOG, RISK_CATALOG_VERSION, riskHash } from '@lmps/risk';
import { ROOT } from '../../../packages/database/scripts/local.mjs';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';

const execute = promisify(execFile);
const MAXIMUM = 4 * 1024 * 1024;
const VALUE_FIELDS = ['result','txtype','totype','shouldrevert','isreconciled','issettled','ccy','amount','fee',
  'requesttime','txtime','responsetime','settletime','qrtype','fromchannel'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const selector = row => Object.fromEntries(SEMANTIC_SELECTOR_FIELDS.map(field => [field, row[field]]));
const presence = value => value === null ? 'null' : value === '' ? 'empty' : 'present';

function validateEvidence(input) {
  const v = structuredClone(input);
  if (!exact(v, ['format','source_manifest_sha256','adapter_receipt_sha256','source_archive_sha256','source_rows','sample_only','records'])
    || v.format !== 'lmps-semantic-evidence-1' || v.sample_only !== true || !Number.isInteger(v.source_rows)
    || v.source_rows < 1 || v.source_rows > 1000 || !Array.isArray(v.records) || v.records.length !== v.source_rows
    || Buffer.byteLength(JSON.stringify(v)) > MAXIMUM) throw new Error();
  for (const key of ['source_manifest_sha256','adapter_receipt_sha256','source_archive_sha256']) {
    if (typeof v[key] !== 'string' || v[key].length !== 64 || !DATASET_DIGEST.test(v[key])) throw new Error();
  }
  for (const [i, row] of v.records.entries()) {
    if (!exact(row, [...VALUE_FIELDS,'row_number','source_row_sha256','originalreference_presence'])
      || row.row_number !== i + 1 || typeof row.source_row_sha256 !== 'string' || row.source_row_sha256.length !== 64 || !DATASET_DIGEST.test(row.source_row_sha256)
      || !['null','empty','present'].includes(row.originalreference_presence)) throw new Error();
    for (const field of VALUE_FIELDS) {
      const value = row[field];
      if (value !== null && (typeof value !== 'string' || value.length > 800)) throw new Error();
      if (['totype','ccy','amount','requesttime','txtime','isreconciled','issettled'].includes(field) && value === null) throw new Error();
      if (['amount','fee'].includes(field) && value !== null && (!/^-?(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(value) || /\s/u.test(value))) throw new Error();
      if (['shouldrevert','isreconciled','issettled'].includes(field) && value !== null && (!/^(0|-?[1-9][0-9]{0,10})$/.test(value) || /\s/u.test(value))) throw new Error();
      if (['requesttime','txtime','responsetime','settletime'].includes(field) && value !== null
        && (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value.replace(' ', 'T') + 'Z'))
          || new Date(value.replace(' ', 'T') + 'Z').toISOString().slice(0,19).replace('T',' ') !== value)) throw new Error();
    }
  }
  return v;
}

export function draftSemantics(input) {
  datasetMode(); const evidence = validateEvidence(input);
  const groups = new Map(evidence.records.map(row => [semanticSelectorKey(selector(row)), selector(row)]));
  return validateSourceSemantics({ format: 1, execution_mode: 'offline_analysis', version: 'lmps_semantics_draft_v1',
    source_manifest_sha256: evidence.source_manifest_sha256, status: 'draft', evidence: null,
    lifecycle: [...groups.values()].map(source => ({ source, operation: 'unknown', state: 'unknown' })),
    currencies: [...new Set(evidence.records.map(row => row.ccy))].map(source_ccy => ({ source_ccy, currency: null, amount_unit: null, fee_unit: null })),
    time: null });
}

export function analyzeSemantics(input, mappingInput) {
  datasetMode(); const evidence = validateEvidence(input), mapping = validateSourceSemantics(mappingInput);
  if (mapping.source_manifest_sha256 !== evidence.source_manifest_sha256) throw new Error();
  const declared = mapping.status === 'owner_declared';
  const lifecycle = new Map(mapping.lifecycle.map(entry => [semanticSelectorKey(entry.source), entry]));
  const currencies = new Map(mapping.currencies.map(entry => [entry.source_ccy, entry]));
  const counts = { rows: evidence.source_rows, lifecycle_declared: 0, currency_declared: 0, time_declared: 0, fully_declared: 0, unavailable: 0 };
  const review = { negative_amount: 0, zero_amount: 0, fee_null: 0, response_before_request: 0, settlement_before_request: 0,
    original_reference_present: 0, reversal_declared: 0 };
  const frequencies = Object.fromEntries(['result','txtype','totype','ccy','shouldrevert','isreconciled','issettled','qrtype','fromchannel'].map(field => [field, new Map()]));
  const groups = new Map();
  const rows = evidence.records.map(row => {
    const key = semanticSelectorKey(selector(row)), entry = lifecycle.get(key), currency = currencies.get(row.ccy);
    const reasons = [];
    if (!declared) reasons.push('MAPPING_NOT_OWNER_DECLARED');
    const lifeReady = declared && entry && entry.operation !== 'unknown' && entry.state !== 'unknown';
    const currencyReady = declared && currency && currency.currency !== null && currency.amount_unit !== null && currency.fee_unit !== null;
    const timeReady = declared && mapping.time !== null;
    if (!lifeReady) reasons.push(entry ? 'LIFECYCLE_UNAVAILABLE' : 'LIFECYCLE_CODE_UNMAPPED');
    if (!currencyReady) reasons.push(currency ? 'CURRENCY_UNAVAILABLE' : 'CURRENCY_CODE_UNMAPPED');
    if (!timeReady) reasons.push('TIME_SEMANTICS_UNAVAILABLE');
    if (lifeReady) counts.lifecycle_declared++;
    if (currencyReady) counts.currency_declared++;
    if (timeReady) counts.time_declared++;
    if (!reasons.length) counts.fully_declared++; else counts.unavailable++;
    const reviewReasons = entry?.operation === 'reversal' && declared ? ['REVERSAL_LINKAGE_UNVERIFIED'] : [];
    review.reversal_declared += Number(reviewReasons.length > 0);
    const cents = BigInt(row.amount.replace('.', ''));
    review.negative_amount += Number(cents < 0n); review.zero_amount += Number(cents === 0n);
    review.fee_null += Number(row.fee === null);
    review.original_reference_present += Number(row.originalreference_presence === 'present');
    review.response_before_request += Number(row.responsetime !== null && row.responsetime < row.requesttime);
    review.settlement_before_request += Number(row.settletime !== null && row.settletime < row.requesttime);
    for (const [field, map] of Object.entries(frequencies)) {
      const value = row[field], id = JSON.stringify(value);
      map.set(id, { value, presence: presence(value), rows: (map.get(id)?.rows ?? 0) + 1 });
    }
    groups.set(key, { source: selector(row), rows: (groups.get(key)?.rows ?? 0) + 1,
      mapped: !!entry, declaration_available: !!lifeReady });
    return { row_number: row.row_number, source_row_sha256: row.source_row_sha256,
      declaration_status: reasons.length ? 'unavailable' : 'owner_declared', reason_codes: reasons, review_reason_codes: reviewReasons,
      operation: lifeReady ? entry.operation : 'unknown', state: lifeReady ? entry.state : 'unknown',
      currency: currencyReady ? currency.currency : null, amount_unit: currencyReady ? currency.amount_unit : null,
      fee_unit: currencyReady ? currency.fee_unit : null, time: timeReady ? mapping.time : null,
      net_executed_amount: null };
  });
  const missing = { identity: 'ACCOUNT_IDENTITY_UNVERIFIED', history: 'PILOT_HISTORY_INCOMPLETE',
    baseline: 'BASELINE_UNAVAILABLE', graph: 'ACCOUNT_GRAPH_UNAVAILABLE', flags: 'FLAGGED_ACCOUNTS_UNAVAILABLE' };
  const patterns = RISK_CATALOG.map(entry => ({ code: entry.code, readiness: 'blocked',
    reason_codes: [...(counts.lifecycle_declared === counts.rows ? [] : ['SOURCE_LIFECYCLE_UNAVAILABLE']),
      ...(counts.currency_declared === counts.rows ? [] : ['SOURCE_CURRENCY_UNAVAILABLE']),
      ...(counts.time_declared === counts.rows ? [] : ['SOURCE_TIME_SEMANTICS_UNAVAILABLE']),
      'SOURCE_DECLARATIONS_NOT_INDEPENDENTLY_VERIFIED','BUSINESS_IDENTITY_UNVERIFIED','NET_EXECUTED_AMOUNT_UNAVAILABLE','REAL_RISK_PIPELINE_NOT_ENABLED',
      ...entry.requires.map(key => missing[key] ?? 'REQUIRED_CONTEXT_UNAVAILABLE')] }));
  return { format: SOURCE_SEMANTICS_VERSION, execution_mode: 'offline_analysis', source_kind: 'user_supplied_file',
    source_semantics: 'unverified', account_identity: 'unverified', external_evidence_verified: false,
    assessment_performed: false, canonical_emission: false, operational_alerts: false, enforcement: false,
    evidence: { source_manifest_sha256: evidence.source_manifest_sha256, adapter_receipt_sha256: evidence.adapter_receipt_sha256,
      source_archive_sha256: evidence.source_archive_sha256, sample_only: true, source_rows: evidence.source_rows },
    mapping: { version: mapping.version, status: mapping.status, sha256: riskHash(mapping), evidence: mapping.evidence },
    validation_status: counts.fully_declared === counts.rows ? 'complete' : 'partial', counts,
    raw_observations: { interpretation: 'unverified', review_counts: review,
      code_counts: Object.fromEntries(Object.entries(frequencies).map(([key, values]) => [key, [...values.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,value]) => value)])),
      lifecycle_combinations: [...groups.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,value]) => value) },
    catalog_version: RISK_CATALOG_VERSION, ready_patterns: 0, patterns, rows };
}

export async function runSemantics({ adapted, mappingPath, output, runId }) {
  datasetMode();
  if (![adapted, output].every(path => typeof path === 'string' && isAbsolute(path)) || typeof runId !== 'string' || runId.length !== 36 || !DATASET_UUID.test(runId)
    || (mappingPath !== undefined && !isAbsolute(mappingPath))) throw new Error();
  await privateDirectory(adapted); await privateDirectory(dirname(output));
  const source = await realpath(adapted), target = resolve(await realpath(dirname(output)), basename(output));
  if (source === target || source.startsWith(target + sep) || target.startsWith(source + sep)) throw new Error();
  const child = await execute(join(ROOT, '.venv/bin/python'), ['-B', join(ROOT, 'apps/risk-workers/scripts/dataset_semantics.py'), adapted],
    { timeout: 30000, maxBuffer: MAXIMUM });
  if (child.stderr) throw new Error();
  const evidence = JSON.parse(child.stdout);
  if (mappingPath) await privateDirectory(dirname(mappingPath));
  const mapping = mappingPath ? validateSourceSemantics(await readPrivateJson(mappingPath, 2 * 1024 * 1024)) : draftSemantics(evidence);
  const report = analyzeSemantics(evidence, mapping);
  // A version is immutable within this output registry, independently of the run UUID.
  const digest = createHash('sha256').update(mapping.version).digest('hex').slice(0,32);
  const versionId = [digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20)].join('-');
  await savePrivateReport(output, 'v1', versionId, 'mapping.json', mapping, MAXIMUM);
  const created = await savePrivateReport(output, 'v1', runId, 'semantics.json', report, MAXIMUM);
  return { format: SOURCE_SEMANTICS_VERSION, publication: created ? 'created' : 'duplicate', run_id: runId, mapping_id: versionId,
    mapping_version: mapping.version, validation_status: report.validation_status, counts: report.counts,
    catalog_patterns: report.patterns.length, ready_patterns: 0, source_semantics: 'unverified',
    assessment_performed: false, canonical_emission: false, operational_alerts: false, enforcement: false };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args, options: { adapted: { type: 'string' }, mapping: { type: 'string' }, output: { type: 'string' }, 'run-id': { type: 'string' } } });
    const result = await runSemantics({ adapted: values.adapted, mappingPath: values.mapping, output: values.output, runId: values['run-id'] });
    console.info(JSON.stringify(result));
    return result.validation_status === 'complete' ? 0 : 2;
  } catch { console.error('SEMANTICS_VALIDATION_FAILED; private diagnostics withheld.'); return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
