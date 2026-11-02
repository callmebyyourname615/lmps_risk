/** Unit assertions never substitute for the parent-host native case. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expectedDto, assertHttpDto, assertHttpRuntimeReceipt, verifyFeatureCacheAcceptance, ownedApiHandles } from '../scripts/feature-cache-acceptance.mjs';
import { assertObservation } from '../scripts/feature-cache-compare.mjs';
import { ownedProcessHandles } from '../scripts/feature-cache-runtime.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const encode=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
const sha=v=>createHash('sha256').update(v).digest('hex');
const fixed=[['11','14.11',null],['11','13.14',null],[null,null,'INPUT_MISSING'],[null,null,'HISTORY_INCOMPLETE'],['11','13.14',null],['1','7.00',null]];
const scope={workspace_key:'synthetic_final',version:'synthetic-feature-serving-1',policy:{max_age_seconds:3600},plan:{queries:Array.from({length:6},()=>({as_of:'2026-01-01T12:00:00Z'}))}};
const publication={scope,generation:2,content_hash:'a'.repeat(64)};
test('unit final original and extended fixture oracle, scope and DTO boundaries',()=>{
 for(const [i,[count,amount,reason]] of fixed.entries()){
  const dto=expectedDto(publication,i);
  assert.deepEqual([dto.count,dto.amount,dto.reason],[count,amount,reason]);
  assert.deepEqual(dto.freshness,{as_of:'2026-01-01T12:00:00Z',now:'2026-01-01T12:02:00Z',source_age_seconds:120,max_age_seconds:3600});
  assertHttpDto(dto,{...dto,count,amount,reason});
  for(const change of [{count:'0'},{amount:'0.00'},{mode:'real'},{source:{generation:1,content_hash:publication.content_hash}},{workspace_key:'foreign'},{raw_events:[]}])assert.throws(()=>assertHttpDto({...dto,...change},dto));
  const observation={status:reason?'unavailable':'available',count,amount,reason,request:{version:scope.version,workspace_key:scope.workspace_key,plan:scope.plan,policy:scope.policy},provenance:reason?null:{publication}};
  assertObservation(observation,i,2);
  if(!reason)for(const field of ['workspace_key','version','plan','policy']){
   const changed=structuredClone(observation);changed.provenance.publication.scope[field]=field==='plan'||field==='policy'?{}:'foreign';
   assert.throws(()=>assertObservation(changed,i,2));
  }
 }
 for(const reason of ['SOURCE_STALE','PUBLICATION_EXPIRED','CACHE_UNAVAILABLE','CACHE_INVALID','GENERATION_TOO_OLD','PUBLICATION_MISSING','HISTORY_INCOMPLETE']){
  const dto=expectedDto(publication,0,reason);assert.deepEqual([dto.status,dto.count,dto.amount,dto.source,dto.coverage],['unavailable',null,null,null,'unavailable']);
  assert.throws(()=>assertHttpDto({...dto,count:'0',amount:'0.00'},dto));
 }
 const zero=expectedDto(publication,0,null,undefined,true);assert.deepEqual([zero.status,zero.count,zero.amount],['available','0','0.00']);
});
test('unit final runtime provenance and cleanup cannot be inferred from counters',()=>{
 const receipt={format:1,mode:'local_synthetic',unit_only:false,native_acceptance:false,production_ready:false,state:'unavailable',cleanup_verified:true,requests:64,outputBytes:65536,binarySha256:'48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', ''),configSha256:'b'.repeat(64)};
 assertHttpRuntimeReceipt(receipt,0);assertHttpRuntimeReceipt({...receipt,state:'stopped'},1);
 for(const change of [{cleanup_verified:false},{state:'ready'},{mode:'real'},{unit_only:true},{native_acceptance:true},{binarySha256:'0'.repeat(64)},{requests:65},{outputBytes:65537}])assert.throws(()=>assertHttpRuntimeReceipt({...receipt,...change},0));
 assert.equal(ownedApiHandles(),0);assert.equal(ownedProcessHandles().length,0);
});
test('parent-host final native execution and persisted acceptance tamper regression',{timeout:180000},async()=>{
 mkdirSync(join(root,'.local'),{recursive:true,mode:0o700});
 const output=join(root,'.local/feature-final-'+randomUUID());
 const script=fileURLToPath(new URL('../scripts/feature-cache-acceptance.mjs',import.meta.url));
 try{
  const child=await promisify(execFile)(process.execPath,[script,'--output',output],{timeout:175000,maxBuffer:4096,env:{PATH:process.env.PATH}});
  assert.equal(child.stderr,'');assert.equal(child.stdout,'Local synthetic acceptance verified; production_ready=false.\n');
  const accepted=await verifyFeatureCacheAcceptance(output);
  assert.equal(accepted.native_acceptance,true);assert.equal(accepted.cleanup_verified,true);assert.equal(accepted.production_ready,false);
  const nativePublication=JSON.parse(readFileSync(join(output,'comparison/baseline/store/publication.json'))).publication;
  async function rejectMutation(relative,mutate,rebind=false){
   const path=join(output,relative),before=readFileSync(path),receiptPath=join(output,'acceptance.json'),receiptBefore=readFileSync(receiptPath);
   try{
    const next=mutate(JSON.parse(before));
    if(next===null)rmSync(path);else writeFileSync(path,encode(next),{mode:0o600});
    if(rebind){const r=JSON.parse(receiptBefore);r.files[relative]=sha(readFileSync(path));writeFileSync(receiptPath,encode(r),{mode:0o600});}
    await assert.rejects(verifyFeatureCacheAcceptance(output),relative);
   }finally{writeFileSync(path,before,{mode:0o600});writeFileSync(receiptPath,receiptBefore,{mode:0o600});}
  }
  await rejectMutation('acceptance.json',r=>({...r,mode:'real'}));
  await rejectMutation('acceptance.json',r=>({...r,cleanup_verified:false}));
  await rejectMutation('acceptance.json',r=>({...r,source_hashes:{stale:'0'.repeat(64)}}));
  await rejectMutation('acceptance.json',r=>({...r,runtime_hash:'0'.repeat(64)}));
  await rejectMutation('comparison/baseline/store/publication.json',()=>null);
  await rejectMutation('comparison/baseline/store/publication.json',r=>({...r,publication:{...r.publication,generation:999}}));
  // Rebind outer hashes: semantic HTTP validation must still reject forged DTO evidence.
  await rejectMutation('http.json',r=>{r.records[4].dto_hash=sha(encode({...expectedDto(nativePublication),amount:'14.10'}));return r;},true);
  await rejectMutation('http.json',r=>{r.records[4].bytes++;return r;},true);
  await rejectMutation('http.json',r=>{r.runtimes[0].cleanup_verified=false;return r;},true);
  await rejectMutation('http.json',r=>{r.runtimes[1].binarySha256='0'.repeat(64);return r;},true);
  await verifyFeatureCacheAcceptance(output);
  assert.equal(ownedApiHandles(),0);assert.equal(ownedProcessHandles().length,0);
  // Parent OS process inspection remains necessary: local counters cannot see child leaks.
 }finally{rmSync(output,{recursive:true,force:true});}
});
