import base64
from copy import deepcopy
import os
import secrets
import time
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi.testclient import TestClient
from ml_fixtures import synthetic_input
from lmps_ml.app import create_app
from lmps_ml.dataset import build_dataset
from lmps_ml.private import digest,encoded,read_json
from lmps_ml.training import train
from lmps_ml.serving import FeatureSnapshot,ShadowServer,deploy,register_model,snapshot_from_row


@pytest.fixture(scope='module')
def trained(tmp_path_factory):
    root=tmp_path_factory.mktemp('lmps-serving');data=build_dataset(synthetic_input())
    train(data,root/'logistic',root/'tracking','logistic')
    train(data,root/'lightgbm',root/'tracking','lightgbm')
    first=register_model(root,'synthetic_model',root/'logistic');second=register_model(root,'synthetic_model',root/'lightgbm')
    return root,data,{k:first[k] for k in ('name','version','artifact_sha256')},{k:second[k] for k in ('name','version','artifact_sha256')}


def request(data):
    row=next(row for row in data['rows'] if row['partition']=='test')
    return {'format':1,'execution_mode':'shadow','provenance':'local_synthetic','source_semantics':'synthetic_declared','snapshot':snapshot_from_row(row)}


def test_registry_pin_activation_rollback_and_signed_inference(trained):
    root,data,first,second=trained;token=secrets.token_hex(32);key=os.urandom(32)
    deploy(root,first,0);old=ShadowServer(root,token,key);before=old.score(request(data))
    assert before['status']=='available' and set(before['probabilities'])=={'fraud','mule_network','aml'}
    body={k:v for k,v in before.items() if k!='signature'}
    Ed25519PublicKey.from_public_bytes(bytes.fromhex(old.public_key)).verify(base64.b64decode(before['signature']),encoded(body))
    deploy(root,second,1);new=ShadowServer(root,token,key);assert new.model.identity['version']==second['version']
    assert old.score(request(data))==before
    deploy(root,first,2);rolled=ShadowServer(root,token,key);assert rolled.score(request(data))==before
    assert deploy(root,first,2)['generation']==3
    with pytest.raises(ValueError):deploy(root,second,1)
    assert register_model(root,'synthetic_model',root/'logistic')['publication']=='duplicate'


def test_fastapi_auth_validation_available_and_unavailable_are_explicit(trained):
    root,data,first,_=trained;server=ShadowServer(root,secrets.token_hex(32),os.urandom(32));payload=request(data)
    with TestClient(create_app({},shadow_server=server)) as client:
        assert client.get('/health/ready').status_code==200
        spec=client.get('/openapi.json').json();assert spec['components']['schemas']['ShadowRequest']['additionalProperties'] is False
        assert '200' in spec['paths']['/health/ready']['get']['responses']
        assert spec['paths']['/v1/shadow/score']['post']['security']==[{'LocalBearer':[]}]
        fractional={**payload['snapshot'],'as_of':payload['snapshot']['as_of'].replace('Z','.1Z')}
        fractional['feature_sha256']=digest({k:v for k,v in fractional.items() if k!='feature_sha256'})
        assert FeatureSnapshot.model_validate(fractional).as_of.endswith('.1Z')
        assert client.post('/v1/shadow/score',json=payload).status_code==401
        headers={'Authorization':'Bearer '+server.token}
        response=client.post('/v1/shadow/score',json=payload,headers=headers)
        assert response.status_code==200 and response.json()['enforcement'] is False
        assert response.headers['cache-control']=='no-store'
        bad={**payload,'account':'PRIVATE_CANARY'};response=client.post('/v1/shadow/score',json=bad,headers=headers)
        assert response.status_code==400 and 'PRIVATE_CANARY' not in response.text
        assert client.post('/v1/shadow/score',content=b'x'*16385,headers=headers).status_code==413
        unknown={**payload,'source_semantics':'unverified'}
        result=client.post('/v1/shadow/score',json=unknown,headers=headers)
        assert result.status_code==503 and result.json()['probabilities']=={} and result.json()['status']=='unavailable'


def test_invalid_artifact_signature_readiness_and_snapshot_tamper_fail_closed(trained,tmp_path):
    root,data,first,_=trained
    snapshot=request(data)['snapshot'];snapshot['values'][0]='123'
    with pytest.raises(ValueError):FeatureSnapshot.model_validate(snapshot)
    empty=ShadowServer(tmp_path,secrets.token_hex(32),os.urandom(32))
    assert empty.model is None
    with TestClient(create_app({},shadow_server=empty)) as client:
        assert client.get('/health/ready').status_code==503
    from lmps_ml.serving import LoadedBundle
    with pytest.raises(ValueError):LoadedBundle(root/'logistic','0'*64,first['name'],first['version'])
    loaded=LoadedBundle(root/'logistic',first['artifact_sha256'],first['name'],first['version'])
    loaded.models['fraud'].steps[-1][1].coef_[0,0]=float('nan')
    import numpy as np
    with pytest.raises(ValueError,match='ML_PREDICTION_NONFINITE'):loaded.predict(np.zeros((1,6)))


def test_inference_timeout_is_not_a_zero_score_and_queue_is_bounded(trained,monkeypatch):
    import threading
    root,data,_,_=trained;server=ShadowServer(root,secrets.token_hex(32),os.urandom(32));real=server.score
    release=threading.Event()
    def slow(value):release.wait(5);return real(value)
    monkeypatch.setattr(server,'score',slow)
    with TestClient(create_app({},shadow_server=server,shadow_timeout=0.001)) as client:
        try:
            for _ in range(2):
                response=client.post('/v1/shadow/score',json=request(data),headers={'Authorization':'Bearer '+server.token})
                assert response.status_code==503 and response.json()=={'code':'ML_TIMEOUT'}
            busy=client.post('/v1/shadow/score',json=request(data),headers={'Authorization':'Bearer '+server.token})
            assert busy.status_code==503 and busy.json()=={'code':'ML_BUSY'}
        finally:release.set()


def test_currency_and_training_cutoff_are_explicit_unavailable_not_zero(trained):
    from lmps_ml.private import digest
    root,data,_,_=trained;server=ShadowServer(root,secrets.token_hex(32),os.urandom(32))
    for changes,reason in [({'currency':'LAK'},'CURRENCY_OUT_OF_SCOPE'),({'as_of':'2020-01-01T00:00:00Z'},'MODEL_TRAINING_CUTOFF_AFTER_AS_OF')]:
        value=request(data);value['snapshot'].update(changes);snapshot=value['snapshot']
        snapshot['feature_sha256']=digest({k:v for k,v in snapshot.items() if k!='feature_sha256'})
        result=server.score(value);assert result['status']=='unavailable' and result['probabilities']=={} and result['reason_code']==reason


def test_isolation_artifact_safely_serves_novelty_without_inventing_probabilities(tmp_path,monkeypatch):
    data=build_dataset(synthetic_input());train(data,tmp_path/'baseline',tmp_path/'tracking','baseline')
    ref=register_model(tmp_path,'synthetic_novelty',tmp_path/'baseline');ref={k:ref[k] for k in ('name','version','artifact_sha256')}
    deploy(tmp_path,ref,0);server=ShadowServer(tmp_path,secrets.token_hex(32),os.urandom(32));result=server.score(request(data))
    assert result['status']=='available' and result['probabilities']=={} and float(result['novelty_score'])>0
    import skops.io as sio
    from lmps_ml.serving import LoadedBundle
    monkeypatch.setattr(sio,'get_untrusted_types',lambda **_:['os.system'])
    with pytest.raises(ValueError,match='ML_UNTRUSTED_SERIALIZATION'):LoadedBundle(tmp_path/'baseline',ref['artifact_sha256'],ref['name'],ref['version'])
