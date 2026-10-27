from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import pytest
from lmps_ml.demo import synthetic_input
from lmps_ml.dataset import build_dataset
from lmps_ml.private import encoded,read_json,write
from lmps_ml.replay import replay,cohort
from lmps_ml.pipeline import verified_dataset


def source(root,value):
    path=root/'events.jsonl';data=b''.join(encoded(row)+b'\n' for row in value['rows']);write(path,data)
    settings={k:v for k,v in value.items() if k!='rows'};settings['source_sha256']=sha256(data).hexdigest()
    return path,settings


def output(root):
    manifest=read_json(root/'complete/manifest.json')
    return [json.loads(line) for chunk in manifest['chunks'] for line in (root/f"chunk-{chunk['number']:05d}"/'features.jsonl').read_bytes().splitlines()]


def test_checkpoint_resume_and_exact_reference_parity_with_late_reversal(tmp_path):
    value=synthetic_input();late=deepcopy(value['rows'][0]);late.update(row_id='zz_late',target={**late['target'],'revision_number':2},status='reversed',
        reversed_amount=late['amount'],available_at=value['rows'][12]['as_of']);value['rows'].append(late)
    path,settings=source(tmp_path,value);root=tmp_path/'replay'
    assert replay(path,settings,root,stop_after=123)['status']=='checkpointed'
    assert replay(path,settings,root)['status']=='complete'
    assert output(root)==build_dataset({**settings,'rows':value['rows']})['rows']
    assert replay(path,settings,root)['processed_rows']==481
    selected=cohort(root,tmp_path/'cohort',300);assert selected['counts']['rows']==300
    assert verified_dataset(tmp_path/'cohort')==selected


def test_replay_conflicting_source_config_revision_and_corrupt_output_fail_closed(tmp_path):
    value=synthetic_input(90);path,settings=source(tmp_path,value);root=tmp_path/'replay';replay(path,settings,root,stop_after=10)
    with pytest.raises(ValueError):replay(path,{**settings,'version':'ml_dataset_changed'},root)
    db=sqlite3.connect(root/'state.sqlite');db.execute("UPDATE features SET payload='{}'");db.commit();db.close()
    with pytest.raises(ValueError):replay(path,settings,root)
    conflict=deepcopy(value['rows'][0]);conflict.update(row_id='conflict',amount='1.00');value['rows'].append(conflict)
    other=tmp_path/'second';other.mkdir(mode=0o700);path,settings=source(other,value)
    with pytest.raises(ValueError):replay(path,settings,other/'replay')


def test_actual_unverified_rows_cannot_gain_identity_or_temporal_features(tmp_path):
    value=synthetic_input(30);value.update(provenance='user_supplied_file',source_semantics='unverified',identity_status='unverified')
    for row in value['rows']:row.update(target=None,sender=None,receiver=None)
    path,settings=source(tmp_path,value);root=tmp_path/'replay';replay(path,settings,root)
    assert all(row['status']=='unavailable' and row['values'] is None for row in output(root))
