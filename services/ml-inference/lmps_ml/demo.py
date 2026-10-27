"""Invented labels/entities only: fixture metrics are not LMPS performance evidence."""
from datetime import datetime,timedelta,timezone
from hashlib import sha256


def synthetic_input(count=480):
    start=datetime(2025,12,1,tzinfo=timezone.utc)
    iso=lambda value:value.strftime('%Y-%m-%dT%H:%M:%SZ')
    rows=[]
    for i in range(count):
        time=start+timedelta(minutes=i*5);amount=100+(i*37)%7000
        outcomes={'fraud':int(amount>3500),'mule_network':int(i%13<5),'aml':int((i*7)%19<8)}
        rows.append({'row_id':f'row_{i:05d}','target':{'namespace':'synthetic_ml','transaction_id':f'tx_{i:05d}','revision_number':1},
            'revision_sha256':sha256(f'invented-{i}'.encode()).hexdigest(),'as_of':iso(time),'occurred_at':iso(time),'available_at':iso(time),
            'sender':f'synthetic_sender_{i%5}','receiver':f'synthetic_receiver_{i%11}','currency':'SYN','amount':f'{amount}.00','reversed_amount':'0.00','status':'succeeded',
            'labels':{task:{'outcome':value,'review_status':'adjudicated','source_status':'synthetic_declared',
                           'reviewed_at':iso(time+timedelta(seconds=30)),'available_at':iso(time+timedelta(seconds=60)),
                           'mature_at':iso(time+timedelta(seconds=60)),'reviewer_ref':'synthetic_fixture_adjudicator',
                           'evidence_sha256':sha256(f'invented-label-{task}-{i}'.encode()).hexdigest()} for task,value in outcomes.items()}})
    return {'format':1,'version':'ml_dataset_invented_v1','execution_mode':'offline_analysis','provenance':'local_synthetic',
            'source_semantics':'synthetic_declared','identity_status':'synthetic_declared','source_sha256':sha256(f'invented-{count}'.encode()).hexdigest(),
            'coverage_start':iso(start-timedelta(hours=1)),'history_complete':True,'label_sampling':'synthetic_population',
            'train_end':iso(start+timedelta(minutes=count*5*2//5)),'calibration_end':iso(start+timedelta(minutes=count*5*7//10)),
            'test_end':iso(start+timedelta(minutes=count*5)),'evaluation_at':iso(start+timedelta(minutes=count*5+60)),
            'embargo_seconds':3600,'rows':rows}


def main(argv=None):
    import argparse
    import json
    from pathlib import Path
    from .dataset import save_dataset,build_dataset
    from .private import directory,encoded,read_json,write
    from .training import train
    from .serving import register_model,deploy
    from .pipeline import init_shadow
    parser=argparse.ArgumentParser(description='Invented CPU ML acceptance demo, never LMPS quality evidence.')
    parser.add_argument('--root',required=True,type=Path)
    args=parser.parse_args(argv);root=directory(args.root)
    value=synthetic_input();data=build_dataset(value);save_dataset(value,root/'dataset')
    reports={algorithm:train(data,root/algorithm,root/'tracking',algorithm) for algorithm in ('baseline','logistic','lightgbm')}
    refs=[]
    for algorithm in ('logistic','lightgbm'):
        ref=register_model(root,'synthetic_risk_model',root/algorithm)
        refs.append({k:ref[k] for k in ('name','version','artifact_sha256')})
    for generation,ref in enumerate([refs[0],refs[1],refs[0]]):
        if (root/'deployment.json').exists() and read_json(root/'deployment.json')['generation']>generation:
            if read_json(root/'deployment-history'/(str(generation+1)+'.json'))['model']!=ref:raise ValueError('ML_DEMO_CONFLICT')
        else:deploy(root,ref,generation)
    deploy(root,refs[0],2)
    init_shadow(root)
    summary={'format':1,'scope':'synthetic_shadow_only','dataset_sha256':data['dataset_sha256'],'rows':data['counts'],
             'training':{key:report['status'] for key,report in reports.items()},'model':refs[0],
             'registry_versions':[ref['version'] for ref in refs],'rollback_generation':3,
             'real_lmps_quality_claims':False,'enforcement':False}
    if (root/'demo.json').exists():
        if read_json(root/'demo.json')!=summary:raise ValueError('ML_DEMO_CONFLICT')
    else:write(root/'demo.json',encoded(summary))
    print(json.dumps(summary));return 0


if __name__=='__main__':
    import sys
    try:sys.exit(main())
    except Exception:
        print('ML_DEMO_FAILED; diagnostics withheld.',file=sys.stderr);sys.exit(1)
