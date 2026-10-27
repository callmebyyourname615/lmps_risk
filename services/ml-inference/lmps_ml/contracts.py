"""Authoritative draft wire contracts; source mapping and policies are unverified."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

SCHEMA_VERSION = "0.1.0-draft.1"

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")]
ReasonCode = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]{0,63}$")]
Amount = Annotated[str, Field(max_length=80, pattern=r"^(0|[1-9][0-9]*)(\.[0-9]+)?$")]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]


def valid_calendar_date(value: str) -> str:
    datetime.fromisoformat(value)
    return value


Timestamp = Annotated[
    str,
    Field(
        pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?Z$",
        json_schema_extra={"format": "date-time"},
    ),
    AfterValidator(valid_calendar_date),
]
RiskDimension = Literal["fraud", "mule_network", "aml"]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)


class Envelope(ContractModel):
    schema_version: Literal["0.1.0-draft.1"]
    execution_mode: Literal["live", "shadow", "backfill", "replay", "test"]
    run_id: Identifier
    correlation_id: Identifier


class UnresolvedAccount(ContractModel):
    status: Literal["unresolved"]
    source_representation: Literal["masked", "unmasked", "unknown"]
    reason_code: ReasonCode


class ResolvedAccount(ContractModel):
    status: Literal["resolved"]
    namespace: Identifier
    owning_institution_id: Identifier
    account_token: Identifier
    resolution_version: Identifier


class SourceReference(ContractModel):
    namespace: Identifier
    record_ref: Identifier
    mapping_version: Identifier | None


class Transaction(Envelope):
    transaction_id: Identifier
    transaction_revision: Identifier
    source_reference: SourceReference
    occurred_at: Timestamp | None
    observed_at: Timestamp
    sender: UnresolvedAccount | ResolvedAccount
    receiver: UnresolvedAccount | ResolvedAccount
    source_bank_id: Identifier | None
    destination_bank_id: Identifier | None
    amount: Amount
    currency: Currency
    transaction_type: Identifier | None
    channel: Identifier | None
    transaction_status: Literal["unknown", "pending", "succeeded", "failed", "reversed", "partially_reversed"]


class MissingScore(ContractModel):
    status: Literal["not_evaluated", "unavailable"]
    value: None
    reason_code: ReasonCode
    engine_version: Identifier | None


class IndexScore(ContractModel):
    status: Literal["available"]
    value: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    meaning: Literal["risk_index"]
    engine_version: Identifier
    calibration_version: None


class ProbabilityScore(ContractModel):
    status: Literal["available"]
    value: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    meaning: Literal["calibrated_probability"]
    engine_version: Identifier
    calibration_version: Identifier


Score = MissingScore | IndexScore | ProbabilityScore


class NoDecision(ContractModel):
    status: Literal["not_decided"]
    action: None
    policy_version: None
    reason_codes: Annotated[list[ReasonCode], Field(min_length=1, max_length=32)]


class PolicyDecision(ContractModel):
    status: Literal["decided"]
    action: Literal["allow", "review", "step_up", "hold", "block"]
    policy_version: Identifier
    reason_codes: Annotated[list[ReasonCode], Field(min_length=1, max_length=32)]


class RiskAssessment(Envelope):
    assessment_id: Identifier
    transaction_id: Identifier
    transaction_revision: Identifier
    assessed_at: Timestamp
    feature_snapshot_ref: Identifier | None
    vendor_response_ref: Identifier | None
    fraud_score: Score
    mule_network_score: Score
    aml_suspicion_score: Score
    rules_triggered: Annotated[list[Identifier], Field(max_length=256)]
    decision: NoDecision | PolicyDecision


def unique_dimensions(values: list[RiskDimension]) -> list[RiskDimension]:
    if len(values) != len(set(values)):
        raise ValueError("Risk dimensions must be unique.")
    return values


class Alert(Envelope):
    alert_id: Identifier
    assessment_id: Identifier
    transaction_id: Identifier
    transaction_revision: Identifier
    created_at: Timestamp
    severity: Literal["low", "medium", "high", "critical"]
    risk_dimensions: Annotated[
        list[RiskDimension],
        Field(min_length=1, max_length=3, json_schema_extra={"uniqueItems": True}),
        AfterValidator(unique_dimensions),
    ]
    reason_codes: Annotated[list[ReasonCode], Field(min_length=1, max_length=32)]
    alert_policy_version: Identifier
    evidence_refs: Annotated[list[Identifier], Field(min_length=1, max_length=64)]


CONTRACTS = {"transaction": Transaction, "risk-assessment": RiskAssessment, "alert": Alert}
