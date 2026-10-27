"""Local private ML/registry recovery, including explicit file-URI relocation evidence."""
from hashlib import sha256
import os
from pathlib import Path
import sqlite3
import stat
from urllib.parse import urlparse,unquote
from contextlib import closing
from .private import digest,directory,encoded,read_json,write,mode

LIMIT=64*1024*1024


def _read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.getuid() or info.st_mode&0o077 or info.st_size>16*1024*1024:raise ValueError('ML_RECOVERY_FILE_REJECTED')
        data=stream.read(16*1024*1024+1);after=os.fstat(stream.fileno())
        if len(data)!=info.st_size or info.st_mtime_ns!=after.st_mtime_ns or info.st_ctime_ns!=after.st_ctime_ns:raise ValueError('ML_RECOVERY_FILE_CHANGED')
        return data


def _target(root,relative):
    path=Path(relative)
    if path.is_absolute() or '..' in path.parts or not path.parts:raise ValueError('ML_RECOVERY_PATH_REJECTED')
    result=root
    for part in path.parts[:-1]:result=directory(result/part,True)
    return result/path.name


def snapshot(root,output):
    import fcntl
    mode()
    root=directory(root);directory(Path(output).parent)
    if Path(output).resolve().is_relative_to(root.resolve()) or root.resolve().is_relative_to(Path(output).resolve()):raise ValueError('ML_RECOVERY_OVERLAP')
    Path(output).mkdir(mode=0o700);output=directory(output);files={};size=0
    lock=os.open(root/'deployment.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for parent,dirs,names in os.walk(root,followlinks=False):
            for name in dirs:
                path=Path(parent)/name
                if path.is_symlink() or path.stat().st_uid!=os.getuid():raise ValueError('ML_RECOVERY_PATH_REJECTED')
            for name in names:
                source=Path(parent)/name;relative=str(source.relative_to(root))
                if relative=='deployment.lock' or name.endswith(('.db-journal','.db-wal','.db-shm')):continue
                target=_target(output,relative)
                if relative=='tracking/tracking.db':
                    _read(source)
                    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
                    with closing(sqlite3.connect('file:'+str(source)+'?mode=ro',uri=True)) as original,closing(sqlite3.connect(target)) as destination:original.backup(destination)
                    data=_read(target)
                else:data=_read(source);write(target,data)
                size+=len(data)
                if size>LIMIT or len(files)>=200:raise ValueError('ML_RECOVERY_LIMIT')
                files[relative]={'bytes':len(data),'sha256':sha256(data).hexdigest()}
        manifest={'format':'lmps-private-ml-backup-1','source_root':str(root),'files':files,'scope':'synthetic_shadow_only','enforcement':False}
        write(output/'manifest.json',encoded(manifest));return manifest
    finally:os.close(lock)


def restore(bundle,output):
    mode()
    bundle=directory(bundle);manifest=read_json(bundle/'manifest.json');files=manifest['files']
    if manifest['format']!='lmps-private-ml-backup-1' or manifest['scope']!='synthetic_shadow_only' or manifest['enforcement'] is not False or not 1<=len(files)<=200:
        raise ValueError('ML_RECOVERY_MANIFEST_REJECTED')
    old=Path(manifest['source_root'])
    directory(Path(output).parent);output=Path(output)
    if output.resolve().is_relative_to(bundle.resolve()) or bundle.resolve().is_relative_to(output.resolve()) or output.resolve().is_relative_to(old.resolve()) or old.resolve().is_relative_to(output.resolve()):raise ValueError('ML_RECOVERY_OVERLAP')
    # Verify every frozen byte before creating a restore destination; never overwrite an existing root.
    size=0
    for relative,proof in files.items():
        path=Path(relative)
        if path.is_absolute() or '..' in path.parts:raise ValueError('ML_RECOVERY_PATH_REJECTED')
        candidate=bundle
        for part in path.parts[:-1]:candidate=directory(candidate/part)
        data=_read(candidate/path.name);size+=len(data)
        if len(data)!=proof['bytes'] or sha256(data).hexdigest()!=proof['sha256'] or size>LIMIT:raise ValueError('ML_RECOVERY_CHANGED')
    output.mkdir(mode=0o700);output=directory(output)
    for relative in files:write(_target(output,relative),_read(bundle/relative))
    database=output/'tracking/tracking.db';before=sha256(_read(database)).hexdigest();relocations=0;unused_default=0
    with closing(sqlite3.connect(database)) as db,db:
        for table,column in [('model_versions','source'),('runs','artifact_uri'),('experiments','artifact_location')]:
            rows=db.execute(f'SELECT rowid,{column} FROM {table}').fetchall()
            for id_,uri in rows:
                if not isinstance(uri,str):continue
                parsed=urlparse(uri)
                if table=='experiments' and id_==0 and db.execute('SELECT count(*) FROM runs WHERE experiment_id=0').fetchone()[0]==0:
                    unused_default+=1;continue
                if parsed.scheme!='file' or parsed.netloc or parsed.query or parsed.fragment:raise ValueError('ML_RECOVERY_REMOTE_URI_REJECTED')
                path=Path(unquote(parsed.path))
                if not path.is_relative_to(old):raise ValueError('ML_RECOVERY_REMOTE_URI_REJECTED')
                replacement=(output/path.relative_to(old)).as_uri();db.execute(f'UPDATE {table} SET {column}=? WHERE rowid=?',(replacement,id_));relocations+=1
    receipt={'format':'lmps-local-ml-relocation-1','manifest_sha256':digest(manifest),'old_root':str(old),'restored_root':str(output),
             'registry_before_sha256':before,'registry_after_sha256':sha256(_read(database)).hexdigest(),'relocated_uri_rows':relocations,'unused_default_experiments_skipped':unused_default,'versions_preserved':True,'enforcement':False}
    from .serving import ShadowServer,resolve_model
    from .training import tracker
    server=ShadowServer(output,_read(output/'auth.token').decode(),_read(output/'signing.key'))
    if server.model is None or read_json(output/'public.json')!={'key_id':server.key_id,'public_key':server.public_key}:raise ValueError('ML_RECOVERY_WARMUP_FAILED')
    client,_=tracker(output/'tracking');versions=list(client.search_model_versions())
    if not 1<=len(versions)<=50:raise ValueError('ML_RECOVERY_VERSION_LIMIT')
    for version in versions:resolve_model(output,version.name,str(version.version),version.tags['artifact_sha256'])
    receipt['warmed_versions']=len(versions)
    write(output/'restore.json',encoded(receipt));return receipt
