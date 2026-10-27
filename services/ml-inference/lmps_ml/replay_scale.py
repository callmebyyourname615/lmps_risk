"""Opt-in invented replay scale/recovery evidence; never source database traffic."""
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import resource
import signal
import sqlite3
import subprocess
import sys
import time
from .demo import synthetic_input
from .dataset import build_dataset
from .private import directory,encoded,read_json,write
from .replay import replay


def run(root,count):
    root=directory(root)
    if type(count) is not int or not 10000<=count<=1000000:raise ValueError('SCALE_LIMIT')
    source=root/'events.jsonl';base=synthetic_input(1);start=datetime(2025,12,1,tzinfo=timezone.utc)
    iso=lambda v:v.strftime('%Y-%m-%dT%H:%M:%SZ')
    hash_=sha256();fd=os.open(source,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as output:
        for i in range(count):
            correction=i>0 and i%1000==0;j=i-200 if correction else i;time_=start+timedelta(seconds=i*5);occurred=start+timedelta(seconds=j*5);amount=100+(j*37)%7000
            row={'row_id':f'row_{i:07d}','target':{'namespace':'synthetic_scale','transaction_id':f'tx_{j:07d}','revision_number':2 if correction else 1},
                'revision_sha256':sha256(str(i).encode()).hexdigest(),'as_of':iso(time_),'occurred_at':iso(occurred),'available_at':iso(time_),
                'sender':f'synthetic_sender_{j%200}','receiver':f'synthetic_receiver_{j%997}','currency':'SYN','amount':f'{amount}.00','reversed_amount':f'{amount}.00' if correction else '0.00','status':'reversed' if correction else 'succeeded',
                'labels':{task:{'outcome':None,'review_status':'unreviewed','source_status':'unverified','reviewed_at':None,'available_at':None,'mature_at':None,'reviewer_ref':None,'evidence_sha256':None} for task in base['rows'][0]['labels']}}
            raw=encoded(row)+b'\n';output.write(raw);hash_.update(raw)
        output.flush();os.fsync(output.fileno())
    settings={k:v for k,v in base.items() if k!='rows'};settings.update(version='ml_dataset_scale_'+str(count),source_sha256=hash_.hexdigest(),
        train_end=iso(start+timedelta(seconds=count*5*2//5)),calibration_end=iso(start+timedelta(seconds=count*5*7//10)),
        test_end=iso(start+timedelta(seconds=count*5)),evaluation_at=iso(start+timedelta(seconds=count*5+3600)))
    write(root/'config.json',encoded(settings));stage=root/'replay';log_path=root/'first-process.log'
    begun=time.perf_counter();checkpoint=0
    with log_path.open('xb') as log:
        log_path.chmod(0o600)
        process=subprocess.Popen([sys.executable,'-m','lmps_ml.pipeline','replay','--source',str(source),'--config',str(root/'config.json'),'--output',str(stage)],stdout=log,stderr=log)
        try:
            until=time.monotonic()+240
            while time.monotonic()<until and process.poll() is None:
                try:
                    with sqlite3.connect('file:'+str(stage/'state.sqlite')+'?mode=ro',uri=True,timeout=.1) as db:
                        row=db.execute("SELECT value FROM metadata WHERE key='processed'").fetchone();checkpoint=0 if row is None else json.loads(row[0])
                except sqlite3.Error:pass
                if checkpoint>=1000:process.send_signal(signal.SIGKILL);process.wait(10);break
                time.sleep(.05)
            else:raise ValueError('SCALE_KILL_CHECKPOINT_NOT_REACHED')
        finally:
            if process.poll() is None:process.kill();process.wait(10)
    resumed=time.perf_counter();result=replay(source,settings,stage)
    if result['processed_rows']!=count or result['status']!='complete':raise ValueError('SCALE_RECONCILIATION_FAILED')
    samples=[0,1000,1001,count//4+1,count-1];checks=0
    with sqlite3.connect('file:'+str(stage/'state.sqlite')+'?mode=ro',uri=True) as db:
        for index in samples:
            id_=f'row_{index:07d}';current=db.execute('SELECT decision FROM events WHERE id=?',(id_,)).fetchone()[0]
            values=[json.loads(row[0]) for row in db.execute('SELECT payload FROM events WHERE decision>=? AND decision<=? ORDER BY id',(current-4000000,current+300000))]
            if len(values)>2000:raise ValueError('SCALE_REFERENCE_LIMIT')
            expected=next(row for row in build_dataset({**settings,'rows':values})['rows'] if row['row_id']==id_)
            actual=json.loads(db.execute('SELECT payload FROM features WHERE id=?',(id_,)).fetchone()[0])
            if expected['feature_sha256']!=actual['feature_sha256']:raise ValueError('SCALE_FEATURE_PARITY_FAILED')
            checks+=1
    retained=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
    rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
    report={'format':'lmps-feature-scale-1','data':'invented_only','rows':count,'killed_after_checkpoint':checkpoint,'resume_status':result['status'],
            'reference_checks':checks,'elapsed_seconds':round(time.perf_counter()-begun,3),'resume_seconds':round(time.perf_counter()-resumed,3),
            'python_peak_rss_bytes':rss,'retained_bytes':retained,'enforcement':False,'production_capacity_claim':False}
    write(root/'acceptance.json',encoded(report));return report


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',required=True,type=Path);parser.add_argument('--rows',type=int,default=100000);args=parser.parse_args()
    try:print(json.dumps(run(args.root,args.rows)))
    except Exception:print('FEATURE_SCALE_FAILED; private diagnostics withheld.',file=sys.stderr);sys.exit(1)
