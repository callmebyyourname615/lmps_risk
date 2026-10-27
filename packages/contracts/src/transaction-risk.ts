import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';

export const RISK_CODES = ['FRAUD_HIGH_AMOUNT', 'FRAUD_COUNT_VELOCITY', 'FRAUD_AMOUNT_VELOCITY', 'FRAUD_NEW_COUNTERPARTY',
  'FRAUD_AMOUNT_DEVIATION', 'FRAUD_FREQUENCY_DEVIATION', 'MULE_FAN_IN', 'MULE_FAN_OUT', 'MULE_RAPID_PASS_THROUGH',
  'MULE_NETWORK_CYCLE', 'MULE_FLAGGED_NEIGHBOR', 'AML_STRUCTURING_PATTERN', 'AML_REPEATED_HIGH_VALUE', 'AML_MULTI_HOP_FLOW', 'AML_NETWORK_DEVIATION'] as const;
export type RiskCode = typeof RISK_CODES[number];
export type RiskDimension = 'fraud' | 'mule_network' | 'aml';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Locale = 'lo' | 'en';
export interface RiskTarget { namespace: string; transaction_id: string; revision_number: number }
export interface RiskEvent extends RiskTarget {
  sender: string; receiver: string; occurred_at: string; available_at: string; currency: string; amount: string;
  status: 'pending' | 'succeeded' | 'failed' | 'partially_reversed' | 'reversed'; reversed_amount: string;
}
export interface RiskPolicy {
  policy_id: string; version: string; currency: string; window_seconds: number; baseline_windows: number; graph_depth: number;
  minimum_amount: string; structuring_ceiling: string; near_threshold_bps: number;
  severity_bps: { medium: number; high: number; critical: number };
  rules: Array<{ code: RiskCode; enabled: boolean; threshold: string; weight_bps: number; severity: Severity }>;
}
export interface RiskContext {
  binding: RiskTarget & { revision_sha256: string }; identity_status: 'synthetic_declared' | 'unverified';
  as_of: string; coverage_start: string; coverage_complete: boolean; events: RiskEvent[];
  flagged_accounts: string[] | null; flagged_accounts_version: string | null;
}
export interface TransactionRiskRequest {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; workspace_key: 'synthetic_local';
  run_id: string; target: RiskTarget; policy: RiskPolicy | null; context: RiskContext | null;
}
export interface RiskObservation {
  status: 'available' | 'missing' | 'invalid' | 'not_normalized'; revision_sha256: string | null;
  amount: string | null; reversed_amount: string | null; currency: string | null; transaction_status: RiskEvent['status'] | null; observed_at: string | null;
}
export interface RiskFinding {
  code: RiskCode; dimension: RiskDimension; status: 'triggered' | 'not_triggered' | 'not_applicable' | 'unavailable' | 'not_evaluated';
  reason_code: string; metric: { value: string; unit: 'amount' | 'count' | 'basis_points'; threshold: string } | null;
  severity: Severity | null; evidence_refs: RiskTarget[];
}
export interface DimensionScore {
  status: 'available' | 'unavailable' | 'not_evaluated'; value: number | null; meaning: 'risk_index'; severity: Severity | null;
  reason_code: string; coverage: { configured: number; evaluated: number; triggered: number; unavailable: number; not_applicable: number; not_evaluated: number };
}
export interface TransactionRiskResult {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; workspace_key: 'synthetic_local'; run_id: string; target: RiskTarget;
  engine_version: string; catalog_version: string; policy: { policy_id: string; version: string; sha256: string } | null;
  assessment_id: string; as_of: string | null; reason_codes: string[];
  input_sha256: string; revision_sha256: string | null; feature_snapshot_sha256: string | null;
  assessment_status: 'complete' | 'partial' | 'unavailable' | 'not_evaluated' | 'not_applicable'; response_code: string;
  source_semantics: 'unverified'; identity_scope: 'synthetic_only'; historical_availability: 'synthetic_declared' | 'unverified';
  canonical_emission: false; enforcement: false; decision: { status: 'not_decided'; action: null; reason_code: 'NO_ENFORCEMENT_POLICY' };
  fraud_score: DimensionScore; mule_network_score: DimensionScore; aml_suspicion_score: DimensionScore;
  risk_types: RiskCode[]; findings: RiskFinding[];
}

export const MAX_RISK_INPUT_BYTES = 384 * 1024;
const string = (pattern: string, maxLength: number) => ({ type: 'string', pattern, maxLength });
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const synthetic = string('^synthetic_[A-Za-z0-9_.:-]{1,70}$', 80);
const currency = string('^[A-Z]{3}$', 3);
const amount = string('^(0|[1-9][0-9]{0,21})\\.[0-9]{2}$', 25);
const digest = string('^[0-9a-f]{64}$', 64);
const timestamp = { ...string('^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$', 24), format: 'date-time' };
const status = { enum: ['pending', 'succeeded', 'failed', 'partially_reversed', 'reversed'] };
const targetProperties = { namespace: string('^synthetic_[a-z0-9_]{1,40}$', 50), transaction_id: string('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', 128), revision_number: integer(1, 2147483647) };
const target = object(targetProperties);
export const transactionRiskRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...object({ format: { const: 1 }, provenance: { const: 'local_synthetic' }, execution_mode: { const: 'test' }, workspace_key: { const: 'synthetic_local' },
    run_id: string('^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 36), target,
    policy: nullable(object({ policy_id: synthetic, version: synthetic, currency, window_seconds: integer(1, 86400), baseline_windows: integer(1, 30), graph_depth: integer(2, 5),
      minimum_amount: amount, structuring_ceiling: amount, near_threshold_bps: integer(1, 9999), severity_bps: object({ medium: integer(1, 10000), high: integer(1, 10000), critical: integer(1, 10000) }),
      rules: { type: 'array', minItems: RISK_CODES.length, maxItems: RISK_CODES.length, items: object({ code: { enum: RISK_CODES }, enabled: { type: 'boolean' },
        threshold: string('^(0|[1-9][0-9]{0,21})(\\.[0-9]{2})?$', 25), weight_bps: integer(1, 10000), severity: { enum: ['low', 'medium', 'high', 'critical'] } }) } })),
    context: nullable(object({ binding: object({ ...targetProperties, revision_sha256: digest }), identity_status: { enum: ['synthetic_declared', 'unverified'] },
      as_of: timestamp, coverage_start: timestamp, coverage_complete: { type: 'boolean' }, events: { type: 'array', maxItems: 200, items: object({ ...targetProperties,
        sender: synthetic, receiver: synthetic, occurred_at: timestamp, available_at: timestamp, currency, amount, status, reversed_amount: amount }) },
      flagged_accounts: nullable({ type: 'array', maxItems: 200, uniqueItems: true, items: synthetic }), flagged_accounts_version: nullable(synthetic) })) }),
};
const observationSchema = object({ status: { enum: ['available', 'missing', 'invalid', 'not_normalized'] }, revision_sha256: nullable(digest),
  amount: nullable(amount), reversed_amount: nullable(amount), currency: nullable(currency), transaction_status: nullable(status), observed_at: nullable(timestamp) });
const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
formatsPlugin.default(ajv, { mode: 'full', formats: ['date-time'] });
const requestCheck = ajv.compile<TransactionRiskRequest>(transactionRiskRequestSchema);
const observationCheck = ajv.compile<RiskObservation>(observationSchema);
export const isTransactionRiskRequest = (input: unknown): input is TransactionRiskRequest => requestCheck(input) === true;
export const isRiskObservation = (input: unknown): input is RiskObservation => observationCheck(input) === true;
