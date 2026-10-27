/* Generated from Pydantic JSON Schema. Run pnpm generate:contracts; do not edit. */

export type SchemaVersion = "0.1.0-draft.1";
export type ExecutionMode = "live" | "shadow" | "backfill" | "replay" | "test";
export type RunId = string;
export type CorrelationId = string;
export type AlertId = string;
export type AssessmentId = string;
export type TransactionId = string;
export type TransactionRevision = string;
export type CreatedAt = string;
export type Severity = "low" | "medium" | "high" | "critical";
/**
 * @minItems 1
 * @maxItems 3
 */
export type RiskDimensions =
  | ["fraud" | "mule_network" | "aml"]
  | ["fraud" | "mule_network" | "aml", "fraud" | "mule_network" | "aml"]
  | ["fraud" | "mule_network" | "aml", "fraud" | "mule_network" | "aml", "fraud" | "mule_network" | "aml"];
/**
 * @minItems 1
 * @maxItems 32
 */
export type ReasonCodes = [string, ...string[]];
export type AlertPolicyVersion = string;
/**
 * @minItems 1
 * @maxItems 64
 */
export type EvidenceRefs = [string, ...string[]];

export interface Alert {
  schema_version: SchemaVersion;
  execution_mode: ExecutionMode;
  run_id: RunId;
  correlation_id: CorrelationId;
  alert_id: AlertId;
  assessment_id: AssessmentId;
  transaction_id: TransactionId;
  transaction_revision: TransactionRevision;
  created_at: CreatedAt;
  severity: Severity;
  risk_dimensions: RiskDimensions;
  reason_codes: ReasonCodes;
  alert_policy_version: AlertPolicyVersion;
  evidence_refs: EvidenceRefs;
}
