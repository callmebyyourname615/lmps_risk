"""No.43/44: train-only fitting, explicit label maturity, cohort metrics and actual local MLflow."""
from hashlib import sha256
import importlib.metadata
import math
from pathlib import Path
import os

os.environ.setdefault('MLFLOW_DISABLE_AGENT_HINT','1')
os.environ.setdefault('MLFLOW_DISABLE_TELEMETRY','true')

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
import skops.io as sio
import lightgbm as lgb
from mlflow import MlflowClient

from .dataset import FEATURE_NAMES, FEATURE_SHA, TASKS, VERSION, stamp, validate_dataset
from .private import digest, directory, encoded, mode, publish, read_json, read_bytes

SEED = 1729


def eligibility(dataset, task, part):
    if task not in TASKS or part not in {"train","calibration","test"}:
        raise ValueError("ML_TASK_INVALID")
    cutoff=stamp(dataset["split"][{"train":"train_end","calibration":"calibration_end","test":"evaluation_at"}[part]])
    selected, reasons=[],{}
    for row in dataset["rows"]:
        if row["partition"] != part:
            continue
        label=row["labels"][task]
        reason=None
        if dataset["provenance"] != "local_synthetic" or label["source_status"] != "synthetic_declared": reason="LABEL_PROVENANCE_UNVERIFIED"
        elif row["status"] != "available": reason="FEATURE_UNAVAILABLE"
        elif label["outcome"] is None: reason="LABEL_UNKNOWN"
        elif label["review_status"] != "adjudicated": reason="NOT_ADJUDICATED"
        elif label['reviewer_ref'] is None or label['evidence_sha256'] is None or label['reviewed_at'] is None: reason="REVIEW_EVIDENCE_MISSING"
        elif (stamp(label['reviewed_at']) < stamp(row['as_of']) or label['available_at'] is None or label['mature_at'] is None
              or stamp(label['available_at']) < stamp(label['reviewed_at']) or stamp(label['mature_at']) < stamp(label['reviewed_at'])): reason="LABEL_TIMELINE_INVALID"
        elif label["mature_at"] is None or label["available_at"] is None or max(stamp(label["mature_at"]),stamp(label["available_at"])) >= cutoff: reason="NOT_MATURE_BY_CUTOFF"
        if reason: reasons[reason]=reasons.get(reason,0)+1
        else: selected.append(row)
    return selected,reasons


def interval(successes,trials):
    if trials==0:return None
    z=1.959963984540054; p=successes/trials;d=1+z*z/trials
    center=(p+z*z/(2*trials))/d; radius=z*math.sqrt(p*(1-p)/trials+z*z/(4*trials*trials))/d
    return [max(0,center-radius),min(1,center+radius)]


def metrics(labels,probabilities,threshold=0.5):
    y=np.asarray(labels,dtype=int);p=np.asarray(probabilities,dtype=float)
    if not len(y) or len(set(y))!=2 or not np.isfinite(p).all() or np.any(p<0) or np.any(p>1):
        raise ValueError("ML_METRICS_UNAVAILABLE")
    predicted=p>=threshold
    tp=int(np.sum(predicted & (y==1)));fp=int(np.sum(predicted & (y==0)));fn=int(np.sum(~predicted & (y==1)));tn=int(np.sum(~predicted & (y==0)))
    return {"cohort_rows":len(y),"threshold":threshold,"tp":tp,"fp":fp,"fn":fn,"tn":tn,
            "precision":None if tp+fp==0 else tp/(tp+fp),"recall":tp/(tp+fn),
            "precision_wilson95":interval(tp,tp+fp),"recall_wilson95":interval(tp,tp+fn),
            "roc_auc":float(roc_auc_score(y,p)),"average_precision":float(average_precision_score(y,p)),
            "brier":float(brier_score_loss(y,p)),"alert_rate":float(np.mean(predicted))}


def code_hash():
    return digest({name:sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in ("dataset.py","training.py","private.py")})


def tracker(root):
    mode();root=directory(root,True);artifacts=directory(root/'artifacts',True)
    # Explicit local URIs override remote environment configuration; no autologging or raw rows.
    os.environ['MLFLOW_DISABLE_TELEMETRY']='true'
    client=MlflowClient(tracking_uri='sqlite:///'+str(root/'tracking.db'),registry_uri='sqlite:///'+str(root/'tracking.db'))
    experiment=client.get_experiment_by_name('lmps_local_experiments')
    experiment_id=experiment.experiment_id if experiment else client.create_experiment('lmps_local_experiments',artifact_location=artifacts.as_uri())
    if (root/'tracking.db').exists():(root/'tracking.db').chmod(0o600)
    return client,experiment_id


def _enough(rows):
    labels=[r['_label'] for r in rows]
    return len(rows)>=20 and min(labels.count(0),labels.count(1))>=5


def train(dataset, output, tracking, algorithm):
    mode();validate_dataset(dataset)
    if algorithm not in {'baseline','logistic','lightgbm'}:raise ValueError('ML_ALGORITHM_INVALID')
    currencies={row['currency'] for row in dataset['rows'] if row['status']=='available'}
    if len(currencies)>1:raise ValueError('ML_ONE_CURRENCY_PER_MODEL_REQUIRED')
    output=Path(output);directory(output.parent)
    request={"dataset_sha256":dataset['dataset_sha256'],"algorithm":algorithm,"seed":SEED,"feature_spec_sha256":FEATURE_SHA,"code_sha256":code_hash()}
    if output.exists():
        receipt=read_json(output/'receipt.json')
        if receipt['request']!=request:raise ValueError('ML_TRAINING_CONFLICT')
        for name,expected in receipt['files'].items():
            if sha256(read_bytes(output/name)).hexdigest()!=expected:raise ValueError('ML_MODEL_CHANGED')
        return {**read_json(output/'report.json'),"publication":"duplicate"}
    client,experiment=tracker(tracking);run=client.create_run(experiment_id=experiment,tags={'scope':'synthetic_experiment_only','source_semantics':'unverified'})
    run_id=run.info.run_id
    try:
        for key,value in request.items():client.log_param(run_id,key,value)
        files={};report={"format":"lmps-training-1","request":request,"population_claims":False,"label_sampling":dataset['label_sampling'],
                         "provenance":dataset['provenance'],"synthetic_only":True,"algorithm":algorithm,"tasks":{},"operational_alerts":False,"enforcement":False}
        models={}
        if algorithm=='baseline':
            train_rows=[r for r in dataset['rows'] if r['partition']=='train' and r['status']=='available']
            test_rows=[r for r in dataset['rows'] if r['partition']=='test' and r['status']=='available']
            calibration=[r for r in dataset['rows'] if r['partition']=='calibration' and r['status']=='available']
            if min(len(train_rows),len(test_rows),len(calibration))<20:
                report['status']='unavailable';report['reason_code']='FEATURE_COHORT_INSUFFICIENT'
            else:
                x=np.asarray([r['values'] for r in train_rows],dtype=float);c=np.asarray([r['values'] for r in calibration],dtype=float);t=np.asarray([r['values'] for r in test_rows],dtype=float)
                model=IsolationForest(n_estimators=32,max_samples=min(128,len(x)),random_state=SEED,n_jobs=1).fit(x)
                scores=-model.score_samples(t);threshold=float(np.quantile(-model.score_samples(c),0.95))
                amount=x[:,0];median=float(np.median(amount));mad=float(np.median(abs(amount-median)))
                files['isolation.skops']=sio.dumps(model)
                report.update(status='complete',cohort_sha256=digest([r['row_id'] for r in test_rows]),
                              train_rows=len(x),test_rows=len(t),isolation={"score_meaning":"novelty_not_probability","threshold":threshold,"selected":int(np.sum(scores>threshold))},
                              statistical={"status":"available" if mad>0 else "unavailable","median":median,"mad":mad,
                                           "selected":None if mad==0 else int(np.sum((t[:,0]-median)/(1.4826*mad)>3))},
                              reference_rule={"meaning":"explicit synthetic net-amount criterion, not a legal threshold","amount_gte":"5000.00",
                                              "selected":sum(int(r['net_amount_cents'])>=500000 for r in test_rows)})
                models['novelty']={"file":"isolation.skops","threshold":threshold}
                for key,value in {'train_rows':len(x),'test_rows':len(t),'novelty_threshold':threshold,
                                  'novelty_selected':report['isolation']['selected'],'reference_rule_selected':report['reference_rule']['selected']}.items():
                    client.log_metric(run_id,key,value)
        else:
            for task in TASKS:
                parts={};rejections={}
                for part in ('train','calibration','test'):
                    selected,reasons=eligibility(dataset,task,part)
                    parts[part]=[{**r,'_label':r['labels'][task]['outcome']} for r in selected];rejections[part]=reasons
                if not all(_enough(rows) for rows in parts.values()):
                    report['tasks'][task]={"status":"unavailable","reason_code":"ELIGIBLE_LABELS_INSUFFICIENT","rejections":rejections,
                                           "eligible":{k:len(v) for k,v in parts.items()}}
                    continue
                x=np.asarray([r['values'] for r in parts['train']],dtype=float);y=np.asarray([r['_label'] for r in parts['train']])
                c=np.asarray([r['values'] for r in parts['calibration']],dtype=float);cy=np.asarray([r['_label'] for r in parts['calibration']])
                t=np.asarray([r['values'] for r in parts['test']],dtype=float);ty=np.asarray([r['_label'] for r in parts['test']])
                if algorithm=='logistic':
                    model=make_pipeline(StandardScaler(),LogisticRegression(random_state=SEED,max_iter=500)).fit(x,y)
                    calibration_raw=model.decision_function(c);test_raw=model.decision_function(t)
                    name=task+'.skops';files[name]=sio.dumps(model)
                else:
                    model=lgb.train({'objective':'binary','verbosity':-1,'num_leaves':7,'min_data_in_leaf':5,'learning_rate':0.1,
                                     'num_threads':1,'seed':SEED,'deterministic':True,'force_col_wise':True},
                                    lgb.Dataset(x,label=y,feature_name=FEATURE_NAMES),num_boost_round=32)
                    calibration_raw=model.predict(c,raw_score=True);test_raw=model.predict(t,raw_score=True)
                    name=task+'.txt';files[name]=model.model_to_string().encode()
                calibrator=LogisticRegression(random_state=SEED,max_iter=500).fit(np.asarray(calibration_raw).reshape(-1,1),cy)
                probability=calibrator.predict_proba(np.asarray(test_raw).reshape(-1,1))[:,1]
                rule=np.asarray([int(r['net_amount_cents'])>=500000 for r in parts['test']],dtype=float)
                model_info={"file":name,"calibration_coefficient":float(calibrator.coef_[0,0]),"calibration_intercept":float(calibrator.intercept_[0])}
                models[task]=model_info
                report['tasks'][task]={"status":"available","cohort_sha256":digest([r['row_id'] for r in parts['test']]),
                    "eligible":{k:len(v) for k,v in parts.items()},"rejections":rejections,
                    "test_metrics":metrics(ty,probability),"reference_rule_metrics":metrics(ty,rule),
                    "calibration_scope":"calibration_partition_only; test never used for fitting/threshold selection"}
                for metric in ('roc_auc','average_precision','brier','alert_rate'):client.log_metric(run_id,task+'_'+metric,report['tasks'][task]['test_metrics'][metric])
            report['status']='complete' if len(models)==len(TASKS) else 'unavailable'
            if report['status']=='unavailable':report['reason_code']='ELIGIBLE_LABELS_INSUFFICIENT'
        metadata={"format":"lmps-model-bundle-1","scope":"synthetic_shadow_only","algorithm":algorithm,"feature_version":VERSION,
                  "feature_spec_sha256":FEATURE_SHA,"feature_names":FEATURE_NAMES,"dataset_sha256":dataset['dataset_sha256'],
                  "currency":next(iter(currencies),None),
                  "code_sha256":request['code_sha256'],"seed":SEED,"models":models,"status":report['status'],
                  "trained_through":dataset['split']['calibration_end'],
                  "packages":{name:importlib.metadata.version(name) for name in ('numpy','scikit-learn','lightgbm','skops')}}
        reference=np.asarray([float(row['values'][0]) for row in dataset['rows'] if row['partition']=='train' and row['status']=='available'])
        if len(reference):
            cuts=np.quantile(reference,np.arange(1,10)/10).tolist()
            metadata['monitoring']={'feature':'log1p_net_amount','cuts':cuts,'counts':np.bincount(np.searchsorted(cuts,reference,side='right'),minlength=10).tolist(),'rows':len(reference)}
        metadata['files']={name:sha256(data).hexdigest() for name,data in files.items()}
        files['metadata.json']=encoded(metadata);files['report.json']=encoded(report)
        receipt={"request":request,"mlflow_run_id":run_id,"metadata_sha256":sha256(files['metadata.json']).hexdigest(),
                 "files":{name:sha256(data).hexdigest() for name,data in files.items()}}
        files['receipt.json']=encoded(receipt);publish(output,files)
        client.log_artifact(run_id,str(output/'metadata.json'),artifact_path='bundle')
        client.log_artifact(run_id,str(output/'report.json'),artifact_path='evaluation')
        for name in metadata['files']:client.log_artifact(run_id,str(output/name),artifact_path='bundle')
        client.set_terminated(run_id,'FINISHED')
        return {**report,"publication":"created"}
    except Exception:
        client.set_terminated(run_id,'FAILED')
        raise
