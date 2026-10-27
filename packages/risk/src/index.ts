import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isRiskObservation, isTransactionRiskRequest, MAX_RISK_INPUT_BYTES,
  type RiskCode, type RiskEvent, type RiskFinding, type RiskObservation, type RiskTarget, type TransactionRiskRequest, type TransactionRiskResult, type DimensionScore } from '@lmps/contracts/transaction-risk';
import { RISK_CATALOG, RISK_CATALOG_VERSION, RISK_ENGINE_VERSION } from './catalog.js';
import { calculateRiskFeatures } from './features.js';
export * from './catalog.js';
export type * from '@lmps/contracts/transaction-risk';

export class RiskError extends Error {
  constructor(readonly code: 'RISK_INPUT_INVALID' | 'RISK_CONTEXT_CONFLICT' | 'RISK_RUN_CONFLICT' | 'RISK_POLICY_CONFLICT' | 'RISK_STORAGE_UNAVAILABLE') {
    super(`Synthetic risk: ${code}; details withheld.`);
  }
}
export function riskHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex');
}
export const cents = (value: string) => BigInt(value.replace('.', ''));
export const paymentKey = (target: RiskTarget) => JSON.stringify([target.namespace, target.transaction_id]);
export const revisionKey = (target: RiskTarget) => JSON.stringify([target.namespace, target.transaction_id, target.revision_number]);
export const riskTarget = (event: RiskTarget): RiskTarget => ({ namespace: event.namespace, transaction_id: event.transaction_id, revision_number: event.revision_number });
export const netAmount = (event: Pick<RiskEvent, 'status' | 'amount' | 'reversed_amount'>): bigint =>
  event.status === 'succeeded' || event.status === 'partially_reversed' ? cents(event.amount) - cents(event.reversed_amount) : 0n;
export function localRiskMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
    || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new RiskError('RISK_INPUT_INVALID');
}
export function validateRiskRequest(input: unknown): TransactionRiskRequest {
  try {
    localRiskMode();
    const request = structuredClone(input);
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_RISK_INPUT_BYTES || !isTransactionRiskRequest(request)
      || !isDeepStrictEqual(request, JSON.parse(JSON.stringify(request)))) throw new Error();
    const policy = request.policy;
    if (policy) {
      if (!(policy.severity_bps.medium < policy.severity_bps.high && policy.severity_bps.high < policy.severity_bps.critical)
        || cents(policy.minimum_amount) === 0n || cents(policy.structuring_ceiling) === 0n
        || new Set(policy.rules.map(rule => rule.code)).size !== RISK_CATALOG.length) throw new Error();
      for (const rule of policy.rules) {
        const unit = RISK_CATALOG.find(entry => entry.code === rule.code)!.unit;
        if (!(unit === 'amount' ? /^(0|[1-9]\d{0,21})\.\d{2}$/ : /^[1-9]\d{0,8}$/).test(rule.threshold)
          || (unit === 'amount' && cents(rule.threshold) === 0n)) throw new Error();
      }
      policy.rules.sort((a, b) => a.code.localeCompare(b.code, 'en'));
    }
    if (request.context) {
      const context = request.context;
      if (!isDeepStrictEqual(riskTarget(context.binding), request.target) || Date.parse(context.coverage_start) > Date.parse(context.as_of)
        || ((context.flagged_accounts === null) !== (context.flagged_accounts_version === null))) throw new Error();
      const unique = new Map<string, RiskEvent>();
      for (const event of context.events) {
        const original = cents(event.amount), reversed = cents(event.reversed_amount);
        if (Date.parse(event.available_at) < Date.parse(event.occurred_at) || reversed > original
          || (['succeeded', 'pending', 'failed'].includes(event.status) && reversed !== 0n)
          || (event.status === 'partially_reversed' && (reversed === 0n || reversed === original))
          || (event.status === 'reversed' && reversed !== original)) throw new Error();
        const key = revisionKey(event), previous = unique.get(key);
        if (previous && !isDeepStrictEqual(previous, event)) throw new Error();
        unique.set(key, event);
      }
      context.events = [...unique.values()].sort((a, b) => revisionKey(a) < revisionKey(b) ? -1 : revisionKey(a) > revisionKey(b) ? 1 : 0);
      context.flagged_accounts?.sort();
    }
    return request;
  } catch { throw new RiskError('RISK_INPUT_INVALID'); }
}

export function validateRiskObservation(input: unknown): RiskObservation {
  if (!isRiskObservation(input)) throw new RiskError('RISK_INPUT_INVALID');
  const available = input.status === 'available';
  if ((input.status === 'missing') !== (input.revision_sha256 === null)
    || (available ? [input.amount, input.reversed_amount, input.currency, input.transaction_status, input.observed_at].some(v => v === null)
      : [input.amount, input.reversed_amount, input.currency, input.transaction_status, input.observed_at].some(v => v !== null))) throw new RiskError('RISK_INPUT_INVALID');
  if (available) {
    const event = { status: input.transaction_status!, amount: input.amount!, reversed_amount: input.reversed_amount! };
    const reversed = cents(event.reversed_amount), original = cents(event.amount);
    if (reversed > original || (['succeeded', 'pending', 'failed'].includes(event.status) && reversed !== 0n)
      || (event.status === 'reversed' && reversed !== original) || (event.status === 'partially_reversed' && (reversed === 0n || reversed === original))) throw new RiskError('RISK_INPUT_INVALID');
  }
  return structuredClone(input);
}

export function evaluateTransactionRisk(input: unknown, source: unknown): TransactionRiskResult {
  const request = validateRiskRequest(input), observation = validateRiskObservation(source), policy = request.policy;
  if (request.context && observation.status === 'available') {
    if (request.context.binding.revision_sha256 !== observation.revision_sha256 || Date.parse(request.context.as_of) !== Date.parse(observation.observed_at!)) throw new RiskError('RISK_CONTEXT_CONFLICT');
  }
  const features = calculateRiskFeatures(request, observation);
  const findings: RiskFinding[] = RISK_CATALOG.map(entry => {
    const rule = policy?.rules.find(rule => rule.code === entry.code);
    let status: RiskFinding['status'], reason: string;
    const feature = features[entry.code];
    if (!policy) { status = 'not_evaluated'; reason = 'POLICY_NOT_CONFIGURED'; }
    else if (!rule!.enabled) { status = 'not_evaluated'; reason = 'RULE_DISABLED'; }
    else if (feature.reason) { status = feature.notApplicable ? 'not_applicable' : 'unavailable'; reason = feature.reason; }
    else {
      const threshold = entry.unit === 'amount' ? cents(rule!.threshold) : BigInt(rule!.threshold);
      status = feature.value! >= threshold ? 'triggered' : 'not_triggered';
      reason = status === 'triggered' ? 'PATTERN_THRESHOLD_MET' : 'PATTERN_THRESHOLD_NOT_MET';
    }
    return { code: entry.code, dimension: entry.dimension, status, reason_code: reason,
      metric: status === 'triggered' || status === 'not_triggered' ? { value: entry.unit === 'amount'
        ? `${feature.value! / 100n}.${String(feature.value! % 100n).padStart(2, '0')}` : String(feature.value), unit: entry.unit, threshold: rule!.threshold } : null,
      severity: status === 'triggered' ? rule!.severity : null, evidence_refs: status === 'triggered' || status === 'not_triggered' ? feature.refs : [] };
  });
  const score = (dimension: RiskFinding['dimension']): DimensionScore => {
    const rows = findings.filter(f => f.dimension === dimension), active = rows.filter(f => policy?.rules.find(r => r.code === f.code)!.enabled);
    const evaluated = active.filter(f => ['triggered', 'not_triggered'].includes(f.status)), unavailable = active.filter(f => f.status === 'unavailable').length;
    const coverage = { configured: active.length, evaluated: evaluated.length, triggered: evaluated.filter(f => f.status === 'triggered').length, unavailable,
      not_applicable: active.filter(f => f.status === 'not_applicable').length, not_evaluated: rows.filter(f => f.status === 'not_evaluated').length };
    if (unavailable || !evaluated.length) return { status: unavailable ? 'unavailable' : 'not_evaluated', value: null, meaning: 'risk_index', severity: null,
      reason_code: unavailable ? 'SCORE_INCOMPLETE' : !policy ? 'POLICY_NOT_CONFIGURED' : 'NO_APPLICABLE_RULES', coverage };
    const weight = (f: RiskFinding) => policy!.rules.find(r => r.code === f.code)!.weight_bps;
    const numerator = evaluated.filter(f => f.status === 'triggered').reduce((sum, f) => sum + weight(f), 0), denominator = evaluated.reduce((sum, f) => sum + weight(f), 0);
    const bps = Math.floor(numerator * 10000 / denominator), thresholds = policy!.severity_bps;
    return { status: 'available', value: Math.floor(numerator * 1e6 / denominator) / 1e6, meaning: 'risk_index',
      severity: bps >= thresholds.critical ? 'critical' : bps >= thresholds.high ? 'high' : bps >= thresholds.medium ? 'medium' : 'low', reason_code: 'SCORE_AVAILABLE', coverage };
  };
  const evaluated = findings.filter(f => ['triggered', 'not_triggered'].includes(f.status)).length, unavailable = findings.some(f => f.status === 'unavailable');
  const assessment_status = unavailable ? evaluated ? 'partial' : 'unavailable' : evaluated ? 'complete' : findings.some(f => f.status === 'not_applicable') ? 'not_applicable' : 'not_evaluated';
  const risk_types = findings.filter(f => f.status === 'triggered').map(f => f.code);
  return { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.workspace_key, run_id: request.run_id, target: request.target,
    engine_version: RISK_ENGINE_VERSION, catalog_version: RISK_CATALOG_VERSION, policy: policy ? { policy_id: policy.policy_id, version: policy.version, sha256: riskHash(policy) } : null,
    assessment_id: request.run_id, as_of: observation.observed_at, reason_codes: [...new Set(findings.map(f => f.reason_code))].sort(),
    input_sha256: riskHash({ request, observation }), revision_sha256: observation.revision_sha256, feature_snapshot_sha256: request.context ? riskHash(request.context) : null,
    assessment_status, response_code: assessment_status === 'partial' ? 'RISK_ASSESSMENT_PARTIAL' : assessment_status === 'unavailable' ? 'RISK_ASSESSMENT_UNAVAILABLE'
      : assessment_status === 'not_evaluated' ? 'RISK_NOT_EVALUATED' : assessment_status === 'not_applicable' ? 'RISK_NOT_APPLICABLE' : risk_types.length ? 'RISK_SIGNALS_DETECTED' : 'NO_SIGNAL_IN_EVALUATED_SCOPE',
    source_semantics: 'unverified', identity_scope: 'synthetic_only', historical_availability: request.context ? 'synthetic_declared' : 'unverified',
    canonical_emission: false, enforcement: false, decision: { status: 'not_decided', action: null, reason_code: 'NO_ENFORCEMENT_POLICY' },
    fraud_score: score('fraud'), mule_network_score: score('mule_network'), aml_suspicion_score: score('aml'), risk_types, findings };
}

export * from './alerts.js';
export { RISK_CODES } from '@lmps/contracts/transaction-risk';

export * from './policy-lifecycle.js';
export type * from '@lmps/contracts/risk-policy';

export * from './cases.js';

export * from './model-signal.js';

export * from './pretransfer-simulation.js';

export * from './pretransfer-reservations.js';

export * from './qa-sampling.js';

export * from './feature-stream.js';

export * from './feature-serving.js';

export * from './feature-contributions.js';

export * from './feature-window-state.js';
