"""No.49: explicit task/payment-bound label artifacts; unknown remains unknown."""
from copy import deepcopy
from pathlib import Path
from .dataset import Label,Target,TASKS
from .private import digest,encoded,publish,read_json


def attach(dataset,artifact):
    if set(artifact)!={'format','provenance','exported_at','population_claims','records'} or artifact['format']!='lmps-label-export-1' or artifact['population_claims'] is not False:
        raise ValueError('LABEL_EXPORT_INVALID')
    if not isinstance(artifact['records'],list) or not 1<=len(artifact['records'])<=1000:raise ValueError('LABEL_EXPORT_LIMIT')
    records={}
    for item in artifact['records']:
        value=dict(item);expected=value.pop('sha256')
        if digest(value)!=expected or value['task'] not in TASKS or type(value['version']) is not int or value['version']<1:raise ValueError('LABEL_EXPORT_CHANGED')
        target=Target.model_validate(value['target']);label=Label.model_validate(value['label'])
        key=digest({'target':target.model_dump(),'task':value['task']})
        if key in records:raise ValueError('LABEL_BINDING_AMBIGUOUS')
        if dataset['provenance']!='local_synthetic' and label.source_status!='unverified':raise ValueError('LABEL_REAL_PROMOTION_REJECTED')
        if value['eligibility']!='eligible' and label.outcome is not None:raise ValueError('LABEL_UNKNOWN_NOT_NEGATIVE')
        if value['eligibility']=='eligible' and (label.outcome is None or label.review_status!='adjudicated' or label.source_status!='synthetic_declared'):raise ValueError('LABEL_EXPORT_INVALID')
        records[key]=label.model_dump()
    result=deepcopy(dataset);matched=0
    for row in result['rows']:
        if row['target'] is None:continue
        for task in TASKS:
            key=digest({'target':row['target'],'task':task})
            if key in records:row['labels'][task]=records[key];matched+=1
    if matched==0:raise ValueError('LABEL_TARGET_NOT_FOUND')
    parent=result.pop('dataset_sha256');result['label_lineage']={'parent_dataset_sha256':parent,'label_export_sha256':digest(artifact),'matched_task_rows':matched,'population_claims':False}
    result['dataset_sha256']=digest(result);return result


def attach_files(dataset_path,label_path,output):
    from .pipeline import verified_dataset
    data=verified_dataset(dataset_path);artifact=read_json(label_path,4*1024*1024);report=attach(data,artifact)
    publish(output,{'dataset.json':encoded(report),'label-proof.json':encoded({'parent':str(dataset_path),'labels':str(label_path),'parent_sha256':data['dataset_sha256'],'labels_sha256':digest(artifact)})})
    return report
