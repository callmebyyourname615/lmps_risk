import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertObservation, assertRuntimeReceipt, readFeatureCacheEvidence, parseCli, runFeatureCacheComparison, verifyFeatureCacheComparison } from '../scripts/feature-cache-compare.mjs';
import { ownedProcessHandles } from '../scripts/feature-cache-runtime.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(new URL('../scripts/feature-cache-compare.mjs',import.meta.url));
test('private evidence reads enforce exact byte, link, mode and UTF-8 boundaries',()=>{
  const base=mkdtempSync(join(root,'.local/cache-read-unit-')),file=join(base,'evidence');
  try {
    writeFileSync(file,Buffer.alloc(2097152,97),{mode:0o600}); assert.equal(readFeatureCacheEvidence(file,true).length,2097152);
    writeFileSync(file,Buffer.alloc(2097153,97)); assert.throws(()=>readFeatureCacheEvidence(file,true));
    writeFileSync(file,Buffer.from([255])); assert.throws(()=>readFeatureCacheEvidence(file,true));
    writeFileSync(file,'valid'); chmodSync(file,0o644); assert.throws(()=>readFeatureCacheEvidence(file,true)); chmodSync(file,0o600);
    symlinkSync(file,join(base,'link')); assert.throws(()=>readFeatureCacheEvidence(join(base,'link'),true));
    linkSync(file,join(base,'hardlink')); assert.throws(()=>readFeatureCacheEvidence(file,true));
    assert.throws(()=>readFeatureCacheEvidence('/tmp/foreign',true));
  } finally { rmSync(base,{recursive:true}); }
});
test('finite native receipts reject changed pins, counters, scope and cleanup claims',()=>{
  const pin=JSON.parse(readFileSync(join(root,'apps/risk-workers/fixtures/feature-cache-runtime.json'))).sha256.replaceAll(' ','');
  const valid={format:1,mode:'local_synthetic',unit_only:false,native_acceptance:false,production_ready:false,state:'stopped',cleanup_verified:true,requests:22,outputBytes:0,binarySha256:pin,configSha256:'a'.repeat(64)};
  assertRuntimeReceipt(valid,0); assertRuntimeReceipt({...valid,requests:13},1);
  for(const change of [{format:2},{mode:'live'},{unit_only:true},{native_acceptance:true},{production_ready:true},{cleanup_verified:false},{state:'ready'},{requests:-1},{requests:13},{outputBytes:-1},{outputBytes:65537},{binarySha256:'bad'},{configSha256:'bad'},{extra:true}]) assert.throws(()=>assertRuntimeReceipt({...valid,...change},0));
  assert.throws(()=>assertRuntimeReceipt(valid,2));
});
test('import and strict invalid CLI stay inert and redact diagnostics',()=>{
  execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/feature-cache-compare.mjs',import.meta.url).href)})`]);
  for(const args of [[],['--fake'],['--output','/tmp/foreign'],['--output',root+'.local/../foreign'],['--output',root+'.local/good','--receipt','fake']]) {
    assert.throws(()=>parseCli(args));
    const p=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
    assert.equal(p.status,1); assert.equal(p.stdout,''); assert.equal(p.stderr,'Feature cache comparison failed; no acceptance claim.\n');
  }
  assert.equal(ownedProcessHandles().length,0);
});
test('public API rejects injected success, accessor, runtime and foreign destination before execution',async()=>{
  for(const options of [{output:'/tmp/foreign'}, {output:root+'.local/good',runner:()=>({success:true})}, {output:root+'.local/good',receipt:{}}, Object.create({output:root+'.local/good'}), {get output(){throw Error('accessed');}}]) await assert.rejects(runFeatureCacheComparison(options));
  await assert.rejects(verifyFeatureCacheComparison('/tmp/forged'));
  assert.equal(ownedProcessHandles().length,0);
});
test('independent expected arithmetic, scope, version and unavailable null assertions reject ambiguity',()=>{
  const scope={version:'synthetic-feature-serving-1',workspace_key:'synthetic_test',plan:{id:'fixed'},policy:{version:'fixed'}};
  const request={version:scope.version,workspace_key:scope.workspace_key,plan:scope.plan,policy:scope.policy};
  const good={status:'available',count:'11',amount:'14.11',reason:null,request,provenance:{publication:{generation:2,scope}}};
  assertObservation(good,0,2);
  for(const modify of [r=>r.count='0',r=>r.amount='14.10',r=>r.provenance.publication.generation=1,r=>r.provenance.publication.scope.workspace_key='foreign',r=>r.provenance.publication.scope.version='foreign',r=>r.provenance.publication.scope.plan={id:'other'},r=>r.provenance.publication.scope.policy={version:'other'}]) {
    const r=structuredClone(good); modify(r); assert.throws(()=>assertObservation(r,0,2));
  }
  for(const reason of ['PUBLICATION_MISSING','CACHE_UNAVAILABLE','PUBLICATION_EXPIRED','SOURCE_STALE']) {
    const r={...good,status:'unavailable',reason,count:null,amount:null,provenance:null}; assertObservation(r,0,2,reason);
    assert.throws(()=>assertObservation({...r,count:'0'},0,2,reason));
    assert.throws(()=>assertObservation({...r,provenance:good.provenance},0,2,reason));
    assert.throws(()=>assertObservation({...r,reason:'PUBLICATION_MISSING'},0,2,reason === 'PUBLICATION_MISSING' ? 'CACHE_UNAVAILABLE' : reason));
  }
  assert.throws(()=>assertObservation(good,8,2));
});
test('forged receipts, missing persisted evidence, unsafe destinations and overwrite fail closed',async()=>{
  const base=mkdtempSync(join(root,'.local/cache-compare-unit-'));
  try {
    const output=join(base,'forged'); mkdirSync(output,{mode:0o700});
    writeFileSync(join(output,'comparison.json'),JSON.stringify({native_acceptance:true,production_ready:false,observations:['success']}),{mode:0o600});
    await assert.rejects(verifyFeatureCacheComparison(output));
    mkdirSync(join(output,'baseline'),{mode:0o700});
    await assert.rejects(verifyFeatureCacheComparison(output));
    await assert.rejects(runFeatureCacheComparison({output}));
    const link=join(base,'linked'); symlinkSync(output,link);
    await assert.rejects(runFeatureCacheComparison({output:join(link,'new')}));
    await assert.rejects(verifyFeatureCacheComparison(link));
    assert.equal(ownedProcessHandles().length,0);
  } finally { rmSync(base,{recursive:true}); }
});
