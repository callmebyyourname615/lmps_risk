"""No.42: bounded point-in-time reference features and explicit temporal/label availability."""
from datetime import datetime, timedelta
import math
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .private import digest, encoded, mode, publish

VERSION = "lmps-features-1"
FEATURES = {"log1p_net_amount": "log1p(exact net cents / 100); approximate model transform, not a monetary total",
            "hour_sin_utc": "sin(UTC decision hour / 24 * 2pi)", "hour_cos_utc": "cos(UTC decision hour / 24 * 2pi)",
            "outgoing_count_1h": "distinct earlier known latest-revision executed sender payments in [as_of-1h,as_of)",
            "log1p_outgoing_amount_1h": "log1p(exact same-currency earlier net cents sum / 100)",
            "receiver_unseen_1h": "receiver absent from earlier covered one-hour sender window; not a new account claim"}
FEATURE_NAMES = list(FEATURES)
FEATURE_SPEC = {"version": VERSION, "definitions": FEATURES, "window_seconds": 3600,"encoding":"fixed_9_decimal_strings","currency_policy":"one_currency_per_model_no_fx"}
FEATURE_SHA = digest(FEATURE_SPEC)
TASKS = ("fraud", "mule_network", "aml")


def stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z", value):
        raise ValueError("ML_TIME_INVALID")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.year < 1000:
        raise ValueError("ML_TIME_INVALID")
    return result


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Target(Strict):
    namespace: str = Field(pattern=r"^synthetic_[a-z0-9_]{1,40}$")
    transaction_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    revision_number: int = Field(ge=1, le=2147483647)


class Label(Strict):
    outcome: int | None = Field(ge=0, le=1)
    review_status: Literal["unreviewed", "adjudicated"]
    source_status: Literal["synthetic_declared", "unverified"]
    mature_at: str | None
    available_at: str | None
    reviewed_at: str | None
    reviewer_ref: str | None = Field(pattern=r"^synthetic_[A-Za-z0-9_-]{1,60}$")
    evidence_sha256: str | None = Field(min_length=64,max_length=64,pattern=r"^[0-9a-f]{64}$")


class Event(Strict):
    row_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    target: Target | None
    revision_sha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")
    as_of: str | None
    occurred_at: str | None
    available_at: str | None
    sender: str | None = Field(pattern=r"^synthetic_[A-Za-z0-9_-]{1,60}$")
    receiver: str | None = Field(pattern=r"^synthetic_[A-Za-z0-9_-]{1,60}$")
    currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    amount: str | None = Field(pattern=r"^-?(0|[1-9][0-9]{0,21})\.[0-9]{2}$")
    reversed_amount: str | None = Field(pattern=r"^(0|[1-9][0-9]{0,21})\.[0-9]{2}$")
    status: Literal["pending", "succeeded", "failed", "partially_reversed", "reversed"] | None
    labels: dict[str, Label]

    @model_validator(mode="after")
    def validate_values(self):
        if set(self.labels) != set(TASKS):
            raise ValueError("ML_LABEL_TASKS_INVALID")
        for value in [self.as_of, self.occurred_at, self.available_at,
                      *(label.mature_at for label in self.labels.values()), *(label.available_at for label in self.labels.values()),
                      *(label.reviewed_at for label in self.labels.values())]:
            if value is not None:
                stamp(value)
        return self


class DatasetInput(Strict):
    format: Literal[1]
    version: str = Field(pattern=r"^ml_dataset_[A-Za-z0-9_.-]{1,48}$")
    execution_mode: Literal["offline_analysis"]
    provenance: Literal["local_synthetic", "user_supplied_file"]
    source_semantics: Literal["synthetic_declared", "unverified"]
    identity_status: Literal["synthetic_declared", "unverified"]
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    coverage_start: str | None
    history_complete: bool
    label_sampling: Literal["synthetic_population", "reviewed_cohort_only"]
    train_end: str
    calibration_end: str
    test_end: str
    evaluation_at: str
    embargo_seconds: int = Field(ge=3600, le=86400)
    rows: list[Event] = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_scope(self):
        if not stamp(self.train_end) < stamp(self.calibration_end) < stamp(self.test_end) <= stamp(self.evaluation_at):
            raise ValueError("ML_SPLIT_INVALID")
        if self.coverage_start is not None:
            stamp(self.coverage_start)
        if len({r.row_id for r in self.rows}) != len(self.rows):
            raise ValueError("ML_DUPLICATE_ROW")
        if self.provenance != "local_synthetic" and (self.source_semantics != "unverified" or self.identity_status != "unverified"
                or any(r.target is not None or r.sender is not None or r.receiver is not None for r in self.rows)):
            raise ValueError("ML_REAL_IDENTITY_UNVERIFIED")
        versions = {}
        for row in self.rows:
            if row.target:
                key = (row.target.namespace, row.target.transaction_id, row.target.revision_number)
                # Repeated target revisions cannot smuggle a corrected historical state.
                content = digest({k: v for k, v in row.model_dump().items() if k not in {"row_id", "as_of", "labels"}})
                if key in versions and versions[key] != content:
                    raise ValueError("ML_REVISION_CONFLICT")
                versions[key] = content
        return self


def net(row):
    if row.amount is None or row.reversed_amount is None:
        raise ValueError("ML_MONEY_UNAVAILABLE")
    amount, reversed_amount = int(row.amount.replace(".", "")), int(row.reversed_amount.replace(".", ""))
    if amount < 0 or reversed_amount > amount:
        raise ValueError("ML_MONEY_INVALID")
    if (row.status in {'pending','failed','succeeded'} and reversed_amount != 0
            or row.status == 'reversed' and reversed_amount != amount
            or row.status == 'partially_reversed' and not 0 < reversed_amount < amount):
        raise ValueError('ML_REVERSAL_INVALID')
    return amount - reversed_amount if row.status in {"succeeded", "partially_reversed"} else 0


def partition(row, request):
    if row.as_of is None:
        return "outside"
    time = stamp(row.as_of)
    train, calibration, test = map(stamp, (request.train_end, request.calibration_end, request.test_end))
    embargo = timedelta(seconds=request.embargo_seconds)
    if time < train:
        return "train"
    if train <= time < train + embargo or calibration <= time < calibration + embargo:
        return "purged"
    if time < calibration:
        return "calibration"
    return "test" if time < test else "outside"


def feature_reason(row,request):
    if request.provenance!='local_synthetic' or request.source_semantics!='synthetic_declared':return 'SOURCE_SEMANTICS_UNVERIFIED'
    if request.identity_status!='synthetic_declared' or row.sender is None or row.receiver is None:return 'IDENTITY_UNVERIFIED'
    if not row.target or not row.revision_sha256 or any(v is None for v in (row.as_of,row.occurred_at,row.available_at)):return 'TIME_OR_BINDING_UNAVAILABLE'
    if stamp(row.available_at)>stamp(row.as_of) or stamp(row.occurred_at)>stamp(row.as_of):return 'TARGET_NOT_YET_AVAILABLE'
    if not request.history_complete or request.coverage_start is None or stamp(request.coverage_start)>stamp(row.as_of)-timedelta(hours=1):return 'HISTORY_INCOMPLETE'
    if row.currency is None or row.status not in {'succeeded','partially_reversed'}:return 'EXECUTION_OR_CURRENCY_UNAVAILABLE'
    return None


def feature_values(amount,as_of,count,total,seen):
    hour=as_of.hour+as_of.minute/60
    return [format(v,'.9f') for v in [math.log1p(amount/100),math.sin(hour/24*2*math.pi),math.cos(hour/24*2*math.pi),
            float(count),math.log1p(total/100),float(not seen)]]


def feature_record(row,part,vector,reason,exact_cents):
    core={'row_id':row.row_id,'target':None if row.target is None else row.target.model_dump(),'revision_sha256':row.revision_sha256,
          'as_of':row.as_of,'partition':part,'feature_version':VERSION,'feature_spec_sha256':FEATURE_SHA,'currency':row.currency,
          'status':'available' if vector is not None else 'unavailable','reason_code':reason,'values':vector,'net_amount_cents':exact_cents,
          'labels':{task:label.model_dump() for task,label in row.labels.items()}}
    core['feature_sha256']=digest({k:v for k,v in core.items() if k not in {'labels','partition','row_id'}})
    return core


def build_dataset(value):
    mode()
    request = DatasetInput.model_validate(value)
    request.rows.sort(key=lambda row:row.row_id)
    if len(encoded(value)) > 8 * 1024 * 1024:
        raise ValueError("ML_DATASET_LIMIT")
    rows = []
    # One decision per business transaction across evaluation partitions. A correction
    # must not let a training example reappear as a supposedly held-out payment.
    decisions = {}
    for item in request.rows:
        if item.target:
            key = (item.target.namespace,item.target.transaction_id)
            part = partition(item,request)
            if part in {'train','calibration','test'}:decisions[key]=decisions.get(key,0)+1
    for row in sorted(request.rows, key=lambda item: item.row_id):
        reason = feature_reason(row,request)
        vector, exact_cents = None, None
        if reason is None:
            latest = {}
            as_of = stamp(row.as_of)
            for event in request.rows:
                if (not event.target or not event.available_at or not event.occurred_at
                        or stamp(event.available_at) > as_of or stamp(event.occurred_at) > as_of):
                    continue
                key = (event.target.namespace, event.target.transaction_id)
                if key not in latest or event.target.revision_number > latest[key].target.revision_number:
                    latest[key] = event
            selected = latest.get((row.target.namespace,row.target.transaction_id))
            if selected is None or selected.target.revision_number != row.target.revision_number:
                reason = 'TARGET_REVISION_SUPERSEDED'
            history = [event for key, event in latest.items() if key != (row.target.namespace,row.target.transaction_id)
                       and event.sender == row.sender and event.currency == row.currency
                       and as_of - timedelta(hours=1) <= stamp(event.occurred_at) < as_of]
            try:
                amount = net(row)
                exact_cents = str(amount)
                history = [event for event in history if net(event) > 0]
                vector = feature_values(amount,as_of,len(history),sum(net(event) for event in history),any(e.receiver==row.receiver for e in history))
            except ValueError:
                reason = "MONEY_UNAVAILABLE"
            if reason is not None:vector,exact_cents=None,None
        part = partition(row, request)
        if row.target and decisions.get((row.target.namespace,row.target.transaction_id),0) > 1:
            part = 'purged'
        rows.append(feature_record(row,part,vector,reason,exact_cents))
    report = {"format": "lmps-feature-dataset-1", "version": request.version, "provenance": request.provenance,
              "source_semantics": "unverified", "source_sha256": request.source_sha256, "input_sha256": digest(request.model_dump()),
              "feature_version": VERSION, "feature_spec_sha256": FEATURE_SHA, "feature_definitions": FEATURES,
              "label_sampling":request.label_sampling,
              "split": {k:getattr(request,k) for k in ("train_end","calibration_end","test_end","evaluation_at","embargo_seconds")},
              "counts": {"rows":len(rows),"available":sum(r["status"] == "available" for r in rows),
                         **{part:sum(r["partition"] == part for r in rows) for part in ("train","calibration","test","purged","outside")}},
              "rows":rows, "enforcement":False,"operational_alerts":False}
    report["dataset_sha256"] = digest(report)
    return report


def save_dataset(value, path):
    report = build_dataset(value)
    created = publish(path, {"dataset.json":encoded(report), "input.json":encoded(value)})
    return {"status":"created" if created else "duplicate", "counts":report["counts"], "dataset_sha256":report["dataset_sha256"]}


def validate_dataset(report):
    mode()
    value = dict(report)
    expected = value.pop("dataset_sha256")
    if (digest(value) != expected or value["format"] != "lmps-feature-dataset-1" or value["feature_spec_sha256"] != FEATURE_SHA
            or not 1 <= len(value["rows"]) <= 2000):
        raise ValueError("ML_DATASET_CHANGED")
    for row in value["rows"]:
        if row["status"] == "available" and (not isinstance(row["values"],list) or len(row["values"]) != len(FEATURE_NAMES)
                or not all(isinstance(x,str) and len(x)<=32 and math.isfinite(float(x)) for x in row["values"])):
            raise ValueError("ML_FEATURE_INVALID")
    return report
