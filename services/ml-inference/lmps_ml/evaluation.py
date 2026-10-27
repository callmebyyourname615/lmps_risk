"""No.50: validation-only selection/capacity thresholds and frozen common-cohort reporting."""
from hashlib import sha256
import math
from pathlib import Path
import numpy as np
from sklearn.metrics import roc_auc_score,average_precision_score,brier_score_loss
from .dataset import TASKS,validate_dataset
from .private import digest,encoded,publish,read_json,read_bytes
from .training import eligibility,interval,tracker
from .serving import resolve_model

ROOT=Path(__file__).resolve().parents[3]


def rule_results(dataset,source):
    if source is None:return None
    import subprocess,tempfile
    from .private import write
    ids=[r['row_id'] for r in dataset['rows'] if r['partition'] in {'calibration','test'} and r['status']=='available']
    with tempfile.TemporaryDirectory(prefix='lmps-rules-eval-') as temp:
        path=Path(temp)/'input.json';write(path,encoded({'source':source,'ids':ids,'expected_features':{r['row_id']:r['feature_sha256'] for r in dataset['rows'] if r['row_id'] in ids}}))
        result=subprocess.run(['pnpm','exec','node','apps/risk-workers/scripts/evaluation-rules.mjs',str(path)],cwd=ROOT,capture_output=True,timeout=60)
        if result.returncode:return None
        if len(result.stdout)>2*1024*1024:raise ValueError('EVALUATION_RULE_LIMIT')
        import json
        return json.loads(result.stdout)


def operating_metrics(labels,scores,threshold,probability=False):
    y=np.asarray(labels,dtype=int);s=np.asarray(scores,dtype=float)
    if len(y)!=len(s) or len(y)<1 or set(y)!={0,1} or not np.isfinite(s).all():raise ValueError('EVALUATION_COHORT_UNAVAILABLE')
    if probability and (np.any(s<0) or np.any(s>1)):raise ValueError('EVALUATION_PROBABILITY_INVALID')
    predicted=s>=threshold;tp=int(np.sum(predicted&(y==1)));fp=int(np.sum(predicted&(y==0)));fn=int(np.sum(~predicted&(y==1)));tn=int(np.sum(~predicted&(y==0)))
    return {'rows':len(y),'tp':tp,'fp':fp,'fn':fn,'tn':tn,'precision':None if tp+fp==0 else tp/(tp+fp),'recall':tp/(tp+fn),
            'precision_wilson95':interval(tp,tp+fp),'recall_wilson95':interval(tp,tp+fn),'alert_rate':float(np.mean(predicted)),
            'roc_auc':float(roc_auc_score(y,s)),'average_precision':float(average_precision_score(y,s)),
            'brier':float(brier_score_loss(y,s)) if probability else None,'score_meaning':'calibrated_probability' if probability else 'ranking_not_probability'}


def capacity_threshold(scores,per_thousand):
    if type(per_thousand) is not int or not 0<=per_thousand<=1000:raise ValueError('EVALUATION_CAPACITY_INVALID')
    values=np.asarray(scores,dtype=float)
    if not len(values) or not np.isfinite(values).all():raise ValueError('EVALUATION_COHORT_UNAVAILABLE')
    maximum=len(values)*per_thousand//1000
    for threshold in sorted(set(values.tolist()))+[float(np.nextafter(max(values),math.inf))]:
        if int(np.sum(values>=threshold))<=maximum:return threshold
    raise ValueError('EVALUATION_CAPACITY_INVALID')


def enough(rows):
    values=[r['_label'] for r in rows];return len(rows)>=20 and min(values.count(0),values.count(1))>=5


def evaluate(dataset,root,references,output,capacity=50,source_input=None):
    validate_dataset(dataset)
    if type(capacity) is not int or not 0<=capacity<=1000 or not isinstance(references,list) or len(references)>5:raise ValueError('EVALUATION_CONFIG_INVALID')
    request={'dataset_sha256':dataset['dataset_sha256'],'references':references,'capacity_per_thousand':capacity,
             'code_sha256':sha256(Path(__file__).read_bytes()).hexdigest(),'selection':'calibration_only','final_test':'report_only',
             'rule_context_sha256':digest(source_input),'rule_source_sha256':digest({str(path.relative_to(ROOT)):sha256(path.read_bytes()).hexdigest() for path in [ROOT/'apps/risk-workers/scripts/evaluation-rules.mjs',*sorted((ROOT/'packages/risk/src').glob('*.ts'))]})}
    output=Path(output)
    if output.exists():
        receipt=read_json(output/'receipt.json')
        if receipt['request']!=request or sha256(read_bytes(output/'report.json')).hexdigest()!=receipt['report_sha256']:raise ValueError('EVALUATION_CONFLICT')
        return {**read_json(output/'report.json'),'publication':'duplicate'}
    rules=rule_results(dataset,source_input);rule_rows={} if rules is None else {r['row_id']:r['scores'] for r in rules['rows']}
    models=[]
    if dataset['provenance']=='local_synthetic':
        keys=set()
        for ref in references:
            if not isinstance(ref,dict) or set(ref)!={'name','version','artifact_sha256'}:raise ValueError('EVALUATION_MODEL_INVALID')
            key=(ref['name'],ref['version'])
            if key in keys:raise ValueError('EVALUATION_MODEL_DUPLICATE')
            keys.add(key);model=resolve_model(root,ref['name'],ref['version'],ref['artifact_sha256'])
            if model.metadata['dataset_sha256']!=dataset['dataset_sha256'] or model.metadata['trained_through']!=dataset['split']['calibration_end']:
                raise ValueError('EVALUATION_MODEL_DATASET_MISMATCH')
            models.append(model)
    client,experiment=tracker(Path(root)/'tracking');run=client.create_run(experiment,tags={'scope':'synthetic_evaluation_only','selection':'calibration_only'});run_id=run.info.run_id
    try:
        client.log_param(run_id,'dataset_sha256',dataset['dataset_sha256']);client.log_param(run_id,'capacity_per_thousand',capacity);client.log_param(run_id,'protocol_sha256',digest(request))
        report={'format':'lmps-model-evaluation-1','request':request,'tasks':{},'label_sampling':dataset['label_sampling'],
                'population_claims':False,'scope':'synthetic_shadow_only','source_semantics':'unverified','deployment_authorized':False,'enforcement':False,
                'rule_engine':None if rules is None else {k:v for k,v in rules.items() if k!='rows'}}
        available_train=[r for r in dataset['rows'] if r['partition']=='train' and r['status']=='available']
        amounts=np.asarray([float(r['values'][0]) for r in available_train]);median=float(np.median(amounts)) if len(amounts) else 0
        mad=float(np.median(abs(amounts-median))) if len(amounts) else 0
        for task in TASKS:
            parts={};rejections={}
            for part in ('calibration','test'):
                rows,reasons=eligibility(dataset,task,part);parts[part]=[{**r,'_label':r['labels'][task]['outcome']} for r in rows];rejections[part]=reasons
            if not all(enough(rows) for rows in parts.values()):
                report['tasks'][task]={'status':'unavailable','reason_code':'ELIGIBLE_COMMON_COHORT_INSUFFICIENT','rejections':rejections,'eligible':{k:len(v) for k,v in parts.items()}};continue
            calibration,test=parts['calibration'],parts['test'];cy=[r['_label'] for r in calibration];ty=[r['_label'] for r in test]
            test_sha=digest([r['row_id'] for r in test]);comparisons={}
            def add(name,score_fn,probability,identity=None,fixed=None):
                cs=[score_fn(r) for r in calibration];ts=[score_fn(r) for r in test];threshold=fixed if fixed is not None else capacity_threshold(cs,capacity)
                cm=operating_metrics(cy,cs,threshold,probability);tm=operating_metrics(ty,ts,threshold,probability)
                comparisons[name]={'status':'available','model':identity,'threshold':threshold,'threshold_source':'fixed_reference_rule' if fixed is not None else 'calibration_capacity_only',
                                   'calibration_metrics':cm,'test_metrics':tm,'test_cohort_sha256':test_sha,'test_days':{},
                                   'deployable_probability_threshold':probability and 0<=threshold<=1,'calibration_capacity_met':cm['alert_rate']<=capacity/1000}
                for day in sorted({r['as_of'][:10] for r in test}):
                    subset=[(r,s) for r,s in zip(test,ts) if r['as_of'].startswith(day)];ys=[r['_label'] for r,_ in subset]
                    comparisons[name]['test_days'][day]=operating_metrics(ys,[s for _,s in subset],threshold,probability) if set(ys)=={0,1} else {'status':'unavailable','reason_code':'SINGLE_CLASS_SEGMENT','rows':len(ys)}
            add('reference_rule',lambda r:int(r['net_amount_cents'])/100,False,fixed=5000.0)
            missing_rules=sum(rule_rows.get(r['row_id'],{}).get(task) is None for r in calibration+test)
            if not missing_rules:add('rules_engine',lambda r:rule_rows[r['row_id']][task],False,fixed=.6)
            else:comparisons['rules_engine']={'status':'unavailable','reason_code':'RULE_INPUT_OR_DIMENSION_UNAVAILABLE','missing_cohort_rows':missing_rules}
            if mad>0:add('statistical_mad',lambda r:(float(r['values'][0])-median)/(1.4826*mad),False)
            else:comparisons['statistical_mad']={'status':'unavailable','reason_code':'ZERO_OR_MISSING_TRAIN_MAD'}
            for model in models:
                name=model.identity['name']+':'+model.identity['version'];baseline=model.metadata['algorithm']=='baseline'
                def score(row,model=model,baseline=baseline):
                    probabilities,novelty=model.predict(np.asarray([row['values']],dtype=float));return novelty if baseline else float(probabilities[task])
                add(name,score,not baseline,model.identity)
            candidates=[(key,item) for key,item in comparisons.items() if item['status']=='available' and item['deployable_probability_threshold'] and item['calibration_capacity_met'] and item['calibration_metrics']['precision'] is not None]
            champion=max(candidates,key=lambda pair:(pair[1]['calibration_metrics']['precision'],pair[1]['calibration_metrics']['recall'],pair[0]))[0] if candidates else None
            report['tasks'][task]={'status':'available','test_cohort_sha256':test_sha,'calibration_cohort_sha256':digest([r['row_id'] for r in calibration]),
                'comparisons':comparisons,'candidate_for_review':champion,'selection_uses_test':False,'rejections':rejections}
            for name,item in comparisons.items():
                if item['status']=='available':client.log_metric(run_id,task+'_'+name.replace(':','_')+'_test_recall',item['test_metrics']['recall'])
        report['status']='complete' if all(t['status']=='available' for t in report['tasks'].values()) else 'unavailable'
        report_bytes=encoded(report);publish(output,{'report.json':report_bytes,'receipt.json':encoded({'request':request,'mlflow_run_id':run_id,'report_sha256':sha256(report_bytes).hexdigest()})})
        client.log_artifact(run_id,str(output/'report.json'),artifact_path='evaluation');client.set_terminated(run_id,'FINISHED');return {**report,'publication':'created'}
    except Exception:client.set_terminated(run_id,'FAILED');raise
