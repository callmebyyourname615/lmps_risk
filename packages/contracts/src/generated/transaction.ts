/* Generated from Pydantic JSON Schema. Run pnpm generate:contracts; do not edit. */

export type SchemaVersion = "0.1.0-draft.1";
export type ExecutionMode = "live" | "shadow" | "backfill" | "replay" | "test";
export type RunId = string;
export type CorrelationId = string;
export type TransactionId = string;
export type TransactionRevision = string;
export type Namespace = string;
export type RecordRef = string;
export type MappingVersion = string | null;
export type OccurredAt = string | null;
export type ObservedAt = string;
export type Sender = UnresolvedAccount | ResolvedAccount;
export type Status = "unresolved";
export type SourceRepresentation = "masked" | "unmasked" | "unknown";
export type ReasonCode = string;
export type Status1 = "resolved";
export type Namespace1 = string;
export type OwningInstitutionId = string;
export type AccountToken = string;
export type ResolutionVersion = string;
export type Receiver = UnresolvedAccount | ResolvedAccount;
export type SourceBankId = string | null;
export type DestinationBankId = string | null;
export type Amount = string;
export type Currency = string;
export type TransactionType = string | null;
export type Channel = string | null;
export type TransactionStatus = "unknown" | "pending" | "succeeded" | "failed" | "reversed" | "partially_reversed";

export interface Transaction {
  schema_version: SchemaVersion;
  execution_mode: ExecutionMode;
  run_id: RunId;
  correlation_id: CorrelationId;
  transaction_id: TransactionId;
  transaction_revision: TransactionRevision;
  source_reference: SourceReference;
  occurred_at: OccurredAt;
  observed_at: ObservedAt;
  sender: Sender;
  receiver: Receiver;
  source_bank_id: SourceBankId;
  destination_bank_id: DestinationBankId;
  amount: Amount;
  currency: Currency;
  transaction_type: TransactionType;
  channel: Channel;
  transaction_status: TransactionStatus;
}
export interface SourceReference {
  namespace: Namespace;
  record_ref: RecordRef;
  mapping_version: MappingVersion;
}
export interface UnresolvedAccount {
  status: Status;
  source_representation: SourceRepresentation;
  reason_code: ReasonCode;
}
export interface ResolvedAccount {
  status: Status1;
  namespace: Namespace1;
  owning_institution_id: OwningInstitutionId;
  account_token: AccountToken;
  resolution_version: ResolutionVersion;
}
