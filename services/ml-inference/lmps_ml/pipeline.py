"""Private file-only ML pipeline CLI. No real source or operational database connection."""
import argparse
import csv
import io
import json
from pathlib import Path
import secrets
import sys

from .dataset import build_dataset,save_dataset,TASKS
from .private import digest,directory,encoded,mode,publish,read_bytes,read_json,write
from .training import train
from .serving import ShadowServer,deploy,register_model


def verified_dataset(path):
    value=read_json(Path(path)/'dataset.json')
    if (Path(path)/'input.json').exists():rebuilt=build_dataset(read_json(Path(path)/'input.json'))
    elif (Path(path)/'label-proof.json').exists():
        from .feedback import attach
        proof=read_json(Path(path)/'label-proof.json');parent=verified_dataset(Path(proof['parent']));labels=read_json(Path(proof['labels']),4*1024*1024)
        if parent['dataset_sha256']!=proof['parent_sha256'] or digest(labels)!=proof['labels_sha256']:raise ValueError('ML_DATASET_CHANGED')
        rebuilt=attach(parent,labels)
    else:
        from .replay import cohort
        proof=read_json(Path(path)/'replay-proof.json');root=Path(proof['replay_root'])
        if digest(read_json(root/'complete/manifest.json'))!=proof['manifest_sha256']:raise ValueError('ML_DATASET_CHANGED')
        rebuilt=cohort(root,None,proof['maximum'])
    if rebuilt!=value:raise ValueError('ML_DATASET_CHANGED')
    return value


def from_bulk(prepared,config):
    root=Path(__file__).resolve().parents[3]
    sys.path.insert(0,str(root/'apps/risk-workers/scripts'))
    import dataset_bulk
    plan=dataset_bulk.verify_prepared(prepared)
    settings=read_json(config)
    if set(settings)!={'version','train_end','calibration_end','test_end','evaluation_at','embargo_seconds'}:
        raise ValueError('ML_CONFIG_INVALID')
    rows=[]
    for chunk in plan['chunks']:
        records=csv.DictReader(io.StringIO(read_bytes(prepared/chunk['csv']).decode('utf-8')))
        for number,row in enumerate(records,1):
            if len(rows)>=2000:break
            row_id=digest({'plan_sha256':digest(plan),'chunk':chunk['number'],'row':number})
            rows.append({'row_id':row_id,'target':None,'revision_sha256':None,'as_of':None,'occurred_at':None,'available_at':None,
                         'sender':None,'receiver':None,'currency':None,'amount':row['amount'],'reversed_amount':None,'status':None,
                         'labels':{task:{'outcome':None,'review_status':'unreviewed','source_status':'unverified','mature_at':None,'available_at':None,
                                         'reviewed_at':None,'reviewer_ref':None,'evidence_sha256':None} for task in TASKS}})
        if len(rows)>=2000:break
    return {'format':1,'execution_mode':'offline_analysis','provenance':'user_supplied_file','source_semantics':'unverified',
            'identity_status':'unverified','source_sha256':digest(plan),'coverage_start':None,'history_complete':False,
            'label_sampling':'reviewed_cohort_only',**settings,'rows':rows}


def source_context(path):
    visited=set()
    for _ in range(8):
        path=Path(path)
        if str(path) in visited:raise ValueError('ML_LABEL_PROOF_CYCLE')
        visited.add(str(path))
        if (path/'input.json').exists():return read_json(path/'input.json')
        if (path/'label-proof.json').exists():path=Path(read_json(path/'label-proof.json')['parent']);continue
        return None
    raise ValueError('ML_LABEL_PROOF_LIMIT')


def init_shadow(root):
    root=directory(root)
    if (root/'auth.token').exists():
        token=read_bytes(root/'auth.token',64).decode();key=read_bytes(root/'signing.key',32)
    else:
        token=secrets.token_hex(32);key=secrets.token_bytes(32)
        write(root/'auth.token',token.encode());write(root/'signing.key',key)
    server=ShadowServer(root,token,key)
    public={'key_id':server.key_id,'public_key':server.public_key}
    if (root/'public.json').exists():
        if read_json(root/'public.json')!=public:raise ValueError('ML_KEY_CONFLICT')
    else:write(root/'public.json',encoded(public))
    return {'status':'initialized','key_id':server.key_id}


def main(argv=None):
    try:
        mode();parser=argparse.ArgumentParser(description=__doc__)
        sub=parser.add_subparsers(dest='command',required=True)
        batch=sub.add_parser('batch-plan');batch.add_argument('--plan',required=True,type=Path);batch.add_argument('--output',required=True,type=Path);batch.add_argument('--retry-ack');batch.add_argument('--stop-after',type=int)
        dataset=sub.add_parser('dataset');dataset.add_argument('--input',required=True,type=Path);dataset.add_argument('--output',required=True,type=Path)
        bulk=sub.add_parser('from-bulk');bulk.add_argument('--prepared',required=True,type=Path);bulk.add_argument('--config',required=True,type=Path);bulk.add_argument('--output',required=True,type=Path)
        training=sub.add_parser('train');training.add_argument('--dataset',required=True,type=Path);training.add_argument('--output',required=True,type=Path);training.add_argument('--tracking',required=True,type=Path);training.add_argument('--algorithm',choices=['baseline','logistic','lightgbm'],required=True)
        register=sub.add_parser('register');register.add_argument('--root',required=True,type=Path);register.add_argument('--model',required=True,type=Path);register.add_argument('--name',required=True)
        activation=sub.add_parser('deploy');activation.add_argument('--root',required=True,type=Path);activation.add_argument('--name',required=True);activation.add_argument('--version',required=True);activation.add_argument('--sha256',required=True);activation.add_argument('--expected-generation',required=True,type=int)
        initialization=sub.add_parser('init-shadow');initialization.add_argument('--root',required=True,type=Path)
        replay=sub.add_parser('replay');replay.add_argument('--source',required=True,type=Path);replay.add_argument('--config',required=True,type=Path);replay.add_argument('--output',required=True,type=Path);replay.add_argument('--stop-after',type=int)
        cohort=sub.add_parser('cohort');cohort.add_argument('--replay',required=True,type=Path);cohort.add_argument('--output',required=True,type=Path);cohort.add_argument('--maximum',type=int,default=2000)
        feedback=sub.add_parser('attach-labels');feedback.add_argument('--dataset',required=True,type=Path);feedback.add_argument('--labels',required=True,type=Path);feedback.add_argument('--output',required=True,type=Path)
        evaluation=sub.add_parser('evaluate');evaluation.add_argument('--dataset',required=True,type=Path);evaluation.add_argument('--root',required=True,type=Path);evaluation.add_argument('--references',required=True,type=Path);evaluation.add_argument('--output',required=True,type=Path);evaluation.add_argument('--capacity-per-thousand',type=int,default=50)
        backup=sub.add_parser('backup');backup.add_argument('--root',required=True,type=Path);backup.add_argument('--output',required=True,type=Path)
        restore=sub.add_parser('restore');restore.add_argument('--bundle',required=True,type=Path);restore.add_argument('--output',required=True,type=Path)
        args=parser.parse_args(argv)
        if args.command=='batch-plan':
            from .batch_schedule import MAX_BYTES,run_plan
            result=run_plan(read_json(args.plan,MAX_BYTES),args.output,retry_ack=args.retry_ack,stop_after=args.stop_after)
            print(json.dumps(result));return 0 if result['status']=='complete' else 1
        elif args.command=='dataset':
            value=save_dataset(read_json(args.input),args.output);result={'status':value['status'],'counts':value['counts']}
        elif args.command=='from-bulk':
            value=save_dataset(from_bulk(args.prepared,args.config),args.output);result={'status':value['status'],'counts':value['counts'],'source_semantics':'unverified'}
        elif args.command=='train':
            value=train(verified_dataset(args.dataset),args.output,args.tracking,args.algorithm)
            result={'status':value['status'],'algorithm':args.algorithm,'publication':value['publication'],
                    'tasks':{key:item['status'] for key,item in value['tasks'].items()},'population_claims':False}
        elif args.command=='register':result=register_model(args.root,args.name,args.model)
        elif args.command=='deploy':
            value=deploy(args.root,{'name':args.name,'version':args.version,'artifact_sha256':args.sha256},args.expected_generation)
            result={'generation':value['generation'],'model':value['model'],'execution_mode':'shadow','enforcement':False}
        elif args.command=='replay':
            from .replay import replay
            value=replay(args.source,read_json(args.config),args.output,stop_after=args.stop_after)
            result={k:value[k] for k in ('status','input_rows','processed_rows','enforcement')}
        elif args.command=='cohort':
            from .replay import cohort
            value=cohort(args.replay,args.output,args.maximum);result={'status':'complete','counts':value['counts'],'population_claims':False}
        elif args.command=='attach-labels':
            from .feedback import attach_files
            value=attach_files(args.dataset,args.labels,args.output);result={'status':'complete','matched_task_rows':value['label_lineage']['matched_task_rows']}
        elif args.command=='evaluate':
            from .evaluation import evaluate
            source=source_context(args.dataset)
            value=evaluate(verified_dataset(args.dataset),args.root,read_json(args.references),args.output,args.capacity_per_thousand,source_input=source)
            result={'status':value['status'],'tasks':{k:v['status'] for k,v in value['tasks'].items()},'population_claims':False,'deployment_authorized':False}
        elif args.command=='backup':
            from .backup import snapshot
            value=snapshot(args.root,args.output);result={'status':'complete','files':len(value['files']),'enforcement':False}
        elif args.command=='restore':
            from .backup import restore
            value=restore(args.bundle,args.output);result={'status':'complete','relocated_uri_rows':value['relocated_uri_rows'],'versions_preserved':True,'enforcement':False}
        else:result=init_shadow(args.root)
        print(json.dumps(result));return 0
    except (Exception,SystemExit):
        print('ML_PIPELINE_FAILED; private diagnostics withheld.',file=sys.stderr);return 1


if __name__=='__main__':sys.exit(main())
