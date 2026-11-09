"""Evaluate frozen core exports with existing pinned models; no fitting, activation or truth promotion."""
import math
import re
import time
from pathlib import Path
import numpy as np
from .private import mode, digest, encoded, read_json, write
from .serving import ShadowRequest, resolve_model
from .dataset import TASKS, stamp


def require(value):
    if not value:
        raise ValueError('CORE_EVALUATION_INVALID')


def evaluate_core_cohort(value, root=None, references=()):
    mode()
    require(type(value) is dict and set(value) == {'format','source_semantics','runtime_sha256','rows','cohort_sha256'})
    require(value['format'] == 'lmps-core-shadow-cohort-1' and value['source_semantics'] == 'unverified')
    require(re.fullmatch(r'[a-f0-9]{64}', value['runtime_sha256']) and digest({k:v for k,v in value.items() if k != 'cohort_sha256'}) == value['cohort_sha256'])
    require(type(value['rows']) is list and 1 <= len(value['rows']) <= 64 and len(encoded(value)) <= 2097152)
    require(isinstance(references, (tuple,list)) and len(references) <= 5)
    models=[]
    for ref in references:
        require(type(ref) is dict and set(ref) == {'name','version','artifact_sha256'} and root is not None)
        require(not any(m.identity['name']==ref['name'] and m.identity['version']==ref['version'] for m in models))
        models.append(resolve_model(Path(root),ref['name'],ref['version'],ref['artifact_sha256']))
    rows=[]
    seen=set()
    for raw in value['rows']:
        require(type(raw) is dict and set(raw) == {'row_id','request','rules','alert_id'})
        require(type(raw['row_id']) is str and re.fullmatch(r'synthetic_[a-z0-9_]{1,60}',raw['row_id']) and raw['row_id'] not in seen)
        seen.add(raw['row_id'])
        request=ShadowRequest.model_validate(raw['request']); snapshot=request.snapshot
        require(type(raw['rules']) is dict and set(raw['rules'])==set(TASKS))
        require(all(v is None or type(v) is str and re.fullmatch(r'(0\.[0-9]{6}|1\.000000)',v) for v in raw['rules'].values()))
        require(raw['alert_id'] is None or type(raw['alert_id']) is str and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',raw['alert_id']))
        eligible=request.provenance=='local_synthetic' and request.source_semantics=='synthetic_declared' and snapshot.status=='available'
        row={'row_id':raw['row_id'],'feature_sha256':snapshot.feature_sha256,'feature_status':'available' if eligible else 'unavailable','rules':raw['rules'],'models':{}}
        for model in models:
            name=model.identity['name']+':'+model.identity['version']
            reason='FEATURE_UNAVAILABLE' if not eligible else 'CURRENCY_OUT_OF_SCOPE' if model.metadata['currency']!=snapshot.currency else (
                'MODEL_TRAINING_CUTOFF_AFTER_AS_OF' if stamp(model.metadata['trained_through'])>stamp(snapshot.as_of) else None)
            if reason:
                row['models'][name]={'status':'unavailable','reason':reason,'scores':None,'novelty':None}
            else:
                start=time.perf_counter_ns()
                probabilities,novelty=model.predict(np.asarray([snapshot.values],dtype=float))
                scores={k:float(v) for k,v in probabilities.items()}
                require(all(math.isfinite(v) and 0<=v<=1 for v in scores.values()) and (novelty is None or math.isfinite(novelty)))
                row['models'][name]={'status':'available','reason':None,'scores':scores,'novelty':novelty,'elapsed_ns':time.perf_counter_ns()-start}
        rows.append(row)
    tasks={}
    anomaly_names=[m.identity['name']+':'+m.identity['version'] for m in models if m.identity['algorithm']=='baseline']
    classifier_names=[m.identity['name']+':'+m.identity['version'] for m in models if m.identity['algorithm']!='baseline']
    for task in TASKS:
        rule_rows=sum(r['rules'][task] is not None for r in rows)
        anomaly_coverage={name:sum(r['models'][name]['status']=='available' and r['models'][name]['novelty'] is not None for r in rows) for name in anomaly_names}
        classifier_coverage={name:sum(r['models'][name]['status']=='available' and task in (r['models'][name]['scores'] or {}) for r in rows) for name in classifier_names}
        common=[r for r in rows if r['feature_status']=='available' and r['rules'][task] is not None
                and all(r['models'][name]['status']=='available' and r['models'][name]['novelty'] is not None for name in anomaly_names)
                and all(r['models'][name]['status']=='available' and task in (r['models'][name]['scores'] or {}) for name in classifier_names)]
        ids=[r['row_id'] for r in common]
        configured=bool(anomaly_names and classifier_names)
        reason=None if configured and common else ('MODEL_REFERENCE_NOT_CONFIGURED' if not models else
            'ANOMALY_MODEL_NOT_CONFIGURED' if not anomaly_names else
            'CLASSIFIER_MODEL_NOT_CONFIGURED' if not classifier_names else 'COMMON_COHORT_UNAVAILABLE')
        tasks[task]={'common_rows':len(ids),'common_cohort_sha256':digest(ids),'model_count':len(models),
                     'coverage':{'total_rows':len(rows),'rule_rows':rule_rows,'anomaly_rows':anomaly_coverage,'classifier_rows':classifier_coverage},
                     'comparison_status':'available' if reason is None else 'unavailable', 'reason':reason,
                     'precision':None,'recall':None,'accuracy_status':'LABELS_NOT_PROVIDED'}
    return {'format':'lmps-core-shadow-evaluation-1','cohort_sha256':value['cohort_sha256'],'rows':rows,'tasks':tasks,
            'models':[m.identity for m in models],'alert_candidates':len({r['alert_id'] for r in value['rows'] if r['alert_id'] is not None}),
            'historical_model_availability':'retrospective_experiment','training_performed':False,'activation_performed':False,'enforcement':False,'production_ready':False}


def main():
    import argparse,json
    parser=argparse.ArgumentParser();parser.add_argument('--cohort',type=Path,required=True);parser.add_argument('--root',type=Path)
    parser.add_argument('--references',type=Path);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    artifact=read_json(args.cohort,2097152)
    if type(artifact) is dict and set(artifact)=={'cohort','comparison'}:artifact=artifact['cohort']
    result=evaluate_core_cohort(artifact,args.root,read_json(args.references,16384) if args.references else [])
    write(args.output,encoded(result))
    print(json.dumps({'format':result['format'],'rows':len(result['rows']),'models':len(result['models']),'tasks':result['tasks'],'production_ready':False}))


if __name__=='__main__':
    try:main()
    except Exception:
        import sys
        print('CORE_EVALUATION_FAILED; private diagnostics withheld.',file=sys.stderr);sys.exit(1)
