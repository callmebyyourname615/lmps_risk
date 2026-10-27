from pathlib import Path
import json
import pytest
from lmps_ml.demo import synthetic_input
from lmps_ml.dataset import build_dataset,save_dataset
from lmps_ml.pipeline import from_bulk,verified_dataset,init_shadow,main
from lmps_ml.private import encoded,digest,read_json,write


def test_training_cli_rebuilds_private_dataset_proof_and_keys_are_repeatable(tmp_path,capsys):
    value=synthetic_input(90);save_dataset(value,tmp_path/'dataset')
    assert verified_dataset(tmp_path/'dataset')==build_dataset(value)
    first=init_shadow(tmp_path);assert init_shadow(tmp_path)==first
    assert set(read_json(tmp_path/'public.json'))=={'key_id','public_key'}
    dataset=read_json(tmp_path/'dataset/dataset.json');dataset['rows'][0]['values'][0]='99.000000000'
    dataset['dataset_sha256']=digest({k:v for k,v in dataset.items() if k!='dataset_sha256'})
    (tmp_path/'dataset/dataset.json').write_bytes(encoded(dataset))
    with pytest.raises(ValueError):verified_dataset(tmp_path/'dataset')
    assert main(['dataset','--input',str(tmp_path/'not-present'),'--output',str(tmp_path/'output')])==1
    assert 'ML_PIPELINE_FAILED' in capsys.readouterr().err


def test_file_adapter_never_promotes_source_accounts_times_or_unknown_labels(tmp_path):
    # A tiny invented prepared bundle exercises the actual bulk verifier and adapter.
    import sys
    root=Path(__file__).resolve().parents[3]
    sys.path.insert(0,str(root/'apps/risk-workers/scripts'))
    import dataset_bulk
    from hashlib import sha256
    prepared=tmp_path/'prepared';prepared.mkdir(mode=0o700)
    csv=b'amount\n9.00\n';lineage=b'{}\n';manifest=b'{}\n'
    for name,content in [('chunk-00000.csv',csv),('chunk-00000.jsonl',lineage),('source-manifest.jsonl',manifest)]:write(prepared/name,content)
    plan={'format':dataset_bulk.VERSION,'unique_rows':1,'source_manifest_sha256':sha256(manifest).hexdigest(),
          'chunks':[{'number':0,'csv':'chunk-00000.csv','lineage':'chunk-00000.jsonl','lineage_sha256':sha256(lineage).hexdigest(),
                     'input':{'dataset_sha256':sha256(csv).hexdigest(),'expected_rows':1}}]}
    write(prepared/'plan.json',encoded(plan))
    settings={k:synthetic_input(90)[k] for k in ('version','train_end','calibration_end','test_end','evaluation_at','embargo_seconds')}
    write(tmp_path/'config.json',encoded(settings));data=build_dataset(from_bulk(prepared,tmp_path/'config.json'))
    assert data['counts']['available']==0 and data['provenance']=='user_supplied_file'
    row=data['rows'][0];assert row['target'] is None and row['as_of'] is None and row['values'] is None
    assert all(label['outcome'] is None for label in row['labels'].values())
