/* Generated from Pydantic JSON Schema. Run pnpm generate:contracts; do not edit. */

export type SchemaVersion = "0.1.0-draft.1";
export type ExecutionMode = "live" | "shadow" | "backfill" | "replay" | "test";
export type RunId = string;
export type CorrelationId = string;
export type AssessmentId = string;
export type TransactionId = string;
export type TransactionRevision = string;
export type AssessedAt = string;
export type FeatureSnapshotRef = string | null;
export type VendorResponseRef = string | null;
export type FraudScore = MissingScore | IndexScore | ProbabilityScore;
export type Status = "not_evaluated" | "unavailable";
export type Value = null;
export type ReasonCode = string;
export type EngineVersion = string | null;
export type Status1 = "available";
export type Value1 = number;
export type Meaning = "risk_index";
export type EngineVersion1 = string;
export type CalibrationVersion = null;
export type Status2 = "available";
export type Value2 = number;
export type Meaning1 = "calibrated_probability";
export type EngineVersion2 = string;
export type CalibrationVersion1 = string;
export type MuleNetworkScore = MissingScore | IndexScore | ProbabilityScore;
export type AmlSuspicionScore = MissingScore | IndexScore | ProbabilityScore;
/**
 * @maxItems 256
 */
export type RulesTriggered = string[];
export type Decision = NoDecision | PolicyDecision;
export type Status3 = "not_decided";
export type Action = null;
export type PolicyVersion = null;
/**
 * @minItems 1
 * @maxItems 32
 */
export type ReasonCodes = [string, ...string[]];
export type Status4 = "decided";
export type Action1 = "allow" | "review" | "step_up" | "hold" | "block";
export type PolicyVersion1 = string;
/**
 * @minItems 1
 * @maxItems 32
 */
export type ReasonCodes1 = [string, ...string[]];

export interface RiskAssessment {
  schema_version: SchemaVersion;
  execution_mode: ExecutionMode;
  run_id: RunId;
  correlation_id: CorrelationId;
  assessment_id: AssessmentId;
  transaction_id: TransactionId;
  transaction_revision: TransactionRevision;
  assessed_at: AssessedAt;
  feature_snapshot_ref: FeatureSnapshotRef;
  vendor_response_ref: VendorResponseRef;
  fraud_score: FraudScore;
  mule_network_score: MuleNetworkScore;
  aml_suspicion_score: AmlSuspicionScore;
  rules_triggered: RulesTriggered;
  decision: Decision;
}
export interface MissingScore {
  status: Status;
  value: Value;
  reason_code: ReasonCode;
  engine_version: EngineVersion;
}
export interface IndexScore {
  status: Status1;
  value: Value1;
  meaning: Meaning;
  engine_version: EngineVersion1;
  calibration_version: CalibrationVersion;
}
export interface ProbabilityScore {
  status: Status2;
  value: Value2;
  meaning: Meaning1;
  engine_version: EngineVersion2;
  calibration_version: CalibrationVersion1;
}
export interface NoDecision {
  status: Status3;
  action: Action;
  policy_version: PolicyVersion;
  reason_codes: ReasonCodes;
}
export interface PolicyDecision {
  status: Status4;
  action: Action1;
  policy_version: PolicyVersion1;
  reason_codes: ReasonCodes1;
}
