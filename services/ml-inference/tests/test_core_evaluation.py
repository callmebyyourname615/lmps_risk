from copy import deepcopy
import pytest
from lmps_ml.core_evaluation import evaluate_core_cohort
from lmps_ml.dataset import build_dataset
from lmps_ml.demo import synthetic_input
from lmps_ml.private import digest
from lmps_ml.training import train
from lmps_ml.serving import register_model,snapshot_from_row


def cohort(dataset):
    rows=[]
    for index,row in enumerate(r for r in dataset['rows'] if r['partition']=='test' and r['status']=='available'):
        if index==4:break
        rows.append({'row_id':f'synthetic_row_{index}','request':{'format':1,'execution_mode':'shadow','provenance':'local_synthetic','source_semantics':'synthetic_declared','snapshot':snapshot_from_row(row)},
                     'rules':{'fraud':'0.500000','mule_network':None,'aml':'0.250000'},'alert_id':None})
    body={'format':'lmps-core-shadow-cohort-1','source_semantics':'unverified','runtime_sha256':'a'*64,'rows':rows}
    return seal(body)


def seal(value):
    value['cohort_sha256']=digest({k:v for k,v in value.items() if k!='cohort_sha256'})
    return value


def test_actual_pinned_logistic_and_anomaly_models_use_same_frozen_core_cohort_without_inventing_labels(tmp_path):
    data=build_dataset(synthetic_input());refs=[]
    for algorithm in ('baseline','logistic'):
        train(data,tmp_path/algorithm,tmp_path/'tracking',algorithm)
        ref=register_model(tmp_path,'synthetic_core_'+algorithm,tmp_path/algorithm)
        refs.append({k:ref[k] for k in ('name','version','artifact_sha256')})
    value=cohort(data);report=evaluate_core_cohort(value,tmp_path,refs)
    assert report['cohort_sha256']==value['cohort_sha256']
    assert report['training_performed'] is False and report['activation_performed'] is False
    assert len(report['models'])==2 and all(len(r['models'])==2 for r in report['rows'])
    assert report['tasks']['fraud']['comparison_status']=='available'
    coverage=report['tasks']['fraud']['coverage']
    assert coverage['total_rows']==coverage['rule_rows']==len(value['rows'])
    assert list(coverage['anomaly_rows'].values())==[len(value['rows'])]
    assert list(coverage['classifier_rows'].values())==[len(value['rows'])]
    anomaly_only=evaluate_core_cohort(value,tmp_path,refs[:1])
    classifier_only=evaluate_core_cohort(value,tmp_path,refs[1:])
    assert anomaly_only['tasks']['fraud']['reason']=='CLASSIFIER_MODEL_NOT_CONFIGURED'
    assert classifier_only['tasks']['fraud']['reason']=='ANOMALY_MODEL_NOT_CONFIGURED'
    assert anomaly_only['tasks']['fraud']['comparison_status']=='unavailable'
    assert classifier_only['tasks']['fraud']['comparison_status']=='unavailable'
    assert report['tasks']['fraud']['common_rows']==len(value['rows'])
    assert report['tasks']['fraud']['common_cohort_sha256']==report['tasks']['aml']['common_cohort_sha256']
    assert report['tasks']['mule_network']['comparison_status']=='unavailable'
    assert all(t['precision'] is None and t['recall'] is None for t in report['tasks'].values())
    assert all(m['status']=='available' for r in report['rows'] for m in r['models'].values())
    future=deepcopy(value);future['rows'][0]['request']['snapshot']['as_of']='2025-01-01T00:00:00Z'
    snap=future['rows'][0]['request']['snapshot'];snap['feature_sha256']=digest({k:v for k,v in snap.items() if k!='feature_sha256'})
    result=evaluate_core_cohort(seal(future),tmp_path,refs)
    assert all(m['reason']=='MODEL_TRAINING_CUTOFF_AFTER_AS_OF' for m in result['rows'][0]['models'].values())
    assert all(n==len(value['rows'])-1 for n in result['tasks']['fraud']['coverage']['anomaly_rows'].values())
    assert all(n==len(value['rows'])-1 for n in result['tasks']['fraud']['coverage']['classifier_rows'].values())
    assert result['tasks']['fraud']['common_rows']==len(value['rows'])-1


def test_missing_models_real_provenance_and_unavailable_scores_do_not_become_comparative_accuracy():
    value=cohort(build_dataset(synthetic_input()))
    report=evaluate_core_cohort(value)
    assert all(t['reason']=='MODEL_REFERENCE_NOT_CONFIGURED' and t['precision'] is None for t in report['tasks'].values())
    value['rows'][0]['request']['provenance']='user_supplied_file';value['rows'][0]['request']['source_semantics']='unverified'
    result=evaluate_core_cohort(seal(value));assert result['rows'][0]['feature_status']=='unavailable'


def test_tampered_features_duplicate_rows_invalid_scores_and_cohort_hashes_fail_closed():
    valid=cohort(build_dataset(synthetic_input()))
    for change in (lambda v:v['rows'].append(v['rows'][0]),lambda v:v['rows'][0]['rules'].update(fraud='NaN'),
                   lambda v:v['rows'][0]['rules'].update(fraud=0.5),lambda v:v['rows'][0]['request']['snapshot'].update(feature_sha256='f'*64)):
        value=deepcopy(valid);change(value)
        with pytest.raises(ValueError):evaluate_core_cohort(seal(value))
    with pytest.raises(ValueError):evaluate_core_cohort({**valid,'cohort_sha256':'f'*64})
    with pytest.raises(ValueError):evaluate_core_cohort(valid,None,[{'name':'synthetic_model','version':'1','artifact_sha256':'a'*64}])
