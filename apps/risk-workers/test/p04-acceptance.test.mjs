import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArguments, runP04Acceptance, verifyP04Acceptance, assertP04ParityObservations, assertP04ClosedTrial } from '../scripts/p04-acceptance.mjs';
import { canonical, runtimeBinding, compare } from '../scripts/feature-parity.mjs';
import { FEATURE_PARITY_VERSION as version, FEATURE_PARITY_SEMANTICS as semantics, featureParityInputHash } from '../../../packages/contracts/dist/feature-parity.js';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url))),script=join(root,'apps/risk-workers/scripts/p04-acceptance.mjs');
test('pure cleanup assertion refuses uncertain closure, timeout, signal and failed child; no native proof',()=>{
 assertP04ClosedTrial(0,null,false,175000);
 for(const args of [[1,null,false,1],[0,'SIGTERM',false,1],[0,null,true,1],[0,null,null,1],[0,null,false,175001],[0,null,false,NaN],[0,null,false,-1]])assert.throws(()=>assertP04ClosedTrial(...args));
});
function directory(){mkdirSync(join(root,'.local'),{recursive:true,mode:0o700});return mkdtempSync(join(root,'.local/p04-unit-'));}
test('import and strict CLI are inert; no runner, receipt, environment or unsafe output inputs',()=>{
 const p=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(script)});`],{encoding:'utf8',timeout:5000});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,'');
 for(const args of [[],['--runner','fake'],['--receipt','fake'],['--output','/tmp/unsafe'],['--output',root+'/.local/../unsafe'],['--output',root+'/.local/a b'],['--output',root+'/.local/x','--fake']]){
  assert.throws(()=>parseArguments(args));const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});assert.notEqual(r.status,0);assert.equal(r.stderr,'P04_ACCEPTANCE_FAILED\n');
 }
 assert.deepEqual(parseArguments(['--output',join(root,'.local/new-output')]),{output:join(root,'.local/new-output')});
});
test('scope/options/accessors/symbols, existing and linked destinations fail before phases',async()=>{
 const dir=directory();try{
  let calls=0;for(const o of [{output:dir,runner:()=>{}},{get output(){calls++;return dir;}},Object.assign(Object.create(null),{output:dir}),{output:dir,[Symbol('receipt')]:true}])await assert.rejects(runP04Acceptance(o));assert.equal(calls,0);
  writeFileSync(join(dir,'sentinel'),'keep',{mode:0o600});await assert.rejects(runP04Acceptance({output:dir}));assert.equal(readFileSync(join(dir,'sentinel'),'utf8'),'keep');
  const link=join(dir,'linked');symlinkSync(dir,link);await assert.rejects(runP04Acceptance({output:join(link,'new')}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing, forged nested success, changed provenance, cleanup uncertainty never accept',async()=>{
 const dir=directory();try{
  await assert.rejects(verifyP04Acceptance(dir));
  for(const value of [ {},{version:1,production_ready:false,owned_processes:0,source_hashes:{},evidence_hashes:{},receipt:{success:true,cleanup_verified:true}}, {production_ready:false,owned_processes:1,source_hashes:{}} ]){
   writeFileSync(join(dir,'acceptance.json'),canonical(value),{mode:0o600});const before=readFileSync(join(dir,'acceptance.json'));await assert.rejects(verifyP04Acceptance(dir));assert.deepEqual(readFileSync(join(dir,'acceptance.json')),before);
  }
  const r=spawnSync(process.execPath,[script,'--verify',dir],{encoding:'utf8',timeout:10000});assert.notEqual(r.status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('actual Python/TS independent original/correction/currency/missing/future/zero cohort assertions; wrong outputs cannot pass',async()=>{
 const dir=directory();try{
  const at='2026-01-01T12:00:00Z',rec=(id,x={})=>({event_id:'synthetic_'+id,key:'synthetic_key',currency:'USD',revision:0,source_position:0,occurred_at:at,available_at:at,availability_sha256:'a'.repeat(64),record_sha256:'b'.repeat(64),amount:'1.25',active:true,...x});
  const records=[rec('a'),rec('a',{revision:1,amount:'2.50'}),rec('a',{revision:2,amount:'99.00',available_at:'2026-01-01T12:00:01Z'}),rec('b',{currency:'EUR',amount:'7.00'}),rec('c',{available_at:null,availability_sha256:null}),rec('d',{available_at:'2026-01-01T12:00:01Z'})].map((r,source_position)=>({...r,source_position}));
  const input={version,mode:'local_synthetic',records},q=(id,ids,x={})=>({id:'synthetic_'+id,key:'synthetic_key',currency:'USD',as_of:at,anchor_at:at,window_seconds:3600,member_ids:ids.map(x=>'synthetic_'+x),...x});
  const plan={version,mode:'local_synthetic',input_sha256:featureParityInputHash(input),semantics,runtime:runtimeBinding(),fixture:{now:at,retention_seconds:3600,coverage:'explicit_cohort_only'},queries:[q('usd',['a']),q('eur',['b'],{currency:'EUR'}),q('missing',['c']),q('zero',[]),q('future',['d'])]};
  const source=join(dir,'input.json'),path=join(dir,'plan.json');writeFileSync(source,canonical(input),{mode:0o600});writeFileSync(path,canonical(plan),{mode:0o600});
  const actual=await compare(source,path);await assertP04ParityObservations(plan,input,actual);
  for(const mutate of [r=>{r.provenance={};},r=>{r.source_sha256='0'.repeat(64);},r=>r.online[0].amount='99.00',r=>{r.online[0].amount=r.offline[0].amount='99.00';},r=>{r.online[0].cohort_sha256=r.offline[0].cohort_sha256='0'.repeat(64);},r=>{r.online[0].runtime.python=r.offline[0].runtime.python='fake';},r=>{r.online[1].query.currency=r.offline[1].query.currency='USD';},r=>{r.online[2].status=r.offline[2].status='available';},r=>{r.production_ready=true;},r=>{r.report={success:true};}]){
   const wrong=structuredClone(actual);mutate(wrong);await assert.rejects(assertP04ParityObservations(plan,input,wrong));
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
