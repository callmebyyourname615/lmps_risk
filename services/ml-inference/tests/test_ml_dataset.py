from copy import deepcopy
from datetime import timedelta
import math
import pytest
from ml_fixtures import synthetic_input
from lmps_ml.dataset import build_dataset,save_dataset,stamp,validate_dataset
from lmps_ml.private import read_json


def test_dataset_is_deterministic_order_independent_and_private(tmp_path):
    request=synthetic_input(90);first=build_dataset(request);second=build_dataset({**request,'rows':list(reversed(request['rows']))})
    assert first==second
    assert first['counts']['available']==90
    assert save_dataset(request,tmp_path/'dataset')['status']=='created'
    assert save_dataset(request,tmp_path/'dataset')['status']=='duplicate'
    assert read_json(tmp_path/'dataset/dataset.json')==first
    assert all(v is not None for row in first['rows'] for v in row['values'])
    assert 'sender' not in first['rows'][0] and 'receiver' not in first['rows'][0]


def test_future_event_and_late_correction_never_change_past_features():
    request=synthetic_input(90);before=build_dataset(request)['rows'][12]
    future=deepcopy(request['rows'][0]);future.update(row_id='zz_future',target={**future['target'],'revision_number':2},
        reversed_amount=future['amount'],status='reversed',available_at=request['rows'][-1]['as_of'])
    request['rows'].append(future)
    after=build_dataset(request)['rows'][12]
    assert before['feature_sha256']==after['feature_sha256']
    assert before['values']==after['values']


def test_latest_known_reversal_replaces_original_contribution_once():
    request=synthetic_input(90)
    original=request['rows'][0];correction=deepcopy(original)
    correction.update(row_id='zz_reversal',target={**original['target'],'revision_number':2},status='reversed',
                      reversed_amount=original['amount'],available_at=request['rows'][5]['as_of'])
    request['rows'].append(correction)
    first=build_dataset(synthetic_input(90))['rows'][10]['values'];changed=build_dataset(request)['rows'][10]['values']
    assert float(changed[3])==float(first[3])-1


def test_purge_unknown_provenance_and_labels_do_not_leak_into_features():
    request=synthetic_input(90);first=build_dataset(request)
    assert first['counts']['purged']>0
    changed=deepcopy(request)
    for row in changed['rows']:
        for label in row['labels'].values():label['outcome']=None
    second=build_dataset(changed)
    assert [r['feature_sha256'] for r in first['rows']]==[r['feature_sha256'] for r in second['rows']]
    request['source_semantics']='unverified'
    unknown=build_dataset(request)
    assert unknown['counts']['available']==0
    assert all(r['values'] is None and r['reason_code']=='SOURCE_SEMANTICS_UNVERIFIED' for r in unknown['rows'])


def test_actual_identity_cannot_be_promoted_and_conflicting_revisions_fail():
    request=synthetic_input(90);request['provenance']='user_supplied_file'
    with pytest.raises(ValueError):build_dataset(request)
    request=synthetic_input(90);other=deepcopy(request['rows'][0]);other['row_id']='conflict';other['amount']='1.00';request['rows'].append(other)
    with pytest.raises(ValueError):build_dataset(request)


def test_integrity_nonfinite_limits_and_runtime_modes_fail_closed(monkeypatch):
    request=synthetic_input(90);report=build_dataset(request);report['rows'][0]['values'][0]='nan'
    with pytest.raises(ValueError):validate_dataset(report)
    request['script']='PRIVATE'
    with pytest.raises(ValueError):build_dataset(request)
    monkeypatch.setenv('LMPS_ENVIRONMENT','production')
    with pytest.raises(ValueError):build_dataset(synthetic_input(90))


def test_repeated_business_payment_is_purged_across_temporal_partitions():
    value=synthetic_input(90);copy=deepcopy(value['rows'][0]);copy.update(row_id='zz_repeat',as_of=value['rows'][80]['as_of'])
    value['rows'].append(copy);report=build_dataset(value)
    assert all(r['partition']=='purged' for r in report['rows'] if r['target']==copy['target'])
    copy['as_of']=value['rows'][0]['as_of'];same=build_dataset(value)
    assert all(r['partition']=='purged' for r in same['rows'] if r['target']==copy['target'])


def test_a_superseded_target_and_inconsistent_reversal_are_unavailable():
    value=synthetic_input(90);copy=deepcopy(value['rows'][0]);copy.update(row_id='zz_newer',target={**copy['target'],'revision_number':2})
    value['rows'].append(copy);report=build_dataset(value)
    assert report['rows'][0]['status']=='unavailable' and report['rows'][0]['reason_code']=='TARGET_REVISION_SUPERSEDED'
    value=synthetic_input(90);value['rows'][0]['reversed_amount']='1.00'
    assert build_dataset(value)['rows'][0]['status']=='unavailable'
