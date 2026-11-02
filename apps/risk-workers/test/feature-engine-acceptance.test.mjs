import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArguments,runFeatureEngineAcceptance,verifyFeatureEngineAcceptance} from '../scripts/feature-engine-acceptance.mjs';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const script=join(ROOT,'apps/risk-workers/scripts/feature-engine-acceptance.mjs');
const failure={code:'FEATURE_ENGINE_ACCEPTANCE_FAILED'};
const child=args=>spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,maxBuffer:8192});
test('import and invalid CLI are inert and disclose only fixed codes',async()=>{
 const r=child(['--input-type=module','-e',`await import(${JSON.stringify(script)})`]);
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
 const output=join(ROOT,'.local/acceptance-absent-unit');
 assert.deepEqual(parseArguments(['--output',output]),{output});
 for(const args of [[],['--output'],['--output','/tmp/private'],['--output','.local/x'],['--output',output+'/../x'],['--output',output,'--runner','secret'],['--receipt','secret'],['--verify',output]]){
  assert.throws(()=>parseArguments(args),failure);const c=child([script,...args]);assert.equal(c.status,1);assert.equal(c.stdout,'');assert.equal(c.stderr,'FEATURE_ENGINE_ACCEPTANCE_FAILED\n');
 }
 for(const o of [{output,runner:()=>true},{output,receipt:{}},{output,success:true}])await assert.rejects(runFeatureEngineAcceptance(o),failure);
 let calls=0;const o={};Object.defineProperty(o,'output',{enumerable:true,get(){calls++;return output;}});await assert.rejects(runFeatureEngineAcceptance(o),failure);assert.equal(calls,0);
 await assert.rejects(lstat(output),{code:'ENOENT'});
});
test('real default rejection preserves existing output and cannot accept forged evidence',async()=>{
 const base=await mkdtemp(join(ROOT,'.local/engine-accept-unit-'));
 try{
 const path=join(base,'existing');await mkdir(path,{mode:0o700});const sentinel=join(path,'acceptance.json');await writeFile(sentinel,'{"success":true}',{mode:0o600});
 const before=await readFile(sentinel);await assert.rejects(runFeatureEngineAcceptance({output:path}),failure);assert.deepEqual(await readFile(sentinel),before);
 await assert.rejects(verifyFeatureEngineAcceptance(path),failure);
 await symlink(path,join(base,'linked'));await assert.rejects(runFeatureEngineAcceptance({output:join(base,'linked')}),failure);await assert.rejects(verifyFeatureEngineAcceptance(join(base,'linked')),failure);
 const c=child(['--input-type=module','-e',`const m=await import(${JSON.stringify(script)});try{await m.verifyFeatureEngineAcceptance(${JSON.stringify(path)});process.exitCode=2}catch(e){if(e.code!=='FEATURE_ENGINE_ACCEPTANCE_FAILED')throw e}`]);assert.equal(c.status,0,c.stderr);
 assert.deepEqual(await readFile(sentinel),before);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('internal module doubles exercise failed comparison and cleanup uncertainty, never native proof',()=>{
 // Only Node's internal test loader supplies doubles; the public API has no seam.
 const code=`import {mock} from 'node:test';
 import assert from 'node:assert/strict';
 import {mkdtemp,mkdir,writeFile,lstat,rm} from 'node:fs/promises';
 import {join} from 'node:path';
 let mode='failure',handles=[];
 mock.module(${JSON.stringify(join(ROOT,'apps/risk-workers/scripts/feature-streams-candidate.mjs'))},{namedExports:{canonical:JSON.stringify,ownedStreamsProcessHandles:()=>[]}});
 mock.module(${JSON.stringify(join(ROOT,'apps/risk-workers/scripts/cdc-runtime.mjs'))},{namedExports:{verifyRuntime:async()=>{},ownedProcessHandles:()=>handles}});
 mock.module(${JSON.stringify(join(ROOT,'apps/risk-workers/scripts/feature-engine-compare.mjs'))},{namedExports:{
 parseArguments:args=>({output:args[1]}),
 readComparisonFile:async p=>{const {readFile}=await import('node:fs/promises');return readFile(p)},
 runFeatureEngineComparison:async({output})=>{if(mode==='failure')throw Error('private');await mkdir(output,{mode:448});await writeFile(join(output,'comparison.json'),JSON.stringify({status:'matched_supported_semantics',matched_queries:8,owned_processes:0,evidence:{bytes:0}}));},
 verifyFeatureEngineComparison:async()=>{if(mode==='mismatch')throw Error('mismatch');handles=[{}];}
 }});
 const m=await import(${JSON.stringify(script)});
 const base=await mkdtemp(${JSON.stringify(join(ROOT,'.local/accept-loader-'))});
 try{for(mode of ['failure','mismatch','cleanup']){handles=[];const output=join(base,mode);await assert.rejects(m.runFeatureEngineAcceptance({output}),{code:'FEATURE_ENGINE_ACCEPTANCE_FAILED'});await assert.rejects(lstat(join(output,'acceptance.json')),{code:'ENOENT'});}}finally{await rm(base,{recursive:true,force:true});}`;
 const c=child(['--experimental-test-module-mocks','--input-type=module','-e',code]);assert.equal(c.status,0,c.stderr);
});
