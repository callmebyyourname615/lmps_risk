import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createDatabase } from './index.js';
import { validateTransactionRevision, type LocalTransactionRevision } from './transaction-revisions.js';
import type { PoolClient } from 'pg';
import { NORMALIZER_VERSION, CODEBOOK_VERSION } from '@lmps/contracts/synthetic-normalization';

function localMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
    || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new Error('Local synthetic rules require test mode.');
}

export const RULE_EVALUATOR_VERSION = 'synthetic-rules-0.1.0-draft.1';
export const MAX_BACKTEST_MANIFEST_BYTES = 128 * 1024;
export const MAX_BACKTEST_REPORT_BYTES = 2 * 1024 * 1024;
const states = ['pending', 'succeeded', 'failed', 'partially_reversed', 'reversed'] as const;
type Lifecycle = typeof states[number];
export interface SyntheticRule {
  rule_id: string; rule_version: string; risk_dimension: 'fraud' | 'aml'; kind: 'amount_gte';
  currency: string; statuses: Lifecycle[]; threshold: string;
}
export interface BacktestTarget { namespace: string; transaction_id: string; revision_number: number }
export interface BacktestManifest {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; evaluator_version: typeof RULE_EVALUATOR_VERSION;
  run_id: string; workspace_key: 'synthetic_local'; rules: SyntheticRule[]; targets: BacktestTarget[];
}
export interface BacktestObservation { target: BacktestTarget; revision: unknown | null }
type Outcome = 'match' | 'no_match' | 'not_applicable' | 'unavailable';
export interface BacktestReport {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; evaluator_version: typeof RULE_EVALUATOR_VERSION;
  normalizer_version: typeof NORMALIZER_VERSION; codebook_version: typeof CODEBOOK_VERSION;
  purpose: 'synthetic_stateless_backtest'; canonical_emission: false; enforcement: false; source_semantics: 'unverified';
  historical_availability: 'unverified'; status: 'partial' | 'complete'; run_id: string; workspace_key: 'synthetic_local';
  manifest_sha256: string; rules_sha256: string; input_set_sha256: string; rules: SyntheticRule[];
  counts: { targets: number; available_inputs: number; unavailable_inputs: number; matched_observations: number;
    rule_matches: number; no_matches: number; not_applicable: number; unavailable: number };
  rows: Array<{ target: BacktestTarget; availability: 'available' | 'missing' | 'invalid' | 'not_normalized'; input_sha256: string | null;
    source: { source_reference: { namespace: string; record_ref: string; mapping_version: string | null }; observed_at: string;
      publisher_version: string; capture_id: string; snapshot_sha256: string; evidence_sha256: string } | null;
    results: Array<{ rule_id: string; rule_version: string; rule_sha256: string; risk_dimension: 'fraud' | 'aml'; outcome: Outcome; reason_code: string;
      evidence: { amount: string; currency: string; transaction_status: string; threshold: string; threshold_currency: string;
        amount_semantics: 'original_observed_amount' } | null }> }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const money = /^(0|[1-9]\d{0,21})\.\d{2}$/;
export const ruleEvidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex');
const key = (target: BacktestTarget) => JSON.stringify([target.namespace, target.transaction_id, target.revision_number]);
const exact = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function validateBacktestManifest(input: unknown): BacktestManifest {
  try {
    localMode();
    const m = structuredClone(input) as BacktestManifest;
    if (!exact(m, ['format', 'provenance', 'execution_mode', 'evaluator_version', 'run_id', 'workspace_key', 'rules', 'targets'])
      || m.format !== 1 || m.provenance !== 'local_synthetic' || m.execution_mode !== 'test' || m.evaluator_version !== RULE_EVALUATOR_VERSION
      || typeof m.run_id !== 'string' || !uuid.test(m.run_id) || m.workspace_key !== 'synthetic_local'
      || !Array.isArray(m.rules) || m.rules.length < 1 || m.rules.length > 20
      || !Array.isArray(m.targets) || m.targets.length < 1 || m.targets.length > 100
      || Buffer.byteLength(JSON.stringify(m)) > MAX_BACKTEST_MANIFEST_BYTES || !isDeepStrictEqual(m, JSON.parse(JSON.stringify(m)))) throw new Error();
    const ruleIds = new Set<string>(), targets = new Set<string>();
    for (const rule of m.rules) {
      if (!exact(rule, ['rule_id', 'rule_version', 'risk_dimension', 'kind', 'currency', 'statuses', 'threshold'])
        || typeof rule.rule_id !== 'string' || !/^synthetic_[a-z0-9_]{1,60}$/.test(rule.rule_id) || ruleIds.has(rule.rule_id)
        || typeof rule.rule_version !== 'string' || !/^synthetic_[A-Za-z0-9_.:-]{1,70}$/.test(rule.rule_version)
        || !['fraud', 'aml'].includes(rule.risk_dimension) || rule.kind !== 'amount_gte'
        || typeof rule.currency !== 'string' || !/^[A-Z]{3}$/.test(rule.currency)
        || typeof rule.threshold !== 'string' || !money.test(rule.threshold)
        || !Array.isArray(rule.statuses) || rule.statuses.length < 1 || rule.statuses.length > 5
        || new Set(rule.statuses).size !== rule.statuses.length || rule.statuses.some(state => !states.includes(state))) throw new Error();
      ruleIds.add(rule.rule_id); rule.statuses.sort();
    }
    for (const target of m.targets) {
      if (!exact(target, ['namespace', 'transaction_id', 'revision_number'])
        || typeof target.namespace !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(target.namespace)
        || typeof target.transaction_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(target.transaction_id)
        || !Number.isInteger(target.revision_number) || target.revision_number < 1 || target.revision_number > 2147483647
        || targets.has(key(target))) throw new Error();
      targets.add(key(target));
    }
    m.rules.sort((a, b) => a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0);
    m.targets.sort((a, b) => a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1
      : a.transaction_id < b.transaction_id ? -1 : a.transaction_id > b.transaction_id ? 1 : a.revision_number - b.revision_number);
    return m;
  } catch { throw new Error('Invalid local synthetic rule backtest; details withheld.'); }
}

export function assessmentRuleResult(rule: SyntheticRule, tx: { amount: string; currency: string; transaction_status: string } | null,
  availability: BacktestReport['rows'][number]['availability']): BacktestReport['rows'][number]['results'][number] {
  let outcome: Outcome, reason_code: string;
  if (!tx) { outcome = 'unavailable'; reason_code = { missing: 'INPUT_MISSING', invalid: 'INPUT_INVALID', not_normalized: 'INPUT_NOT_NORMALIZED', available: 'INPUT_INVALID' }[availability]; }
  else if (tx.currency !== rule.currency) { outcome = 'not_applicable'; reason_code = 'CURRENCY_OUT_OF_SCOPE'; }
  else if (!rule.statuses.includes(tx.transaction_status as Lifecycle)) { outcome = 'not_applicable'; reason_code = 'LIFECYCLE_OUT_OF_SCOPE'; }
  else {
    const matched = BigInt(tx.amount.replace('.', '')) >= BigInt(rule.threshold.replace('.', ''));
    outcome = matched ? 'match' : 'no_match'; reason_code = matched ? 'AMOUNT_AT_OR_ABOVE_THRESHOLD' : 'AMOUNT_BELOW_THRESHOLD';
  }
  return { rule_id: rule.rule_id, rule_version: rule.rule_version, rule_sha256: ruleEvidenceHash(rule), risk_dimension: rule.risk_dimension,
    outcome, reason_code, evidence: tx ? { amount: tx.amount, currency: tx.currency, transaction_status: tx.transaction_status,
      threshold: rule.threshold, threshold_currency: rule.currency, amount_semantics: 'original_observed_amount' as const } : null };
}

export function evaluateBacktest(input: unknown, observations: BacktestObservation[]): BacktestReport {
  const manifest = validateBacktestManifest(input);
  if (!Array.isArray(observations) || observations.length !== manifest.targets.length
    || Buffer.byteLength(JSON.stringify(observations)) > 8 * 1024 * 1024) throw new Error('Invalid local backtest observations.');
  const byTarget = new Map<string, BacktestObservation>();
  for (const observation of observations) {
    if (!exact(observation, ['target', 'revision']) || !manifest.targets.some(target => isDeepStrictEqual(target, observation.target))
      || byTarget.has(key(observation.target))) throw new Error('Invalid local backtest observations.');
    byTarget.set(key(observation.target), structuredClone(observation));
  }
  const counts = { targets: manifest.targets.length, available_inputs: 0, unavailable_inputs: 0, matched_observations: 0,
    rule_matches: 0, no_matches: 0, not_applicable: 0, unavailable: 0 };
  const rows = manifest.targets.map(target => {
    const revision = byTarget.get(key(target))!.revision;
    let value: LocalTransactionRevision | null = null;
    let availability: 'available' | 'missing' | 'invalid' | 'not_normalized' = revision === null ? 'missing' : 'invalid';
    if (revision !== null) {
      try {
        const checked = validateTransactionRevision(revision);
        if (checked.workspace_key !== manifest.workspace_key || checked.transaction.source_reference.namespace !== target.namespace
          || checked.transaction.transaction_id !== target.transaction_id || checked.expected_revision + 1 !== target.revision_number) throw new Error();
        if (checked.publication) { value = checked; availability = 'available'; }
        else availability = 'not_normalized';
      } catch { availability = 'invalid'; }
    }
    counts[value ? 'available_inputs' : 'unavailable_inputs']++;
    const results = manifest.rules.map(rule => {
      const result = assessmentRuleResult(rule, value?.transaction ?? null, availability);
      counts[result.outcome === 'match' ? 'rule_matches' : result.outcome === 'no_match' ? 'no_matches' : result.outcome]++;
      return result;
    });
    if (results.some(result => result.outcome === 'match')) counts.matched_observations++;
    return { target, availability, input_sha256: revision === null ? null : ruleEvidenceHash(revision),
      source: value ? { source_reference: { ...value.transaction.source_reference }, observed_at: value.transaction.observed_at,
        publisher_version: value.publication!.publisher_version, capture_id: value.publication!.capture_id,
        snapshot_sha256: value.publication!.snapshot_sha256, evidence_sha256: value.publication!.evidence_sha256 } : null, results };
  });
  const report: BacktestReport = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', evaluator_version: RULE_EVALUATOR_VERSION,
    normalizer_version: NORMALIZER_VERSION, codebook_version: CODEBOOK_VERSION,
    purpose: 'synthetic_stateless_backtest', canonical_emission: false, enforcement: false, source_semantics: 'unverified',
    historical_availability: 'unverified', status: counts.unavailable_inputs ? 'partial' : 'complete',
    run_id: manifest.run_id, workspace_key: manifest.workspace_key, manifest_sha256: ruleEvidenceHash(manifest), rules_sha256: ruleEvidenceHash(manifest.rules),
    input_set_sha256: ruleEvidenceHash(rows.map(row => ({ target: row.target, availability: row.availability, sha256: row.input_sha256 }))),
    rules: manifest.rules, counts, rows };
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_BACKTEST_REPORT_BYTES) throw new Error('Local backtest report exceeds its bound.');
  return report;
}

export async function readBacktest(manifest: BacktestManifest, client: Pick<PoolClient, 'query'>): Promise<BacktestReport> {
  // One SQL statement freezes the explicit revision set; it never selects a mutable latest head.
  const result = await client.query(`WITH requested AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS q(namespace text,transaction_id text,revision_number integer))
    SELECT q.namespace,q.transaction_id,q.revision_number,r.payload,r.publication,r.revision_number IS NOT NULL AS found
    FROM requested q LEFT JOIN platform.local_transaction_revisions r ON r.workspace_key=$1
      AND r.namespace=q.namespace AND r.transaction_id=q.transaction_id AND r.revision_number=q.revision_number`,
  [manifest.workspace_key, JSON.stringify(manifest.targets)]);
  const observations = result.rows.map(row => ({ target: { namespace: row.namespace, transaction_id: row.transaction_id, revision_number: row.revision_number },
    revision: row.found ? { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: manifest.workspace_key,
      expected_revision: row.revision_number - 1, transaction: row.payload, ...(row.publication === null ? {} : { publication: row.publication }) } : null }));
  return evaluateBacktest(manifest, observations);
}

export async function runBacktest(input: unknown, dsn: string): Promise<BacktestReport> {
  const manifest = validateBacktestManifest(input), database = createDatabase(dsn);
  try { return await readBacktest(manifest, database.pool); }
  catch { throw new Error('Local rule backtest unavailable; storage details withheld.'); }
  finally { await database.close(); }
}
