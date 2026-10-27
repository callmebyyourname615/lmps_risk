import { execFile,spawn } from 'node:child_process';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir,readdir,writeFile,realpath } from 'node:fs/promises';
import { basename,dirname,isAbsolute,join,resolve,sep } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs,promisify } from 'node:util';
import { readModelPrivateFile,riskHash } from '@lmps/risk';
import { createDatabase } from '@lmps/database';
import { ROOT,LOCAL,availablePort,dsn,initializeCluster,loadState,localMode,startCluster,stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { createBackup } from '../../../packages/database/scripts/backup.mjs';
import { acquire,checkpoint } from '../../risk-workers/scripts/dataset-bulk.mjs';
import { privateDirectory,readPrivateJson } from '../../risk-workers/scripts/private-json.mjs';
import { openCoreApi,CORE_ROLES } from './local-core.mjs';
const execute=promisify(execFile);
const fail=()=>new Error('SHADOW_RUNTIME_FAILED; private diagnostics withheld.');
const overlap=(a,b)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
const alive=child=>child&&child.exitCode===null&&child.signalCode===null;

async function ownedRoot(root,create=false){
  localMode();if(typeof root!=='string'||!isAbsolute(root))throw fail();await privateDirectory(dirname(root));
  const path=join(await realpath(dirname(root)),basename(root));if(overlap(path,resolve(LOCAL)))throw fail();
  if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateDirectory(path);return path;
}
async function validateOwner(root){const owner=await readPrivateJson(join(root,'owner.json'),4096);if(owner.format!=='lmps-shadow-runtime-1'||owner.root!==root||owner.enforcement!==false)throw fail();return owner;}
async function mlCommand(args){return execute(join(ROOT,'.venv/bin/python'),['-B','-m','lmps_ml.demo',...args],{cwd:join(ROOT,'services/ml-inference'),timeout:60000,maxBuffer:1024*1024});}

export async function initializeShadowRuntime(input,ports={api_port:18511,ml_port:18512,control_port:18513}){
  const root=await ownedRoot(input,true);let release,state,owns=false;
  try{
    if(Object.keys(ports).sort().join(',')!=='api_port,control_port,ml_port'||new Set(Object.values(ports)).size!==3||!Object.values(ports).every(p=>Number.isInteger(p)&&p>=1024&&p<=65535))throw fail();
    release=await acquire(root);const files=await readdir(root);
    if(!files.includes('owner.json')){
      if(files.some(f=>f!=='active.lock'))throw fail();
      await writeFile(join(root,'owner.json'),JSON.stringify({format:'lmps-shadow-runtime-1',root,scope:'local_synthetic_shadow',enforcement:false}),{mode:0o600,flag:'wx'});
      await writeFile(join(root,'config.json'),JSON.stringify(ports),{mode:0o600,flag:'wx'});
      await writeFile(join(root,'control.token'),randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
    }
    await validateOwner(root);
    const config=await readPrivateJson(join(root,'config.json'),4096);if(riskHash(config)!==riskHash(ports))throw fail();
    try{state=await loadState(join(root,'pg'));}catch(error){if(error.code!=='ENOENT')throw error;state=await initializeCluster(join(root,'pg'),await availablePort());}
    if(state.base!==await realpath(join(root,'pg'))||state.port===18503)throw fail();
    owns=true;await startCluster(state);await migrations(dsn(state,'migration'),true);
    try{await mkdir(join(root,'ml'),{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    await mlCommand(['--root',join(root,'ml')]);const backup=await createBackup(state,join(root,'backups'));
    return {status:'initialized',scope:'local_synthetic_shadow',tables:Object.keys(backup.tables).length,enforcement:false};
  }catch{throw fail();}
  finally{try{if(state&&owns)await stopCluster(state);}finally{await release?.();}}
}

export async function openShadowRuntime(input){
  const root=await ownedRoot(input);await validateOwner(root);let release,state,reader,ml,api,control,pulse,closing=false,refresh,ownsPg=false;
  let latest={status:'starting',enforcement:false};
  const close=async()=>{
    if(closing)return;closing=true;clearInterval(pulse);
    try{
      await refresh?.catch(()=>{});await Promise.allSettled([api?.close(),reader?.close()]);
      if(alive(ml)){
        const exited=once(ml,'exit').catch(()=>{});ml.kill('SIGTERM');let timer;
        try{await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{if(alive(ml))ml.kill('SIGKILL');resolve();},5000);})]);}finally{clearTimeout(timer);}
      }
      if(state&&ownsPg)await stopCluster(state);
      if(release)await checkpoint(join(root,'status.json'),{format:'lmps-shadow-runtime-status-1',status:'stopped',recorded_at:new Date().toISOString(),enforcement:false});
    }finally{if(control)await new Promise(resolve=>control.close(resolve));await release?.();}
  };
  try{
    release=await acquire(root);state=await loadState(join(root,'pg'));
    if(state.base!==await realpath(join(root,'pg'))||state.port===18503)throw fail();
    ownsPg=true;await startCluster(state);
    if((await migrations(dsn(state,'migration'))).some(r=>r.status!=='applied'))throw fail();
    const config=await readPrivateJson(join(root,'config.json'),4096),token=await readModelPrivateFile(join(root,'control.token'),64),mlToken=await readModelPrivateFile(join(root,'ml/auth.token'),64);
    if(!/^[0-9a-f]{64}$/.test(token)||!/^[0-9a-f]{64}$/.test(mlToken))throw fail();
    reader=createDatabase(dsn(state));let childFailed=false;const instance=randomBytes(16).toString('hex');
    const deployed=await readPrivateJson(join(root,'ml/deployment.json'),4096);
    ml=spawn(join(ROOT,'.venv/bin/python'),['-B','-m','lmps_ml'],{cwd:join(ROOT,'services/ml-inference'),stdio:'ignore',env:{...process.env,LMPS_ENVIRONMENT:'local',LMPS_EXECUTION_MODE:'test',LMPS_ML_PORT:String(config.ml_port),
      LMPS_ML_INSTANCE_ID:instance,LMPS_ML_ROOT:join(root,'ml'),LMPS_ML_TOKEN_FILE:join(root,'ml/auth.token'),LMPS_ML_SIGNING_KEY_FILE:join(root,'ml/signing.key')}});
    ml.once('error',()=>{childFailed=true;});const mlUrl=`http://127.0.0.1:${config.ml_port}`;let ready=false;
    for(let i=0;i<150;i++){
      try{const response=await fetch(mlUrl+'/health/ready',{signal:AbortSignal.timeout(200)});if(response.ok){const body=await response.json();if(body.instance_id===instance&&body.model.artifact_sha256===deployed.model.artifact_sha256){ready=true;break;}}}catch{}
      if(childFailed||!alive(ml))break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready)throw fail();
    api=await openCoreApi(state,config.api_port,{modelPublicKeyFile:join(root,'ml/public.json')});
    try{await mkdir(join(root,'access'),{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    await privateDirectory(join(root,'access'));let tokenRefreshed=0;
    const refreshStatus=async()=>{
      if(Date.now()-tokenRefreshed>120000){
        const expires=new Date(Date.now()+300000).toISOString();
        for(const role of Object.keys(CORE_ROLES))await checkpoint(join(root,'access',role+'.json'),{authorization:'Bearer '+await api.token(role),expires_at:expires});
        tokenRefreshed=Date.now();
      }
      let metrics=null,modelReady=false;try{
        const r=await fetch(mlUrl+'/v1/shadow/metrics',{headers:{Authorization:'Bearer '+mlToken},signal:AbortSignal.timeout(1000)});if(r.ok){const body=await r.json();if(body.instance_id===instance)metrics=body;}
        const ready=await fetch(mlUrl+'/health/ready',{signal:AbortSignal.timeout(1000)});if(ready.ok){const body=await ready.json();modelReady=body.instance_id===instance&&body.model.artifact_sha256===deployed.model.artifact_sha256&&metrics!==null;}
      }catch{}
      const postgres=await reader.health(),componentsReady=postgres==='available'&&modelReady;
      latest={format:'lmps-shadow-runtime-status-1',status:componentsReady?'local_components_ready':'degraded',scope:'local_synthetic_shadow',recorded_at:new Date().toISOString(),
        components:{postgres,ml:modelReady?'ready':'unavailable'},metrics,production_ready:false,source_semantics:'unverified',enforcement:false};
      await checkpoint(join(root,'status.json'),latest);return latest;
    };
    const status=()=>{
      if(closing)return Promise.resolve({...latest,status:'stopping'});
      refresh??=refreshStatus().finally(()=>{refresh=undefined;});return refresh;
    };
    let updating=false;
    pulse=setInterval(()=>{if(!updating&&!closing){updating=true;status().catch(()=>{}).finally(()=>{updating=false;});}},5000);pulse.unref();
    control=createServer({maxHeaderSize:1024,requestTimeout:2000,headersTimeout:2000},async(request,response)=>{
      response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/json');
      const header=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+token);
      if(header.length!==expected.length||!timingSafeEqual(header,expected)){response.writeHead(401);response.end(JSON.stringify({code:'SHADOW_UNAUTHORIZED'}));return;}
      try{
        if(request.method==='GET'&&request.url==='/status'){response.end(JSON.stringify(await status()));return;}
        if(request.method==='POST'&&request.url==='/stop'){response.end(JSON.stringify({status:'stopping'}));setImmediate(()=>close().catch(()=>{}));return;}
        response.writeHead(404);response.end(JSON.stringify({code:'SHADOW_ROUTE_NOT_FOUND'}));
      }catch{response.writeHead(503);response.end(JSON.stringify({code:'SHADOW_STATUS_UNAVAILABLE'}));}
    });
    await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(config.control_port,'127.0.0.1',resolve);});
    await status();return {root,state,api,ml_url:mlUrl,control_url:`http://127.0.0.1:${config.control_port}`,status,close};
  }catch{await close();throw fail();}
}

export async function runtimeControl(input,action){
  const root=await ownedRoot(input);await validateOwner(root);if(!['status','stop'].includes(action))throw fail();
  const config=await readPrivateJson(join(root,'config.json'),4096),token=await readModelPrivateFile(join(root,'control.token'),64);
  try{const response=await fetch(`http://127.0.0.1:${config.control_port}/${action}`,{method:action==='stop'?'POST':'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)throw fail();return await response.json();
  }catch{if(action==='status')return {status:'stopped_or_unavailable',enforcement:false};throw fail();}
}
export async function main(args=process.argv.slice(2)){
  try{
    const {values,positionals}=parseArgs({args,allowPositionals:true,options:{root:{type:'string'},'api-port':{type:'string'},'ml-port':{type:'string'},'control-port':{type:'string'}}});
    if(positionals.length!==1||!values.root)throw fail();const action=positionals[0];
    if(action==='init'){
      const ports={api_port:Number(values['api-port']??18511),ml_port:Number(values['ml-port']??18512),control_port:Number(values['control-port']??18513)};
      console.info(JSON.stringify(await initializeShadowRuntime(values.root,ports)));return 0;
    }
    if(Object.keys(values).join(',')!=='root')throw fail();
    if(action==='start'){
      const runtime=await openShadowRuntime(values.root);console.info(JSON.stringify({status:'started',scope:'local_synthetic_shadow',api_url:runtime.api.url,ml_url:runtime.ml_url,enforcement:false}));
      process.once('SIGINT',()=>runtime.close().catch(()=>{process.exitCode=1;}));process.once('SIGTERM',()=>runtime.close().catch(()=>{process.exitCode=1;}));return 0;
    }
    console.info(JSON.stringify(await runtimeControl(values.root,action)));return 0;
  }catch{console.error('SHADOW_RUNTIME_FAILED; private diagnostics withheld.');return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
