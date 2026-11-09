import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { validateFeatureStoreScope } from '@lmps/contracts/feature-serving';
import { evaluateFeatureRisk, riskHash, type FeatureRiskResult } from '@lmps/risk';
import type { DimensionScore, RiskDimension, RiskFinding, TransactionRiskResult } from '@lmps/contracts/transaction-risk';

export const FEATURE_RISK_REPLAY_VERSION = 'synthetic-feature-risk-replay-1' as const;
export class FeatureRiskReplayError extends Error {
  readonly code = 'FEATURE_RISK_REPLAY_INVALID';
  constructor() { super('Invalid bounded synthetic feature risk replay'); }
}
/** Each field is validated by US1201 before any assessment is included. */
export interface FeatureRiskReplayInput { serving_request: unknown; risk_request: unknown; observation: unknown }
type FindingCounts = Record<RiskFinding['status'], number>;
interface DimensionCounts {
  findings: FindingCounts;
  scores: { available: number; unavailable: number; not_evaluated: number };
  coverage: DimensionScore['coverage'];
}
export interface FeatureRiskReplayReport {
  version: typeof FEATURE_RISK_REPLAY_VERSION; production_ready: false;
  status: 'complete' | 'partial'; source_semantics: 'unverified'; identity_scope: 'synthetic_only';
  publication_sha256: string; scope_sha256: string; inputs_sha256: string;
  dimensions: Record<RiskDimension, DimensionCounts>;
  rows: Array<{ query_id: string; run_id: string; input_sha256: string; result_sha256: string;
    policy_sha256: string | null; feature_source_sha256: string;
    assessment_sha256: string; feature: { status: FeatureRiskResult['feature']['status']; reason: string | null };
    context: FeatureRiskResult['context']; lineage: FeatureRiskResult['lineage']; assessment: TransactionRiskResult }>;
}

/** IO-free explicit ordered replay, 1..8 tuples and <=2MiB input/output.
 * Frozen publications are restored by the existing bridge; the existing 200-event
 * risk bound withholds context. Hashes bind supplied evidence, not real-source
 * attestation. No latest-head lookup, clock, mutation, model fitting or IO.
 * A report contains assessments/hashes, not eight copies of publication history.
 * Source eligibility and owner policy review remain open. This is not evidence
 * of historical completeness, detector accuracy or production backtest acceptance.
 */
export function replayFeatureRisk(publication: unknown, exactScope: unknown, tuples: unknown): FeatureRiskReplayReport {
  try {
    const detached = detachFeatureJSON({ publication, scope: exactScope, tuples });
    const scope = validateFeatureStoreScope(detached.scope);
    const inputs: FeatureRiskReplayInput[] = detached.tuples;
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 8
      || inputs.some(input => !input || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'observation,risk_request,serving_request')) throw new FeatureRiskReplayError();
    const counts = (): DimensionCounts => ({ findings: { triggered: 0, not_triggered: 0, not_applicable: 0, unavailable: 0, not_evaluated: 0 },
      scores: { available: 0, unavailable: 0, not_evaluated: 0 },
      coverage: { configured: 0, evaluated: 0, triggered: 0, unavailable: 0, not_applicable: 0, not_evaluated: 0 } });
    const dimensions: Record<RiskDimension, DimensionCounts> = { fraud: counts(), mule_network: counts(), aml: counts() };
    const seen = new Set<string>();
    const rows = inputs.map(input => {
      const result = evaluateFeatureRisk(detached.publication, scope, input.serving_request, input.risk_request, input.observation);
      if (seen.has(result.assessment.run_id)) throw new FeatureRiskReplayError();
      seen.add(result.assessment.run_id);
      for (const finding of result.assessment.findings) dimensions[finding.dimension].findings[finding.status]++;
      for (const [dimension, score] of [['fraud', result.assessment.fraud_score], ['mule_network', result.assessment.mule_network_score], ['aml', result.assessment.aml_suspicion_score]] as const) {
        dimensions[dimension].scores[score.status]++;
        for (const key of Object.keys(score.coverage) as Array<keyof DimensionScore['coverage']>) {
          dimensions[dimension].coverage[key] += score.coverage[key];
        }
      }
      return { query_id: result.feature.request.query.id, run_id: result.assessment.run_id,
        input_sha256: riskHash(input), result_sha256: riskHash(result), assessment_sha256: riskHash(result.assessment),
        policy_sha256: result.lineage.policy_sha256,
        feature_source_sha256: riskHash({ publication: result.publication, lineage: result.lineage, feature: result.feature }),
        feature: { status: result.feature.status, reason: result.feature.reason }, context: result.context,
        lineage: result.lineage, assessment: result.assessment };
    });
    const report: FeatureRiskReplayReport = { version: FEATURE_RISK_REPLAY_VERSION, production_ready: false,
      status: rows.some(row => row.feature.status !== 'available' || row.context.status === 'withheld'
        || ['partial', 'unavailable', 'not_evaluated'].includes(row.assessment.assessment_status)) ? 'partial' : 'complete',
      source_semantics: 'unverified', identity_scope: 'synthetic_only', publication_sha256: riskHash(detached.publication),
      scope_sha256: riskHash(scope), inputs_sha256: riskHash(inputs), dimensions, rows };
    return detachFeatureJSON(report) as FeatureRiskReplayReport;
  } catch { throw new FeatureRiskReplayError(); }
}

export interface FeatureRiskReplayComparison {
  production_ready: false;
  status: 'match' | 'mismatch';
  replay_sha256: string;
  mismatches: Array<{ index: number; replay_result_sha256: string; individual_result_sha256: string }>;
}

/** Compare full individual US1201 envelopes in tuple order with a freshly
 * recomputed replay. Caller hashes, nested success flags and old reports cannot
 * authorize anything: full canonical envelopes must match. This is parity only,
 * not independent validation of detector semantics or source eligibility.
 */
export function compareFeatureRiskReplay(publication: unknown, exactScope: unknown, tuples: unknown,
  individuallyServed: unknown): FeatureRiskReplayComparison {
  try {
    const individual = detachFeatureJSON(individuallyServed);
    if (!Array.isArray(individual) || individual.length < 1 || individual.length > 8) throw new FeatureRiskReplayError();
    const replay = replayFeatureRisk(publication, exactScope, tuples);
    if (individual.length !== replay.rows.length) throw new FeatureRiskReplayError();
    const mismatches: FeatureRiskReplayComparison['mismatches'] = [];
    replay.rows.forEach((row, index) => {
      const actual = riskHash(individual[index]);
      if (actual !== row.result_sha256) mismatches.push({ index, replay_result_sha256: row.result_sha256, individual_result_sha256: actual });
    });
    return { production_ready: false, status: mismatches.length ? 'mismatch' : 'match', replay_sha256: riskHash(replay), mismatches };
  } catch { throw new FeatureRiskReplayError(); }
}
