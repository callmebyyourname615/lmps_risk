import { Ajv2020 } from 'ajv/dist/2020.js';
import type { RiskTarget, TransactionRiskResult } from './transaction-risk.js';

export const CASE_MAX_ALERTS = 20;
export const CASE_MAX_EVENTS = 1000;
export const CASE_MAX_COMMAND_BYTES = 16 * 1024;
export const CASE_STATES = ['open', 'in_review', 'closed'] as const;
export type CaseState = (typeof CASE_STATES)[number];
export type CaseOpinion = 'suspicious' | 'legitimate' | 'unknown';
export type CaseDimensions = Record<'fraud' | 'mule_network' | 'aml', { outcome: CaseOpinion; rationale: string }>;
type Base = { request_id: string; expected_version: number; note: string };
export type CaseCommand = Base &
  (
    | { action: 'create'; title: string; alert_id: string }
    | { action: 'link_alert'; alert_id: string }
    | { action: 'assign'; assignee_subject: string }
    | { action: 'start' | 'add_note' | 'close' | 'reopen' }
    | { action: 'record_outcome'; dimensions: CaseDimensions }
  );
export interface CaseEvidence {
  alert_id: string;
  alert_snapshot_sha256: string;
  assessment_run_id: string;
  assessment_sha256: string;
  target: RiskTarget;
  risk_policy: TransactionRiskResult['policy'];
  alert_policy: { policy_id: string; version: string; sha256: string };
}
export interface CaseView {
  case_id: string;
  title: string;
  state: CaseState;
  version: number;
  assignee_subject: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  review_cycle: number;
  evidence_version: number;
  active_outcome_version: number | null;
  alert_count: number;
}
export const CASE_ERRORS = [
  'CASE_INVALID_INPUT',
  'CASE_NOT_FOUND',
  'CASE_ALERT_NOT_FOUND',
  'CASE_CONFLICT',
  'CASE_ALERT_ALREADY_LINKED',
  'CASE_INVALID_TRANSITION',
  'CASE_NOT_ASSIGNEE',
  'CASE_OUTCOME_REQUIRED',
  'CASE_LIMIT_REACHED',
  'CASE_STORAGE_UNAVAILABLE',
  'CASE_WRITES_NOT_CONFIGURED',
] as const;
export type CaseErrorCode = (typeof CASE_ERRORS)[number];
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const dimension = object({ outcome: { enum: ['suspicious', 'legitimate', 'unknown'] }, rationale: text(1000) });
export const caseCommandSchema = {
  oneOf: [
    ['create', { title: text(120), alert_id: uuid }],
    ['link_alert', { alert_id: uuid }],
    ['assign', { assignee_subject: { type: 'string', pattern: '^synthetic_[a-z0-9_]{1,40}$' } }],
    ['start', {}],
    ['add_note', {}],
    ['close', {}],
    ['reopen', {}],
    ['record_outcome', { dimensions: object({ fraud: dimension, mule_network: dimension, aml: dimension }) }],
  ].map(([action, properties]) =>
    object({
      action: { const: action },
      request_id: uuid,
      expected_version: { type: 'integer', minimum: 0, maximum: CASE_MAX_EVENTS },
      note: text(2000),
      ...(properties as Record<string, unknown>),
    }),
  ),
};
const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const check = ajv.compile<CaseCommand>(caseCommandSchema);
export const isCaseCommand = (value: unknown): value is CaseCommand => check(value) === true;
