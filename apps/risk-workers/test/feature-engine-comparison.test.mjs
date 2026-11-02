import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compareFeatureOutputs} from '../scripts/feature-engine-compare.mjs';
import {loadFeatureEngineInput,canonical,ownedStreamsProcessHandles} from '../scripts/feature-streams-candidate.mjs';
import {validateFeatureEnginePlan,validateFeatureEngineReport,featureEnginePlanHash} from '../../../packages/contracts/dist/feature-engine-comparison.js';
import {openFeatureContributionWorker} from '../dist/feature-contribution-worker.js';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const fields=['attempt_count','attempt_amount','gross_count','gross_amount','reversed_count','reversed_amount','net_active_count','net_amount'];
const vectors=[['12','2312','12','2312','2','901','11','1411'],['12','2215','12','2215','2','901','11','1314'],['12','2215','12','2215','2','901','11','1314'],['1','700','1','700','0','0','1','700'],['2','2000','1','800','1','800','0','0'],['1','200','1','200','0','0','1','200'],null,Array(8).fill('0')];
// Fabricated native-shaped evidence exercises the pure comparison seam only.
// It is never supplied to a public runner and cannot publish native acceptance.
async function fixture(){
 const input=await loadFeatureEngineInput();
 const rows=n=>input.records.slice(0,n).map((r,position)=>({position,value:canonical(r)}));
 const result=i=>vectors[i]===null?{status:'unavailable',reason:'UNKNOWN_REVERSAL'}:{status:'available',vector:Object.fromEntries(fields.map((k,j)=>[k,vectors[i][j]]))};
 const phase=prefix=>({phase:prefix?'prefix':'final',prefix_before:rows(prefix?0:13),rows:rows(prefix?13:26),physical_end_offset:prefix?13:39,last_processed_offset:prefix?12:38,sent_records:prefix?13:26,snapshots:prefix?[]:input.plan.queries.map((q,i)=>({query_id:q.id,result:result(i)})),topology:'exact-position-revisions (stores: [exact-revisions])',clean_close:true});
 const original=Array.from({length:6},()=>({count:null,amount:null,reason:'INPUT_MISSING'}));original[3].reason='HISTORY_INCOMPLETE';
 for(const [i,k]of [0,1,4,5].entries()){const q=input.plan.queries[i];original[k]={query:{as_of:q.as_of,currency:q.currency},window_end:q.anchor_at,count:i===3?'1':'11',amount:['14.11','13.14','13.14','7.00'][i],reason:null};}
 return {input,prefix:phase(true),final:phase(false),original,extended:[4,5,6,7].map(result)};
}
const compare=f=>compareFeatureOutputs(f.input,f.prefix,f.final,f.original,f.extended);
test('finite frozen burst compares actual bounded outputs and rejects independent contamination',async()=>{
 const f=await fixture(),data=JSON.parse(await readFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json')));
 const base=await mkdtemp(join(ROOT,'.local/comparison-regression-'));let w;
 try{
  const path=join(base,'worker');w=openFeatureContributionWorker(path,data.policy);
  for(const d of data.deliveries.slice(0,3))w.consume(d);
  const prefix=w.receipt();w.close();w=openFeatureContributionWorker(path,data.policy);
  for(const d of data.deliveries.slice(0,3))w.consume(d);assert.deepEqual(w.receipt(),prefix);
  for(const d of data.deliveries.slice(3))w.consume(d);
  assert.equal(w.receipt().next_offset,8);assert.equal(w.receipt().deliveries,8);
  f.extended=data.queries.map(q=>w.materialize(q).result);
  assert.deepEqual(fields.map(k=>f.extended[0].vector[k]),['2','2000','1','800','1','800','0','0']);
  assert.equal(f.extended[1].vector.net_amount,'200');
  assert.deepEqual(f.extended[2],{status:'unavailable',reason:'UNKNOWN_REVERSAL'});
  const result=compare(f);assert.equal(result.matched_queries,8);assert.equal(result.production_ready,false);
  for(const name of ['unclean_crash','burst_beyond_frozen_fixture','native_ttl_admission','native_changed_duplicate_trial'])assert.ok(result.unsupported.includes(name));
  assert.equal(Object.hasOwn(result,'native_acceptance'),false);
  for(const mutate of [
   x=>x.extended[0].vector.net_amount='200',x=>x.extended[1].vector.net_amount='800',
   x=>x.input.plan.queries[0].currency='USD',x=>x.input.plan.semantics.lifecycle='other',
   x=>x.input.records[0].run_id='synthetic_other',x=>x.final.rows[0].value='{}',
   x=>x.final.snapshots[0].query_id='synthetic_other',x=>x.final.last_processed_offset--,
   x=>x.input.records.push(x.input.records[0]),
  ]){const changed=structuredClone(f);mutate(changed);assert.throws(()=>compare(changed),{code:'FEATURE_COMPARE_FAILED'});}
 }finally{w?.close();await rm(base,{recursive:true,force:true});}
 assert.equal(ownedStreamsProcessHandles().length,0);
});
test('single hot key eight-record burst: exact bound, durable replay and one-over rejection',async()=>{
 const data=JSON.parse(await readFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json')));
 const base=await mkdtemp(join(ROOT,'.local/comparison-hot-'));let w;
 const deliveries=Array.from({length:8},(_,position)=>({position,revision:{...data.deliveries[2].revision,payment_id:`synthetic_p${position}`,attempt_id:`synthetic_a${position}`,revision_id:`synthetic_r${position}`,revision_number:1}}));
 try{
  const path=join(base,'worker');w=openFeatureContributionWorker(path,data.policy);
  for(const d of deliveries.slice(0,4))w.consume(d);
  const prefix=w.receipt();w.close();
  const prefixBytes=await readFile(join(path,'publication.json'));
  w=openFeatureContributionWorker(path,data.policy);
  for(const d of deliveries.slice(0,4))w.consume(d);assert.deepEqual(w.receipt(),prefix);
  assert.deepEqual(await readFile(join(path,'publication.json')),prefixBytes);
  for(const d of deliveries.slice(4))w.consume(d);
  const before=w.receipt();assert.equal(before.next_offset,8);assert.equal(before.deliveries,8);
  const rejected=w.consume({...deliveries[0],position:8});assert.equal(rejected.status,'rejected');assert.equal(rejected.reason,'LIMIT_EXCEEDED');assert.deepEqual(w.receipt(),before);
  assert.deepEqual(fields.map(k=>w.materialize(data.queries[0]).result.vector[k]),['8','8000','8','8000','0','0','8','8000']);
  assert.deepEqual(fields.map(k=>w.materialize(data.queries[1]).result.vector[k]),Array(8).fill('0'));
  const saved=w.receipt();w.close();
  const savedBytes=await readFile(join(path,'publication.json'));
  w=openFeatureContributionWorker(path,data.policy);
  for(const d of deliveries)w.consume(d);assert.deepEqual(w.receipt(),saved);
  assert.deepEqual(await readFile(join(path,'publication.json')),savedBytes);
  const disk=JSON.parse(await readFile(join(path,'publication.json')));
  assert.equal(disk.publication.state.contributions.evidence.deliveries.length,8);
  assert.equal(disk.publication.state.active.positions.length,8);
  // The real comparison seam must refuse this alternate hot-key corpus;
  // bounded-worker coverage cannot silently become native parity evidence.
  const alternate=await fixture();alternate.input.records=deliveries;
  assert.throws(()=>compare(alternate),{code:'FEATURE_COMPARE_FAILED'});
  w.close();w=null;
  assert.throws(()=>openFeatureContributionWorker(path,{...data.policy,run_id:'synthetic_other'}));
 }finally{w?.close();await rm(base,{recursive:true,force:true});}
});
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
async function reportFixture(){
 const {plan}=await loadFeatureEngineInput();
 const outputs=plan.queries.map(q=>({query_id:q.id,result:{status:'available',vector:Object.fromEntries(fields.map(k=>[k,'0']))}}));
 const h='a'.repeat(64);
 // Illustrative contract evidence only: these numbers are not measurements.
 return {version:plan.version,mode:'local_synthetic',production_ready:false,acceptance:'pending_independent_native_verification',plan,expected:outputs,
 trials:plan.candidates.map(candidate=>({candidate,status:'observed',failure:null,binding:{plan_sha256:featureEnginePlanHash(plan),runtime:plan.runtime,source_before:h,source_after:h,compiled_before:h,compiled_after:h,input_before:hash(plan.corpora),input_after:hash(plan.corpora),evidence_sha256:h},outputs:structuredClone(outputs),recovery:{prefix_position:13,replay_records:13,final_position:26,state_sha256:h,owned_processes:0},observations:{setup_ms:0,processing_ms:150000,teardown_ms:30000,elapsed_ms:180000,peak_scratch_bytes:0,retained_evidence_bytes:0,state_bytes:0,process_output_bytes:0}})),comparisons:plan.queries.map(q=>({query_id:q.id,status:'match'})),status:'matched_observations'};
}
test('plan/report exact and one-over input/state/evidence/time; cross-run binding and unsupported',async()=>{
 const invalid={code:'FEATURE_ENGINE_COMPARISON_INVALID'};
 const r=await reportFixture();assert.equal(validateFeatureEngineReport(r).acceptance,'pending_independent_native_verification');
 // Preserve the total exactly while exceeding processing's teardown-reserved
 // allowance by one millisecond. This is arithmetic validation, not a timer.
 const reserve=structuredClone(r);
 reserve.trials[0].observations.processing_ms++;
 reserve.trials[0].observations.teardown_ms--;
 assert.throws(()=>validateFeatureEngineReport(reserve),invalid);
 for(const [field,budget] of [['state_bytes','state_bytes'],['retained_evidence_bytes','evidence_bytes'],['peak_scratch_bytes','scratch_bytes'],['process_output_bytes','process_output_bytes']]){
  const x=structuredClone(r);x.trials[0].observations[field]=x.plan.budgets[budget];assert.doesNotThrow(()=>validateFeatureEngineReport(x));x.trials[0].observations[field]++;assert.throws(()=>validateFeatureEngineReport(x),invalid);
 }
 const p=structuredClone(r.plan);p.corpora[0].records=1992;p.recovery={...p.recovery,prefix_records:1000,replay_records:1000,suffix_records:1000};assert.doesNotThrow(()=>validateFeatureEnginePlan(p));p.corpora[0].records++;assert.throws(()=>validateFeatureEnginePlan(p),invalid);
 for(const mutate of [x=>x.trials[0].observations.elapsed_ms++,x=>x.plan.run_id='synthetic_other',x=>x.trials[1].outputs[0].query_id='synthetic_other',x=>x.plan.queries[0].currency='ALT',x=>x.plan.runtime.streams='other']){const x=structuredClone(r);mutate(x);assert.throws(()=>validateFeatureEngineReport(x),invalid);}
 const x=structuredClone(r);x.plan.queries[0].eligible=false;for(const t of x.trials)t.binding.plan_sha256=featureEnginePlanHash(x.plan);x.comparisons[0].status='unsupported';x.status='unsupported';assert.equal(validateFeatureEngineReport(x).status,'unsupported');
});
