from copy import deepcopy
import numpy as np
import pytest
from lmps_ml.dataset import build_dataset
from lmps_ml.demo import synthetic_input
from lmps_ml.training import train
from lmps_ml.serving import register_model
from lmps_ml.evaluation import evaluate,capacity_threshold,operating_metrics
from lmps_ml.feedback import attach
from lmps_ml.private import digest


def test_capacity_threshold_respects_ties_and_rank_scores_are_not_calibrated_probabilities():
    scores=[0.1]*5+[0.9]*5;threshold=capacity_threshold(scores,100);assert sum(s>=threshold for s in scores)<=1
    result=operating_metrics([0,0,1,1],[-3,2,1,9],2);assert result['brier'] is None
    assert result['precision_wilson95'] is not None
    with pytest.raises(ValueError):operating_metrics([0,0],[1,2],1)


def test_real_fitting_frozen_cohort_comparison_and_validation_only_selection(tmp_path):
    source=synthetic_input();data=build_dataset(source);refs=[]
    for algorithm in ('baseline','logistic','lightgbm'):
        train(data,tmp_path/algorithm,tmp_path/'tracking',algorithm);ref=register_model(tmp_path,'synthetic_'+algorithm,tmp_path/algorithm)
        refs.append({k:ref[k] for k in ('name','version','artifact_sha256')})
    result=evaluate(data,tmp_path,refs,tmp_path/'evaluation',300,source_input=source);assert result['status']=='complete'
    assert result['rule_engine']['policy_sha256'] is not None
    assert result['tasks']['fraud']['comparisons']['rules_engine']['status']=='available'
    for task in result['tasks'].values():
        assert task['selection_uses_test'] is False
        methods=[m for m in task['comparisons'].values() if m['status']=='available']
        assert len(methods)>=5 and len({m['test_cohort_sha256'] for m in methods})==1
        for m in methods:
            if m['threshold_source']!='fixed_reference_rule':assert m['calibration_capacity_met'] is True
    assert evaluate(data,tmp_path,refs,tmp_path/'evaluation',300,source_input=source)['publication']=='duplicate'
    with pytest.raises(ValueError):evaluate(data,tmp_path,refs,tmp_path/'evaluation',50)


def test_missing_ground_truth_produces_unavailable_evaluation_not_fake_negatives(tmp_path):
    value=synthetic_input()
    for row in value['rows']:
        for label in row['labels'].values():label['outcome']=None
    result=evaluate(build_dataset(value),tmp_path,[],tmp_path/'none')
    assert result['status']=='unavailable' and all(t['status']=='unavailable' for t in result['tasks'].values())


def test_feedback_is_task_target_bound_preserves_features_and_rejects_ambiguous_or_unverified_promotion():
    data=build_dataset(synthetic_input(90));row=data['rows'][0]
    record={'label_id':'synthetic_fixture','version':1,'target':row['target'],'task':'fraud','eligibility':'unavailable','reason_code':'LABEL_UNKNOWN',
            'label':{**row['labels']['fraud'],'outcome':None,'review_status':'unreviewed'}}
    record['sha256']=digest(record)
    artifact={'format':'lmps-label-export-1','provenance':'local_synthetic','exported_at':'2026-10-25T00:00:00.000Z','population_claims':False,'records':[record]}
    attached=attach(data,artifact);assert attached['rows'][0]['labels']['fraud']['outcome'] is None
    assert [r['feature_sha256'] for r in attached['rows']]==[r['feature_sha256'] for r in data['rows']]
    artifact['records'].append(record)
    with pytest.raises(ValueError):attach(data,artifact)
    artifact['records']=[record];actual={**data,'provenance':'user_supplied_file'}
    with pytest.raises(ValueError):attach(actual,artifact)
