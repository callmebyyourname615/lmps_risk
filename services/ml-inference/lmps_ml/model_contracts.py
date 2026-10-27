import base64
from typing import Literal
from pydantic import Field,model_validator
from .dataset import Strict,Target,TASKS,stamp


class ModelIdentity(Strict):
    name: str = Field(pattern=r'^synthetic_[a-z0-9_]{1,60}$',max_length=70)
    version: str = Field(pattern=r'^[1-9][0-9]{0,8}$',max_length=9)
    artifact_sha256: str = Field(pattern=r'^[0-9a-f]{64}$',min_length=64,max_length=64)
    algorithm: Literal['baseline','logistic','lightgbm']
    currency: str = Field(pattern=r'^[A-Z]{3}$',max_length=3)
    dataset_sha256: str = Field(pattern=r'^[0-9a-f]{64}$',min_length=64,max_length=64)


class ShadowResult(Strict):
    format: Literal['lmps-shadow-result-1']
    execution_mode: Literal['shadow']
    provenance: Literal['local_synthetic','user_supplied_file']
    source_semantics: Literal['unverified']
    status: Literal['available','unavailable']
    reason_code: Literal['MODEL_SCORED','SOURCE_SEMANTICS_UNVERIFIED','MODEL_UNAVAILABLE','FEATURE_UNAVAILABLE','MODEL_TRAINING_CUTOFF_AFTER_AS_OF','CURRENCY_OUT_OF_SCOPE']
    scope: Literal['synthetic_shadow_only']
    target: Target | None
    revision_sha256: str | None = Field(pattern=r'^[0-9a-f]{64}$',min_length=64,max_length=64)
    as_of: str | None = Field(max_length=24)
    feature_sha256: str = Field(pattern=r'^[0-9a-f]{64}$',min_length=64,max_length=64)
    model: ModelIdentity | None
    probabilities: dict[str,str]
    novelty_score: str | None = Field(max_length=32)
    historical_model_availability: Literal['retrospective_experiment']
    enforcement: Literal[False]
    canonical_emission: Literal[False]
    key_id: str = Field(pattern=r'^ml_[0-9a-f]{16}$',max_length=19)
    signature: str = Field(pattern=r'^[A-Za-z0-9+/]{86}==$' ,min_length=88,max_length=88)

    @model_validator(mode='after')
    def validate_result(self):
        if self.as_of is not None:stamp(self.as_of)
        if len(base64.b64decode(self.signature,validate=True))!=64:raise ValueError('ML_SIGNATURE_INVALID')
        if self.status=='unavailable':
            if self.probabilities or self.novelty_score is not None or self.reason_code=='MODEL_SCORED':raise ValueError('ML_UNAVAILABLE_INVALID')
        else:
            if self.reason_code!='MODEL_SCORED' or self.model is None or self.provenance!='local_synthetic' or self.target is None or self.revision_sha256 is None or self.as_of is None:
                raise ValueError('ML_RESULT_INVALID')
            if self.model.algorithm=='baseline':
                if self.probabilities or self.novelty_score is None:raise ValueError('ML_NOVELTY_INVALID')
                import math
                if not math.isfinite(float(self.novelty_score)) or float(self.novelty_score)<0:raise ValueError('ML_NOVELTY_INVALID')
            else:
                import re
                if set(self.probabilities)!=set(TASKS) or self.novelty_score is not None or not all(re.fullmatch(r'(0\.[0-9]{9}|1\.000000000)',v) for v in self.probabilities.values()):raise ValueError('ML_PROBABILITIES_INVALID')
        return self
