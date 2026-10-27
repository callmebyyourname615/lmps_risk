"""No.48: bounded disk-backed point-in-time feature replay with atomic checkpoints."""
from contextlib import contextmanager
from datetime import datetime,timezone
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
import stat
from .dataset import DatasetInput,Event,FEATURES,FEATURE_SHA,VERSION,feature_reason,feature_values,feature_record,partition,net,stamp
from .private import digest,directory,encoded,mode,publish,read_bytes,read_json

MAX_ROWS=1_000_000
MAX_BYTES=2*1024**3
WINDOW_LIMIT=10_000
MIN_TIME=-10**18


def millis(value):
    if value is None:return MIN_TIME
    delta=stamp(value)-datetime(1970,1,1,tzinfo=timezone.utc)
    return delta.days*86400000+delta.seconds*1000+delta.microseconds//1000


@contextmanager
def source_file(path):
    directory(Path(path).parent)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as source:
        before=os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_uid!=os.getuid() or before.st_mode&0o077 or not 0<before.st_size<=MAX_BYTES:
            raise ValueError('REPLAY_SOURCE_REJECTED')
        hash_=sha256()
        while block:=source.read(1024*1024):hash_.update(block)
        source.seek(0);yield source,hash_.hexdigest(),before
        after=os.fstat(source.fileno())
        if any(getattr(before,k)!=getattr(after,k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')):raise ValueError('REPLAY_SOURCE_CHANGED')


def _event(raw,settings):
    if not raw.endswith(b'\n') or len(raw)>16384:raise ValueError('REPLAY_LINE_REJECTED')
    def unique(pairs):
        result=dict(pairs)
        if len(result)!=len(pairs):raise ValueError('REPLAY_DUPLICATE_KEY')
        return result
    value=Event.model_validate(json.loads(raw,object_pairs_hook=unique))
    if settings['provenance']!='local_synthetic' and any(v is not None for v in (value.target,value.sender,value.receiver)):raise ValueError('ML_REAL_IDENTITY_UNVERIFIED')
    return value


def _database(root):
    path=root/'state.sqlite'
    if not path.exists():
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600);os.close(fd)
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1 or info.st_mode&0o077:raise ValueError('REPLAY_DATABASE_REJECTED')
    db=sqlite3.connect(path);db.execute('PRAGMA synchronous=FULL');db.execute('PRAGMA cache_size=-16384')
    db.executescript('''CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,decision INTEGER NOT NULL,active INTEGER,payment TEXT,revision INTEGER,payload TEXT NOT NULL,sha TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS event_decisions ON events(decision,id);
      CREATE INDEX IF NOT EXISTS event_activation ON events(active,id);
      CREATE TABLE IF NOT EXISTS versions(payment TEXT,revision INTEGER,sha TEXT NOT NULL,PRIMARY KEY(payment,revision));
      CREATE TABLE IF NOT EXISTS business(payment TEXT PRIMARY KEY,decisions INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS current(payment TEXT PRIMARY KEY,revision INTEGER NOT NULL,sender TEXT,currency TEXT,occurred INTEGER,receiver TEXT,net TEXT,sha TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS current_history ON current(sender,currency,occurred);
      CREATE TABLE IF NOT EXISTS features(id TEXT PRIMARY KEY,partition TEXT NOT NULL,payload TEXT NOT NULL,sha TEXT NOT NULL);''')
    if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('REPLAY_CHECKPOINT_CORRUPT')
    return db


def _get(db,key,default=None):
    row=db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone();return default if row is None else json.loads(row[0])


def _put(db,key,value):db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',(key,encoded(value).decode()))


def replay(source_path,settings,root,*,stop_after=None):
    mode();root=directory(root,True)
    lock=os.open(root/'active.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);db=None
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if set(settings)!=set(DatasetInput.model_fields)-{'rows'}:raise ValueError('REPLAY_CONFIG_INVALID')
        with source_file(source_path) as (source,source_sha,source_stat):
            first=_event(source.readline(16385),settings);source.seek(0)
            request=DatasetInput.model_validate({**settings,'rows':[first.model_dump()]})
            if request.source_sha256!=source_sha:raise ValueError('REPLAY_SOURCE_HASH_MISMATCH')
            binding={'format':'lmps-feature-replay-1','settings':settings,'source_sha256':source_sha,'feature_spec_sha256':FEATURE_SHA,
                     'code_sha256':digest({name:sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in ('dataset.py','replay.py')}),'window_limit':WINDOW_LIMIT}
            db=_database(root)
            if _get(db,'binding') not in (None,binding):raise ValueError('REPLAY_CHECKPOINT_CONFLICT')
            with db:_put(db,'binding',binding)
            if not _get(db,'ingested',False):
                source.seek(_get(db,'offset',0));count=_get(db,'input_rows',0)
                while raw:=source.readline(16385):
                    row=_event(raw,settings);count+=1
                    if count>MAX_ROWS:raise ValueError('REPLAY_ROW_LIMIT')
                    payment=None if row.target is None else encoded([row.target.namespace,row.target.transaction_id]).decode()
                    revision=None if row.target is None else row.target.revision_number
                    active=max(millis(row.available_at),millis(row.occurred_at)) if row.available_at and row.occurred_at else None
                    if payment:
                        signature=digest(row.model_dump(exclude={'row_id','as_of','labels'}))
                        prior=db.execute('SELECT sha FROM versions WHERE payment=? AND revision=?',(payment,revision)).fetchone()
                        if prior and prior[0]!=signature:raise ValueError('ML_REVISION_CONFLICT')
                        db.execute('INSERT OR IGNORE INTO versions VALUES(?,?,?)',(payment,revision,signature))
                        if partition(row,request) in {'train','calibration','test'}:db.execute('INSERT INTO business VALUES(?,1) ON CONFLICT(payment) DO UPDATE SET decisions=decisions+1',(payment,))
                    value=encoded(row.model_dump()).decode()
                    db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)',(row.row_id,millis(row.as_of),active,payment,revision,value,sha256(value.encode()).hexdigest()))
                    if count%500==0:
                        _put(db,'offset',source.tell());_put(db,'input_rows',count);db.commit()
                _put(db,'offset',source.tell());_put(db,'input_rows',count);_put(db,'ingested',True);db.commit()
            processed=_get(db,'processed',0);decision_cursor=_get(db,'decision_cursor',[MIN_TIME,'']);activation=_get(db,'activation',[MIN_TIME,''])
            if db.execute('SELECT count(*) FROM features').fetchone()[0]!=processed:raise ValueError('REPLAY_CHECKPOINT_CORRUPT')
            prefix=db.execute('SELECT count(*) FROM events WHERE (decision,id)<=(?,?)',decision_cursor).fetchone()[0]
            if prefix!=processed:raise ValueError('REPLAY_CURSOR_CORRUPT')
            for state in db.execute('SELECT * FROM current'):
                if digest(list(state[:-1]))!=state[-1]:raise ValueError('REPLAY_CURRENT_CORRUPT')
            if stop_after is not None and (type(stop_after) is not int or stop_after<processed):raise ValueError('REPLAY_STOP_INVALID')
            while stop_after is None or processed<stop_after:
                record=db.execute('SELECT id,decision,payment,payload,sha FROM events WHERE (decision,id)>(?,?) ORDER BY decision,id LIMIT 1',decision_cursor).fetchone()
                if record is None:break
                row_id,time,payment,payload,expected=record
                if sha256(payload.encode()).hexdigest()!=expected:raise ValueError('REPLAY_SOURCE_CORRUPT')
                row=Event.model_validate_json(payload);reason=feature_reason(row,request);vector=None;exact=None
                if row.row_id!=row_id or millis(row.as_of)!=time or payment!=(None if row.target is None else encoded([row.target.namespace,row.target.transaction_id]).decode()):raise ValueError('REPLAY_SOURCE_CORRUPT')
                while True:
                    known=db.execute('SELECT active,id,payment,revision,payload,sha FROM events WHERE active<=? AND (active,id)>(?,?) ORDER BY active,id LIMIT 500',(time,*activation)).fetchall()
                    if not known:break
                    for active,id_,key,revision,body,hash_ in known:
                        if sha256(body.encode()).hexdigest()!=hash_:raise ValueError('REPLAY_SOURCE_CORRUPT')
                        if key:
                            event=Event.model_validate_json(body)
                            if event.target is None or event.row_id!=id_ or revision!=event.target.revision_number or key!=encoded([event.target.namespace,event.target.transaction_id]).decode() or active!=max(millis(event.available_at),millis(event.occurred_at)):raise ValueError('REPLAY_SOURCE_CORRUPT')
                            try:amount=str(net(event))
                            except ValueError:amount=None
                            state=[key,revision,event.sender,event.currency,millis(event.occurred_at),event.receiver,amount]
                            db.execute('''INSERT INTO current VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(payment) DO UPDATE SET revision=excluded.revision,
                                sender=excluded.sender,currency=excluded.currency,occurred=excluded.occurred,receiver=excluded.receiver,net=excluded.net,sha=excluded.sha WHERE excluded.revision>current.revision''',
                                (*state,digest(state)))
                        activation=[active,id_]
                if reason is None:
                    current=db.execute('SELECT revision FROM current WHERE payment=?',(payment,)).fetchone()
                    if current is None or current[0]!=row.target.revision_number:reason='TARGET_REVISION_SUPERSEDED'
                    else:
                        history=db.execute('SELECT receiver,net FROM current WHERE sender=? AND currency=? AND occurred>=? AND occurred<? AND payment<>? LIMIT ?',
                                           (row.sender,row.currency,time-3600000,time,payment,WINDOW_LIMIT+1)).fetchall()
                        if len(history)>WINDOW_LIMIT:reason='FEATURE_WINDOW_CAPACITY'
                        elif any(amount is None for _,amount in history):reason='MONEY_UNAVAILABLE'
                        else:
                            try:
                                amount=net(row);executed=[(receiver,int(total)) for receiver,total in history if int(total)>0]
                                exact=str(amount);vector=feature_values(amount,stamp(row.as_of),len(executed),sum(total for _,total in executed),any(receiver==row.receiver for receiver,_ in executed))
                            except ValueError:reason='MONEY_UNAVAILABLE'
                part=partition(row,request);repetitions=None if payment is None else db.execute('SELECT decisions FROM business WHERE payment=?',(payment,)).fetchone()
                if repetitions and repetitions[0]>1:part='purged'
                feature=feature_record(row,part,vector,reason,exact);body=encoded(feature).decode()
                db.execute('INSERT INTO features VALUES(?,?,?,?)',(row_id,part,body,sha256(body.encode()).hexdigest()));processed+=1;decision_cursor=[time,row_id]
                if processed%500==0:
                    _put(db,'decision_cursor',decision_cursor);_put(db,'activation',activation);_put(db,'processed',processed);db.commit()
            _put(db,'decision_cursor',decision_cursor);_put(db,'activation',activation);_put(db,'processed',processed);db.commit()
            complete=processed==_get(db,'input_rows')
            current_stat=os.fstat(source.fileno())
            if any(getattr(source_stat,k)!=getattr(current_stat,k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')):raise ValueError('REPLAY_SOURCE_CHANGED')
            result={'format':'lmps-feature-replay-1','status':'complete' if complete else 'checkpointed','input_rows':_get(db,'input_rows'),'processed_rows':processed,
                    'source_sha256':source_sha,'feature_spec_sha256':FEATURE_SHA,'enforcement':False,'source_semantics':'unverified'}
            if complete:
                hashes=[];chunk=[];number=0
                for body,expected in db.execute('SELECT payload,sha FROM features ORDER BY id'):
                    if sha256(body.encode()).hexdigest()!=expected:raise ValueError('REPLAY_OUTPUT_CORRUPT')
                    chunk.append(body.encode()+b'\n')
                    if len(chunk)==1000:
                        data=b''.join(chunk);publish(root/f'chunk-{number:05d}',{'features.jsonl':data});hashes.append({'number':number,'rows':len(chunk),'sha256':sha256(data).hexdigest()});chunk=[];number+=1
                if chunk:
                    data=b''.join(chunk);publish(root/f'chunk-{number:05d}',{'features.jsonl':data});hashes.append({'number':number,'rows':len(chunk),'sha256':sha256(data).hexdigest()})
                result['chunks']=hashes;result['binding']=binding;publish(root/'complete',{'manifest.json':encoded(result)})
            return result
    finally:
        if db:db.close()
        os.close(lock)


def cohort(root,output,maximum=2000):
    mode();root=directory(root);manifest=read_json(root/'complete/manifest.json')
    if type(maximum) is not int or not 3<=maximum<=2000:raise ValueError('REPLAY_COHORT_LIMIT')
    per=maximum//3;selected={part:[] for part in ('train','calibration','test')}
    all_rows=0;hash_=sha256()
    for chunk in manifest['chunks']:
        raw=read_bytes(root/f"chunk-{chunk['number']:05d}"/'features.jsonl');hash_.update(raw)
        if sha256(raw).hexdigest()!=chunk['sha256']:raise ValueError('REPLAY_OUTPUT_CORRUPT')
        records=[json.loads(line) for line in raw.splitlines()]
        if len(records)!=chunk['rows']:raise ValueError('REPLAY_OUTPUT_CORRUPT')
        all_rows+=len(records)
        for row in records:
            part=row['partition']
            if part in selected and len(selected[part])<per:selected[part].append(row)
    if all_rows!=manifest['processed_rows']:raise ValueError('REPLAY_OUTPUT_CORRUPT')
    rows=sorted([r for values in selected.values() for r in values],key=lambda r:r['row_id'])
    if not rows:raise ValueError('REPLAY_NO_TEMPORAL_COHORT')
    settings=manifest['binding']['settings']
    report={'format':'lmps-feature-dataset-1','version':settings['version'],'provenance':settings['provenance'],'source_semantics':'unverified',
            'source_sha256':settings['source_sha256'],'input_sha256':digest(manifest),'feature_version':VERSION,'feature_spec_sha256':FEATURE_SHA,'feature_definitions':FEATURES,
            'label_sampling':settings['label_sampling'],'split':{k:settings[k] for k in ('train_end','calibration_end','test_end','evaluation_at','embargo_seconds')},
            'counts':{'rows':len(rows),'available':sum(r['status']=='available' for r in rows),**{part:sum(r['partition']==part for r in rows) for part in ('train','calibration','test','purged','outside')}},
            'rows':rows,'enforcement':False,'operational_alerts':False,'sampling':{'method':'first_row_ids_per_partition','source_rows':all_rows,'population_claims':False,'replay_sha256':digest(manifest)}}
    report['dataset_sha256']=digest(report)
    if output is not None:publish(output,{'dataset.json':encoded(report),'replay-proof.json':encoded({'replay_root':str(root),'maximum':maximum,'manifest_sha256':digest(manifest),'feature_stream_sha256':hash_.hexdigest()})})
    return report
