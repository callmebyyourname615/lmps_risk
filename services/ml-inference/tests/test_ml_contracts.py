import json
from pathlib import Path
from copy import deepcopy
import pytest
from lmps_ml.dataset import build_dataset,FEATURE_SPEC,FEATURE_SHA,TASKS
from lmps_ml.export_ml_contracts import schemas,DIRECTORY
from lmps_ml.serving import snapshot_from_row
from lmps_ml.private import digest


def test_schema_and_feature_definition_drift_and_exact_cross_runtime_fingerprints():
    for name,schema in schemas().items():assert json.loads((DIRECTORY/(name+'.schema.json')).read_text())==schema
    assert json.loads((DIRECTORY/'ml-feature-spec.json').read_text())==FEATURE_SPEC
    fixture=json.loads((DIRECTORY.parent/'fixtures/ml-feature-parity.json').read_text())
    context=fixture['request']['context']
    unknown={'outcome':None,'review_status':'unreviewed','source_status':'unverified','mature_at':None,'available_at':None,'reviewed_at':None,'reviewer_ref':None,'evidence_sha256':None}
    value={'format':1,'version':'ml_dataset_parity','execution_mode':'offline_analysis','provenance':'local_synthetic','source_semantics':'synthetic_declared','identity_status':'synthetic_declared',
           'source_sha256':'0'*64,'coverage_start':context['coverage_start'],'history_complete':True,'label_sampling':'synthetic_population',
           'train_end':'2026-01-01T13:00:00.000Z','calibration_end':'2026-01-01T15:00:00.000Z','test_end':'2026-01-01T17:00:00.000Z','evaluation_at':'2026-01-01T18:00:00.000Z','embargo_seconds':3600,
           'rows':[{'row_id':'row_'+str(i),'target':{k:event[k] for k in ('namespace','transaction_id','revision_number')},'revision_sha256':fixture['observation']['revision_sha256'],
                    'as_of':event['occurred_at'],**{k:event[k] for k in ('occurred_at','available_at','sender','receiver','currency','amount','reversed_amount','status')},
                    'labels':{task:unknown for task in TASKS}} for i,event in enumerate(context['events'])]}
    row=next(row for row in build_dataset(value)['rows'] if row['target']==fixture['request']['target'])
    expected=fixture['expected']['snapshot'];expected['feature_spec_sha256']=FEATURE_SHA;expected['feature_sha256']=digest(expected)
    assert snapshot_from_row(row)==expected


def test_models_cannot_pool_currencies_as_if_no_fx_were_needed(tmp_path):
    from lmps_ml.demo import synthetic_input
    from lmps_ml.training import train
    value=synthetic_input();value['rows'][1]['currency']='LAK'
    with pytest.raises(ValueError,match='ML_ONE_CURRENCY'):train(build_dataset(value),tmp_path/'model',tmp_path/'tracking','baseline')
