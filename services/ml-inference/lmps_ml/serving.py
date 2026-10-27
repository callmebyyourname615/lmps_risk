"""No.45: safe pinned artifacts, actual MLflow registry, signed shadow-only inference."""
import base64
from hashlib import sha256
import importlib.metadata
import math
from pathlib import Path
import re
from typing import Literal

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
import numpy as np
import lightgbm as lgb
import skops.io as sio
from pydantic import Field,model_validator
from .dataset import FEATURE_NAMES,FEATURE_SHA,TASKS,VERSION,Strict,Target,stamp
from .private import digest,directory,encoded,mode,publish,read_bytes,read_json,write
from .training import tracker


class FeatureSnapshot(Strict):
    target: Target | None
    revision_sha256: str | None = Field(min_length=64,max_length=64,pattern=r"^[0-9a-f]{64}$")
    as_of: str | None
    currency: str | None = Field(pattern=r'^[A-Z]{3}$',max_length=3)
    feature_version: Literal['lmps-features-1']
    feature_spec_sha256: str = Field(min_length=64,max_length=64,pattern=r"^[0-9a-f]{64}$")
    status: Literal['available','unavailable']
    reason_code: str | None = Field(max_length=80)
    values: list[str] | None = Field(min_length=6,max_length=6)
    net_amount_cents: str | None = Field(pattern=r"^[0-9]{1,24}$")
    feature_sha256: str = Field(min_length=64,max_length=64,pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode='after')
    def validate_snapshot(self):
        if self.feature_spec_sha256!=FEATURE_SHA or digest(self.model_dump(exclude={'feature_sha256'}))!=self.feature_sha256:
            raise ValueError('ML_FEATURE_SIGNATURE_INVALID')
        if self.as_of is not None:stamp(self.as_of)
        if self.status=='available':
            if self.target is None or self.revision_sha256 is None or self.as_of is None or self.values is None or self.net_amount_cents is None or self.reason_code is not None:
                raise ValueError('ML_FEATURE_UNAVAILABLE')
            if not all(re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?',v) and len(v)<=32 and math.isfinite(float(v)) and abs(float(v))<1e8 for v in self.values):
                raise ValueError('ML_FEATURE_INVALID')
        elif self.values is not None or not self.reason_code:
            raise ValueError('ML_FEATURE_INVALID')
        return self


class ShadowRequest(Strict):
    format: Literal[1]
    execution_mode: Literal['shadow']
    provenance: Literal['local_synthetic','user_supplied_file']
    source_semantics: Literal['synthetic_declared','unverified']
    snapshot: FeatureSnapshot


def snapshot_from_row(row):
    return FeatureSnapshot.model_validate({k:v for k,v in row.items() if k not in {'row_id','labels','partition'}}).model_dump()


class LoadedBundle:
    def __init__(self,path,expected_sha,name,version):
        mode();self.path=directory(path)
        metadata_bytes=read_bytes(self.path/'metadata.json')
        if not re.fullmatch(r'[0-9a-f]{64}',expected_sha) or sha256(metadata_bytes).hexdigest()!=expected_sha:
            raise ValueError('ML_MODEL_HASH_MISMATCH')
        self.metadata=read_json(self.path/'metadata.json');m=self.metadata
        if (m['format']!='lmps-model-bundle-1' or m['scope']!='synthetic_shadow_only' or m['status']!='complete'
                or m['feature_version']!=VERSION or m['feature_spec_sha256']!=FEATURE_SHA or m['feature_names']!=FEATURE_NAMES
                or m['algorithm'] not in {'baseline','logistic','lightgbm'}
                or m['packages']!={key:importlib.metadata.version(key) for key in ('numpy','scikit-learn','lightgbm','skops')}
                or set(m['models'])!=({'novelty'} if m['algorithm']=='baseline' else set(TASKS))):
            raise ValueError('ML_MODEL_SIGNATURE_INVALID')
        self.models={}
        for task,info in m['models'].items():
            file=info['file']
            if not re.fullmatch(r'[a-z_]+\.(skops|txt)',file) or file not in m['files']:
                raise ValueError('ML_MODEL_PATH_INVALID')
            data=read_bytes(self.path/file)
            if sha256(data).hexdigest()!=m['files'][file]:raise ValueError('ML_MODEL_CHANGED')
            if file.endswith('.skops'):
                # The pinned sklearn IsolationForest owns this native tree state.
                # Never trust the artifact's arbitrary list of unknown Python types.
                reviewed={'sklearn.tree._tree.Tree'} if m['algorithm']=='baseline' else set()
                if not set(sio.get_untrusted_types(data=data))<=reviewed:raise ValueError('ML_UNTRUSTED_SERIALIZATION')
                model=sio.loads(data,trusted=sorted(reviewed))
            else:model=lgb.Booster(model_str=data.decode())
            if m['algorithm']!='baseline':
                if any(type(info[k]) not in {int,float} or not math.isfinite(info[k]) for k in ('calibration_coefficient','calibration_intercept')):
                    raise ValueError('ML_CALIBRATION_INVALID')
            self.models[task]=model
        if set(m['files'])!={entry['file'] for entry in m['models'].values()}:raise ValueError('ML_MODEL_FILES_INVALID')
        self.identity={'name':name,'version':str(version),'artifact_sha256':expected_sha,'algorithm':m['algorithm'],'dataset_sha256':m['dataset_sha256'],'currency':m['currency']}
        reference=m.get('monitoring')
        if reference is not None and (set(reference)!={'feature','cuts','counts','rows'} or reference['feature']!='log1p_net_amount'
                or len(reference['cuts'])!=9 or any(type(v) not in {float,int} or not math.isfinite(v) for v in reference['cuts'])
                or reference['cuts']!=sorted(reference['cuts']) or len(reference['counts'])!=10
                or any(type(v) is not int or v<0 for v in reference['counts']) or type(reference['rows']) is not int or reference['rows']<1 or sum(reference['counts'])!=reference['rows']):
            raise ValueError('ML_MONITORING_SIGNATURE_INVALID')
        self.predict(np.zeros((1,len(FEATURE_NAMES))))

    def predict(self,x):
        m=self.metadata
        if m['algorithm']=='baseline':return {},float(-self.models['novelty'].score_samples(x)[0])
        result={}
        for task,model in self.models.items():
            raw=float(model.decision_function(x)[0]) if m['algorithm']=='logistic' else float(model.predict(x,raw_score=True)[0])
            info=m['models'][task];z=raw*info['calibration_coefficient']+info['calibration_intercept']
            if not math.isfinite(raw) or not math.isfinite(z):raise ValueError('ML_PREDICTION_NONFINITE')
            z=max(-60,min(60,z))
            result[task]=f'{1/(1+math.exp(-z)):.9f}'
        return result,None


def register_model(root,name,bundle):
    mode();root=directory(root);bundle=directory(bundle)
    if not re.fullmatch(r'synthetic_[a-z0-9_]{1,60}',name) or not bundle.resolve().is_relative_to(root.resolve()):
        raise ValueError('ML_REGISTRY_SCOPE_INVALID')
    receipt=read_json(bundle/'receipt.json')
    LoadedBundle(bundle,receipt['metadata_sha256'],name,'pending')
    client,_=tracker(root/'tracking')
    try:client.get_registered_model(name)
    except Exception:client.create_registered_model(name)
    for prior in client.search_model_versions(f"name='{name}'"):
        if prior.tags.get('artifact_sha256')==receipt['metadata_sha256']:
            if prior.source!=bundle.as_uri():raise ValueError('ML_REGISTRY_CONFLICT')
            return {'name':name,'version':str(prior.version),'artifact_sha256':receipt['metadata_sha256'],'publication':'duplicate'}
    version=client.create_model_version(name,source=bundle.as_uri(),run_id=receipt['mlflow_run_id'],
        tags={'artifact_sha256':receipt['metadata_sha256'],'scope':'synthetic_shadow_only','feature_spec_sha256':FEATURE_SHA})
    return {'name':name,'version':str(version.version),'artifact_sha256':receipt['metadata_sha256'],'publication':'created'}


def resolve_model(root,name,version,expected_sha):
    root=directory(root);client,_=tracker(root/'tracking')
    if not re.fullmatch(r'synthetic_[a-z0-9_]{1,60}',name) or not re.fullmatch(r'[1-9][0-9]{0,8}',str(version)):
        raise ValueError('ML_VERSION_INVALID')
    record=client.get_model_version(name,str(version))
    from urllib.parse import urlparse,unquote
    uri=urlparse(record.source)
    if uri.scheme!='file' or uri.netloc or uri.query or uri.fragment or record.tags.get('artifact_sha256')!=expected_sha or record.tags.get('scope')!='synthetic_shadow_only':
        raise ValueError('ML_REGISTRY_SIGNATURE_INVALID')
    path=Path(unquote(uri.path))
    if not path.resolve().is_relative_to(root.resolve()):raise ValueError('ML_REGISTRY_SCOPE_INVALID')
    return LoadedBundle(path,expected_sha,name,str(version))


def deploy(root,reference,expected_generation):
    """Explicit local shadow activation/rollback; each generation is immutable and CAS guarded."""
    mode();root=directory(root)
    import fcntl,os
    lock=os.open(root/'deployment.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if set(reference)!={'name','version','artifact_sha256'}:raise ValueError('ML_DEPLOYMENT_INVALID')
        resolve_model(root,**{ 'name':reference['name'],'version':reference['version'],'expected_sha':reference['artifact_sha256']})
        pointer=root/'deployment.json'
        prior=read_json(pointer) if pointer.exists() else {'generation':0}
        if type(expected_generation) is not int or expected_generation<0:raise ValueError('ML_DEPLOYMENT_CONFLICT')
        if prior['generation']==expected_generation+1 and prior.get('model')==reference:
            history=read_json(root/'deployment-history'/(str(prior['generation'])+'.json'))
            if history!=prior:raise ValueError('ML_DEPLOYMENT_CONFLICT')
            client,_=tracker(root/'tracking');client.set_registered_model_alias(reference['name'],'shadow',reference['version'])
            return prior
        if prior['generation']!=expected_generation:raise ValueError('ML_DEPLOYMENT_CONFLICT')
        config={'format':'lmps-shadow-deployment-1','generation':expected_generation+1,'model':reference,'previous':prior.get('model'),
                'execution_mode':'shadow','enforcement':False}
        history=directory(root/'deployment-history',True)
        record=history/(str(config['generation'])+'.json')
        if record.exists():
            if read_json(record)!=config:raise ValueError('ML_DEPLOYMENT_CONFLICT')
        else:write(record,encoded(config))
        pending=root/('deployment-'+str(config['generation'])+'.pending')
        if pending.exists():
            if read_json(pending)!=config:raise ValueError('ML_DEPLOYMENT_CONFLICT')
        else:write(pending,encoded(config))
        os.replace(pending,pointer)
        fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
        client,_=tracker(root/'tracking');client.set_registered_model_alias(reference['name'],'shadow',reference['version'])
        return config
    finally:os.close(lock)


class ShadowServer:
    def __init__(self,root,token,signing_key):
        mode();self.token=token
        if not isinstance(token,str) or not re.fullmatch(r'[0-9a-f]{64}',token) or len(signing_key)!=32:
            raise ValueError('ML_AUTH_CONFIGURATION_INVALID')
        self.key=Ed25519PrivateKey.from_private_bytes(signing_key)
        self.public_key=self.key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw).hex()
        self.key_id='ml_'+sha256(bytes.fromhex(self.public_key)).hexdigest()[:16]
        self.model=None;self.reason='MODEL_NOT_LOADED'
        try:
            config=read_json(directory(root)/'deployment.json')
            if config['format']!='lmps-shadow-deployment-1' or config['execution_mode']!='shadow' or config['enforcement'] is not False:
                raise ValueError()
            ref=config['model'];self.model=resolve_model(root,ref['name'],ref['version'],ref['artifact_sha256']);self.reason=None
        except Exception:self.reason='MODEL_INVALID_OR_UNAVAILABLE'
        from .monitoring import ShadowMetrics
        self.metrics=ShadowMetrics(None if self.model is None else self.model.metadata.get('monitoring'))

    def score(self,value):
        import time
        started=time.perf_counter();result=self._score(value)
        self.metrics.completion(result,value,(time.perf_counter()-started)*1000);return result

    def _score(self,value):
        mode();request=ShadowRequest.model_validate(value);snapshot=request.snapshot
        reason=None
        if request.provenance!='local_synthetic' or request.source_semantics!='synthetic_declared':reason='SOURCE_SEMANTICS_UNVERIFIED'
        elif self.model is None:reason='MODEL_UNAVAILABLE'
        elif snapshot.status!='available':reason='FEATURE_UNAVAILABLE'
        elif snapshot.currency!=self.model.metadata['currency']:reason='CURRENCY_OUT_OF_SCOPE'
        elif stamp(snapshot.as_of)<stamp(self.model.metadata['trained_through']):reason='MODEL_TRAINING_CUTOFF_AFTER_AS_OF'
        probabilities={};novelty=None
        if reason is None:probabilities,novelty=self.model.predict(np.asarray([snapshot.values],dtype=float))
        core={'format':'lmps-shadow-result-1','execution_mode':'shadow','provenance':request.provenance,'source_semantics':'unverified',
              'status':'unavailable' if reason else 'available','reason_code':reason or 'MODEL_SCORED',
              'scope':'synthetic_shadow_only','target':None if snapshot.target is None else snapshot.target.model_dump(),
              'revision_sha256':snapshot.revision_sha256,'as_of':snapshot.as_of,'feature_sha256':snapshot.feature_sha256,
              'model':None if self.model is None else self.model.identity,'probabilities':probabilities,
              'novelty_score':None if novelty is None else format(novelty,'.12g'),
              'historical_model_availability':'retrospective_experiment','enforcement':False,'canonical_emission':False,'key_id':self.key_id}
        from .model_contracts import ShadowResult
        result={**core,'signature':base64.b64encode(self.key.sign(encoded(core))).decode()}
        ShadowResult.model_validate(result)
        return result
