import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, runFeatureContributionsAcceptance as run, verifyFeatureContributionEvidence as verify } from '../scripts/feature-contributions-acceptance.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),script=join(root,'apps/risk-workers/scripts/feature-contributions-acceptance.mjs');
mkdirSync(join(root,'.local'),{recursive:true,mode:0o700});
const base=mkdtempSync(join(root,'.local/us805-test-'));chmodSync(base,0o700);
test.after(()=>rmSync(base,{recursive:true,force:true}));
test('import and invalid CLI are inert; strict normalized private project output only',async()=>{
 const before=readdirSync(base);
 const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/feature-contributions-acceptance.mjs',import.meta.url).href)})`],{cwd:base,encoding:'utf8'});
 assert.equal(imported.status,0);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
 for(const args of [[],['--output'],['--output',join(base,'bad'),'--fake'],['--output','relative'],['--output',base+'/../escape'],['--output',base+'/bad/'],['--runner','fake']]){
  assert.throws(()=>parseArguments(args));const p=spawnSync(process.execPath,[script,...args],{cwd:base,encoding:'utf8'});assert.equal(p.status,1);assert.equal(p.stderr,'FEATURE_CONTRIBUTIONS_ACCEPTANCE_FAILED\n');
 }
 await assert.rejects(run({output:join(base,'injected'),runner:()=>({success:true})}));assert.deepEqual(readdirSync(base),before);
 symlinkSync(base,join(base,'link'));await assert.rejects(run({output:join(base,'link/out')}));unlinkSync(join(base,'link'));
});
test('actual compiled filesystem acceptance; exclusive result, independent recheck and tamper failures',async()=>{
 const output=join(base,'actual');const result=await run({output});assert.equal(result.production_ready,false);assert.equal(result.owned_handles,0);assert.ok(result.evidence.bytes<=16777216);await verify(output);
 const final=readFileSync(join(output,'acceptance.json'));await assert.rejects(run({output}));assert.deepEqual(readFileSync(join(output,'acceptance.json')),final);
 const publication=join(output,'worker/publication.json'),raw=readFileSync(publication);
 for(const mutation of [()=>writeFileSync(publication,'{}'),()=>{const x=JSON.parse(raw);x.publication.state.contributions.evidence.next_position=7;writeFileSync(publication,JSON.stringify(x));},()=>{const x=JSON.parse(raw);x.plan_sha256='0'.repeat(64);writeFileSync(publication,JSON.stringify(x));}]){mutation();await assert.rejects(verify(output));writeFileSync(publication,raw);}
 unlinkSync(publication);await assert.rejects(verify(output));writeFileSync(publication,raw,{mode:0o600});
 const forged=JSON.parse(final);forged.source_hashes['packages/risk/src/feature-contributions.ts']='0'.repeat(64);writeFileSync(join(output,'acceptance.json'),JSON.stringify(forged));await assert.rejects(verify(output));writeFileSync(join(output,'acceptance.json'),final);
 const lock=join(output,'worker/writer.lock');writeFileSync(lock,'forged',{mode:0o600});await assert.rejects(verify(output));unlinkSync(lock);await verify(output);
 assert.ok(readdirSync(output).every(n=>!n.startsWith('.acceptance-')));
});
test('real durable before/after publication fault and cleanup (unit seam only)',async()=>{
 const {openFeatureContributionWorker:open}=await import('../dist/feature-contribution-worker.js');
 const f=JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/p04-extended-golden.json',import.meta.url)));
 for(const point of ['before_publish','after_publish']){
  const path=join(base,point);let w=open(path,f.policy);w.close();const before=readFileSync(join(path,'publication.json'));let armed=true;
  w=open(path,f.policy,at=>{if(armed&&at===point){armed=false;throw Error('unit fault');}});
  try{assert.throws(()=>w.consume(f.deliveries[0]));assert.throws(()=>w.receipt());}finally{w.close();}
  const after=readFileSync(join(path,'publication.json'));assert.equal(before.equals(after),point==='before_publish');
  w=open(path,f.policy);try{assert.equal(w.receipt().next_offset,point==='before_publish'?0:1);w.consume(f.deliveries[0]);assert.equal(w.receipt().next_offset,1);}finally{w.close();}
  assert.deepEqual(readdirSync(path).sort(),['owner.json','publication.json']);
 }
});
test('rehashed forged publication generation and predecessor cannot verify',async()=>{
 const output=join(base,'rehashed'),report=await run({output});
 const {featureGroupedHash}=await import('@lmps/contracts/feature-catalog');
 for(const mutate of [x=>{x.publication.generation=999;},x=>{x.publication.predecessor.content_hash='0'.repeat(64);},x=>{x.version=99;},x=>{x.publication.state.contributions.evidence.snapshots[0].result.vector.net_amount='1';}]){
  const name='worker/publication.json';
  const path=join(output,name),original=readFileSync(path),changed=JSON.parse(original);
  mutate(changed);
  const {content_hash,...body}=changed.publication;
  changed.publication.content_hash=featureGroupedHash([body]);
  const bytes=Buffer.from(JSON.stringify(changed)),forged=structuredClone(report);
  forged.evidence.hashes[name]=createHash('sha256').update(bytes).digest('hex');
  forged.evidence.bytes+=bytes.length-original.length;
  writeFileSync(path,bytes);writeFileSync(join(output,'acceptance.json'),JSON.stringify(forged));
  await assert.rejects(verify(output));
  writeFileSync(path,original);writeFileSync(join(output,'acceptance.json'),JSON.stringify(report));
 }
 await verify(output);
});
test('actual CLI subprocess publishes once; partial output and unsafe ancestors fail closed',async()=>{
 const output=join(base,'cli');
 const invoke=path=>spawnSync(process.execPath,[script,'--output',path],{cwd:base,encoding:'utf8',timeout:180000});
 const first=invoke(output);assert.equal(first.status,0,first.stderr);assert.equal(first.stdout,'FEATURE_CONTRIBUTIONS_ACCEPTANCE_RECORDED\n');await verify(output);
 const before=readFileSync(join(output,'acceptance.json'));
 assert.equal(invoke(output).status,1);assert.deepEqual(readFileSync(join(output,'acceptance.json')),before);
 const partial=join(base,'partial');mkdirSync(partial,{mode:0o700});
 assert.equal(invoke(partial).status,1);assert.deepEqual(readdirSync(partial),[]);
 const unsafe=join(base,'unsafe');mkdirSync(unsafe,{mode:0o755});
 assert.equal(invoke(join(unsafe,'out')).status,1);assert.deepEqual(readdirSync(unsafe),[]);
 symlinkSync(output,join(base,'output-link'));assert.equal(invoke(join(base,'output-link')).status,1);
 assert.deepEqual(readFileSync(join(output,'acceptance.json')),before);
});
test('strict receipt schema and finite elapsed bound reject forged reports',async()=>{
 const output=join(base,'receipt'),report=await run({output});
 for(const elapsed_ms of ['1',null,-1,0.5,180001]){
  writeFileSync(join(output,'acceptance.json'),JSON.stringify({...report,elapsed_ms}));await assert.rejects(verify(output));
 }
 writeFileSync(join(output,'acceptance.json'),JSON.stringify({...report,success:true}));await assert.rejects(verify(output));
 writeFileSync(join(output,'acceptance.json'),JSON.stringify(report));await verify(output);
});
