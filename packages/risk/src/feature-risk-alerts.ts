import { evaluateFeatureRisk, type FeatureRiskResult } from './feature-risk.js';
import { projectAlert, validateAlertPolicy, AlertError, type AlertPolicy, type AlertSnapshot } from './alerts.js';
import { riskHash } from './index.js';

// Reject descriptors before schema validation; no caller code runs during detachment.
function detachPolicy(input: unknown): unknown {
  let remaining = 100;
  const walk = (value: unknown, depth: number): unknown => {
    const invalid = (): never => { throw new AlertError('INVALID_ALERT_INPUT'); };
    if (--remaining < 0 || depth > 3) return invalid();
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length <= 80 ? value : invalid();
    if (!value || typeof value !== 'object') return invalid();
    const array = Array.isArray(value), keys = Reflect.ownKeys(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)
      || keys.length > 16 || (array && keys.length !== value.length + 1)) return invalid();
    const out: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || (array && key !== String((out as unknown[]).length))) return invalid();
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!d.enumerable || !('value' in d)) return invalid();
      (out as Record<string, unknown>)[key] = walk(d.value, depth + 1);
    }
    return out;
  };
  return walk(input, 0);
}

export interface FeatureRiskAlertProjection {
  version: 'synthetic-feature-risk-alerts-1'; production_ready: false;
  projection_kind: 'pure_projection'; durable_grouping: false;
  evidence: FeatureRiskResult;
  alert_policy: AlertPolicy;
  identities: {
    assessment_sha256: string; feature_sha256: string; alert_policy_sha256: string;
    risk_policy_sha256: string | null; source_sha256: string | null;
    source_prefix: number | null; publication: FeatureRiskResult['publication'];
  };
  source_status: 'available' | 'withheld'; source_reason: string | null;
  reason_code: ReturnType<typeof projectAlert>['reason_code'] | 'FEATURE_CONTEXT_WITHHELD';
  assessment_projection_reason: ReturnType<typeof projectAlert>['reason_code'];
  candidates: { candidate_sha256: string; snapshot: AlertSnapshot }[];
  remaining_gates: readonly string[];
}

/** IO-free local synthetic projection, bounded to one grouped candidate per assessment.
 * Recomputes US1201 from raw inputs; never accepts an assessment or success flag.
 * Candidate hashes identify this projection only, not durable deduplication groups.
 * Withheld context can retain an independently evaluated amount finding, but never
 * constitutes a successful no-match source assessment. No lifecycle/storage actions,
 * account verification, capacity, calibrated probability or enforcement claims.
 */
export function projectFeatureRiskAlerts(publicationOrNull: unknown, exactScope: unknown, servingRequest: unknown,
  riskRequest: unknown, observation: unknown, alertPolicy: unknown): FeatureRiskAlertProjection {
  const policy = validateAlertPolicy(detachPolicy(alertPolicy));
  const evidence = evaluateFeatureRisk(publicationOrNull, exactScope, servingRequest, riskRequest, observation);
  const projected = projectAlert(evidence.assessment, policy);
  const identities = {
    assessment_sha256: riskHash(evidence.assessment), feature_sha256: riskHash(evidence),
    alert_policy_sha256: riskHash(policy), risk_policy_sha256: evidence.lineage.policy_sha256,
    source_sha256: evidence.lineage.source_sha256, source_prefix: evidence.lineage.source_prefix,
    publication: evidence.publication,
  };
  return { version: 'synthetic-feature-risk-alerts-1', production_ready: false,
    projection_kind: 'pure_projection', durable_grouping: false, evidence, alert_policy: policy, identities,
    source_status: evidence.context.status, source_reason: evidence.context.reason,
    reason_code: evidence.context.status === 'withheld' && projected.snapshot === null
      ? 'FEATURE_CONTEXT_WITHHELD' : projected.reason_code,
    assessment_projection_reason: projected.reason_code,
    candidates: projected.snapshot === null ? [] : [{
      candidate_sha256: riskHash({ identities, snapshot: projected.snapshot }), snapshot: projected.snapshot,
    }],
    remaining_gates: ['verified_source_account_identity', 'owner_reviewed_policy', 'historical_eligibility',
      'durable_alert_integration', 'workload_capacity_slo', 'production_adoption'],
  };
}
