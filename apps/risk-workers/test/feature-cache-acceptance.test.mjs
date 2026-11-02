import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, expectedDto, assertHttpDto, assertHttpRuntimeReceipt, runFeatureCacheAcceptance, verifyFeatureCacheAcceptance, ownedApiHandles } from '../scripts/feature-cache-acceptance.mjs';
import { ownedProcessHandles } from '../scripts/feature-cache-runtime.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(new URL('../scripts/feature-cache-acceptance.mjs',import.meta.url));
const scope={version:'synthetic-feature-serving-1',policy:{max_age_seconds:3600},plan:{queries:[{as_of:'2026-01-01T12:00:00Z'}]}};
const p={scope,generation:2,content_hash:'synthetic_hash'};
test('runtime evidence rejects pin changes and uncertain cleanup; no unit receipt proves native execution',()=>{
 const r={format:1,mode:'local_synthetic',unit_only:false,native_acceptance:false,production_ready:false,state:'unavailable',cleanup_verified:true,requests:16,outputBytes:0,binarySha256:'48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', ''),configSha256:'a'.repeat(64)};
 assertHttpRuntimeReceipt(r,0);assertHttpRuntimeReceipt({...r,state:'stopped'},1);
 for(const change of [{cleanup_verified:false},{unit_only:true},{native_acceptance:true},{binarySha256:'b'.repeat(64)},{configSha256:'bad'},{requests:0},{requests:65},{outputBytes:65537},{state:'ready'},{extra:true}])assert.throws(()=>assertHttpRuntimeReceipt({...r,...change},0));
});
test('imports and invalid public CLI are inert with redacted diagnostics',()=>{
 execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/feature-cache-acceptance.mjs',import.meta.url).href)})`],{timeout:10000});
 for(const args of [[],['--fake'],['--output','/tmp/foreign'],['--output',root+'.local/../foreign'],['--output',root+'.local/good','--receipt','forged'],['--verify-stage','/tmp/foreign','../../bad']]){
  assert.throws(()=>parseCli(args));const child=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(child.stderr,'Feature cache acceptance failed; no acceptance claim.\n');
 }
 assert.equal(ownedApiHandles(),0);assert.equal(ownedProcessHandles().length,0);
});
test('exact DTO oracle rejects arithmetic, freshness, coverage, provenance and raw fields',()=>{
 const expected=expectedDto(p);assertHttpDto(structuredClone(expected),expected);
 assert.deepEqual([expected.count,expected.amount,expected.coverage],['11','14.11','complete']);
 for(const mutation of [d=>d.count='0',d=>d.amount='14.10',d=>d.coverage='unavailable',d=>d.source.generation=1,d=>d.source.content_hash='forged',d=>d.freshness.source_age_seconds=0,d=>d.version='real',d=>d.publication={raw:'private'},d=>d.mode='real',d=>d.production_ready=true]){const d=structuredClone(expected);mutation(d);assert.throws(()=>assertHttpDto(d,expected));}
 for(const reason of ['SOURCE_STALE','PUBLICATION_EXPIRED','CACHE_UNAVAILABLE','CACHE_INVALID','HISTORY_INCOMPLETE','PUBLICATION_MISSING']){const d=expectedDto(p,0,reason);assert.deepEqual([d.count,d.amount,d.source,d.coverage],[null,null,null,'unavailable']);assert.throws(()=>assertHttpDto({...d,count:'0'},d));}
 const zero=expectedDto(p,0,null,undefined,true);assert.deepEqual([zero.count,zero.amount,zero.status],['0','0.00','available']);assert.throws(()=>expectedDto(p,8));
});
test('strict API rejects success seams and accessors before any native work',async()=>{
 for(const options of [{output:'/tmp/foreign'},{output:root+'.local/good',runner:()=>true},{output:root+'.local/good',receipt:{native_acceptance:true}},{output:root+'.local/good',env:{}},Object.create({output:root+'.local/good'}),{get output(){assert.fail('getter invoked');}}])await assert.rejects(runFeatureCacheAcceptance(options));
 assert.equal(ownedApiHandles(),0);assert.equal(ownedProcessHandles().length,0);
});
test('forged HTTP reports and cleanup claims, missing evidence, symlinks and overwrite fail closed',async()=>{
 mkdirSync(join(root,'.local'),{recursive:true,mode:0o700});const dir=mkdtempSync(join(root,'.local/cache-accept-unit-'));
 try{
  const output=join(dir,'forged');mkdirSync(output,{mode:0o700});
  writeFileSync(join(output,'http.json'),JSON.stringify({records:[],runtimes:[{cleanup_verified:true}]}),{mode:0o600});
  for(const change of [{},{cleanup_verified:false},{source_hashes:{forged:true}},{native_acceptance:true}]){
   writeFileSync(join(output,'acceptance.json'),JSON.stringify({version:1,mode:'local_synthetic',production_ready:false,native_acceptance:true,cleanup_verified:true,files:{},source_hashes:{},elapsed_ms:1,...change}),{mode:0o600});await assert.rejects(verifyFeatureCacheAcceptance(output));
  }
  await assert.rejects(runFeatureCacheAcceptance({output}));symlinkSync(output,join(dir,'link'));await assert.rejects(verifyFeatureCacheAcceptance(join(dir,'link')));await assert.rejects(runFeatureCacheAcceptance({output:join(dir,'link/new')}));
 }finally{rmSync(dir,{recursive:true,force:true});}
 assert.equal(ownedApiHandles(),0);assert.equal(ownedProcessHandles().length,0);
});
