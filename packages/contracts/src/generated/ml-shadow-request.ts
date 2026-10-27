/* Generated from Pydantic JSON Schema. Run pnpm generate:contracts; do not edit. */

export type Format = 1;
export type ExecutionMode = "shadow";
export type Provenance = "local_synthetic" | "user_supplied_file";
export type SourceSemantics = "synthetic_declared" | "unverified";
export type Namespace = string;
export type TransactionId = string;
export type RevisionNumber = number;
export type RevisionSha256 = string | null;
export type AsOf = string | null;
export type Currency = string | null;
export type FeatureVersion = "lmps-features-1";
export type FeatureSpecSha256 = string;
export type Status = "available" | "unavailable";
export type ReasonCode = string | null;
export type Values = [string, string, string, string, string, string] | null;
export type NetAmountCents = string | null;
export type FeatureSha256 = string;

export interface ShadowRequest {
  format: Format;
  execution_mode: ExecutionMode;
  provenance: Provenance;
  source_semantics: SourceSemantics;
  snapshot: FeatureSnapshot;
}
export interface FeatureSnapshot {
  target: Target | null;
  revision_sha256: RevisionSha256;
  as_of: AsOf;
  currency: Currency;
  feature_version: FeatureVersion;
  feature_spec_sha256: FeatureSpecSha256;
  status: Status;
  reason_code: ReasonCode;
  values: Values;
  net_amount_cents: NetAmountCents;
  feature_sha256: FeatureSha256;
}
export interface Target {
  namespace: Namespace;
  transaction_id: TransactionId;
  revision_number: RevisionNumber;
}
