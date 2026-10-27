import { Ajv2020 } from 'ajv/dist/2020.js';
import { RISK_CODES, type RiskCode, type Severity } from './transaction-risk.js';

export interface AlertPolicy {
  policy_id: string; version: string; minimum_severity: Severity; included_codes: RiskCode[]; include_partial: boolean;
}
export interface AlertGenerationRequest {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; workspace_key: 'synthetic_local';
  assessment_run_id: string; policy: AlertPolicy;
}
export type AlertState = 'open' | 'acknowledged' | 'reviewed';
export type ReviewOutcome = 'suspicious' | 'legitimate' | 'unknown';
export interface AlertReviewCommand {
  request_id: string; expected_version: number; action: 'acknowledge' | 'review'; outcome: ReviewOutcome | null; note: string | null;
}
export interface AlertReviewEvent extends AlertReviewCommand {
  version: number; actor_subject: string; actor_role: 'lmps_reviewer'; occurred_at: string;
}
export const ALERT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const synthetic = { type: 'string', pattern: '^synthetic_[A-Za-z0-9_.:-]{1,70}$', maxLength: 80 };
const uuid = { type: 'string', pattern: ALERT_UUID.source, maxLength: 36 };
export const alertPolicySchema = object({ policy_id: synthetic, version: synthetic,
  minimum_severity: { enum: ['low', 'medium', 'high', 'critical'] },
  included_codes: { type: 'array', minItems: 1, maxItems: 15, uniqueItems: true, items: { enum: RISK_CODES } }, include_partial: { type: 'boolean' } });
export const alertGenerationSchema = object({ format: { const: 1 }, provenance: { const: 'local_synthetic' }, execution_mode: { const: 'test' },
  workspace_key: { const: 'synthetic_local' }, assessment_run_id: uuid, policy: alertPolicySchema });
export const alertReviewSchema = object({ request_id: uuid, expected_version: { type: 'integer', minimum: 0, maximum: 1 },
  action: { enum: ['acknowledge', 'review'] }, outcome: { enum: ['suspicious', 'legitimate', 'unknown', null] },
  note: { anyOf: [{ type: 'string', minLength: 1, maxLength: 1000, pattern: '[^\\s]' }, { type: 'null' }] } });
const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const policy = ajv.compile<AlertPolicy>(alertPolicySchema), generation = ajv.compile<AlertGenerationRequest>(alertGenerationSchema), review = ajv.compile<AlertReviewCommand>(alertReviewSchema);
export const isAlertPolicy = (input: unknown): input is AlertPolicy => policy(input) === true;
export const isAlertGenerationRequest = (input: unknown): input is AlertGenerationRequest => generation(input) === true;
export const isAlertReviewCommand = (input: unknown): input is AlertReviewCommand => review(input) === true;
