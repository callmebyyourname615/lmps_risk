/* Generated from Pydantic JSON Schema. Run pnpm generate:contracts; do not edit. */

export type Format = "lmps-shadow-result-1";
export type ExecutionMode = "shadow";
export type Provenance = "local_synthetic" | "user_supplied_file";
export type SourceSemantics = "unverified";
export type Status = "available" | "unavailable";
export type ReasonCode =
  | "MODEL_SCORED"
  | "SOURCE_SEMANTICS_UNVERIFIED"
  | "MODEL_UNAVAILABLE"
  | "FEATURE_UNAVAILABLE"
  | "MODEL_TRAINING_CUTOFF_AFTER_AS_OF"
  | "CURRENCY_OUT_OF_SCOPE";
export type Scope = "synthetic_shadow_only";
export type Namespace = string;
export type TransactionId = string;
export type RevisionNumber = number;
export type RevisionSha256 = string | null;
export type AsOf = string | null;
export type FeatureSha256 = string;
export type Name = string;
export type Version = string;
export type ArtifactSha256 = string;
export type Algorithm = "baseline" | "logistic" | "lightgbm";
export type Currency = string;
export type DatasetSha256 = string;
export type NoveltyScore = string | null;
export type HistoricalModelAvailability = "retrospective_experiment";
export type Enforcement = false;
export type CanonicalEmission = false;
export type KeyId = string;
export type Signature = string;

export interface ShadowResult {
  format: Format;
  execution_mode: ExecutionMode;
  provenance: Provenance;
  source_semantics: SourceSemantics;
  status: Status;
  reason_code: ReasonCode;
  scope: Scope;
  target: Target | null;
  revision_sha256: RevisionSha256;
  as_of: AsOf;
  feature_sha256: FeatureSha256;
  model: ModelIdentity | null;
  probabilities: Probabilities;
  novelty_score: NoveltyScore;
  historical_model_availability: HistoricalModelAvailability;
  enforcement: Enforcement;
  canonical_emission: CanonicalEmission;
  key_id: KeyId;
  signature: Signature;
}
export interface Target {
  namespace: Namespace;
  transaction_id: TransactionId;
  revision_number: RevisionNumber;
}
export interface ModelIdentity {
  name: Name;
  version: Version;
  artifact_sha256: ArtifactSha256;
  algorithm: Algorithm;
  currency: Currency;
  dataset_sha256: DatasetSha256;
}
export interface Probabilities {
  [k: string]: string;
}
