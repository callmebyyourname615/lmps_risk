import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ShadowRequest, FeatureSnapshot } from './generated/ml-shadow-request.js';
import type { ShadowResult, ModelIdentity } from './generated/ml-shadow-result.js';
import type { AlertPolicy } from './local-alert.js';
import type { RiskDimension } from './transaction-risk.js';

export type { ShadowRequest, FeatureSnapshot, ShadowResult, ModelIdentity };
const ajv = new Ajv2020({ strict: true, coerceTypes: false, removeAdditional: false });
const schema = (name: string) => JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
const request = ajv.compile<ShadowRequest>(schema('ml-shadow-request'));
const result = ajv.compile<ShadowResult>(schema('ml-shadow-result'));
export const isShadowRequest = (value: unknown): value is ShadowRequest => request(value) === true;
export const isShadowResult = (value: unknown): value is ShadowResult => result(value) === true;
export const ML_FEATURE_SPEC = JSON.parse(readFileSync(new URL('../schemas/ml-feature-spec.json', import.meta.url), 'utf8'));
export interface ModelReference { name: string; version: string; artifact_sha256: string }
export interface ModelTrust { key_id: string; public_key: string }
export interface ModelGatePolicy {
  policy_id: string; version: string; task: RiskDimension; probability_threshold: string;
  missing_model: 'skip' | 'rules_only'; model: ModelReference; alert_policy: AlertPolicy;
}
export interface ModelGateRequest {
  format: 1; execution_mode: 'shadow'; workspace_key: 'synthetic_local'; request_id: string; assessment_run_id: string; policy: ModelGatePolicy;
}
export interface ModelGateDecision {
  status: 'eligible' | 'skipped'; reason_code: 'RULES_NO_MATCH' | 'MODEL_CONFIRMED' | 'MODEL_BELOW_THRESHOLD' | 'MODEL_UNAVAILABLE' | 'EXPLICIT_RULES_FALLBACK';
  task: RiskDimension; probability: string | null; enforcement: false;
}
export interface ModelReceiptView {
  request_id: string; assessment_run_id: string; policy: ModelGatePolicy; feature_sha256: string;
  model: ModelIdentity | null; model_status: 'available' | 'unavailable'; probabilities: Record<string, string>;
  decision: ModelGateDecision; alert_id: string | null; receipt_sha256: string; recorded_by: string; recorded_at: string;
  training_eligible: false; enforcement: false; scope: 'synthetic_shadow_only';
}
