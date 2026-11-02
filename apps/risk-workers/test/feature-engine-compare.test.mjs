import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,symlink,mkdir,lstat} from 'node:fs/promises';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArguments,compareFeatureOutputs,runFeatureEngineComparison,readComparisonFile,verifyFeatureEngineComparison,validateComparisonProvenance,runBoundedOriginalRecovery} from '../scripts/feature-engine-compare.mjs';
import {loadFeatureEngineInput,canonical,ownedStreamsProcessHandles,STREAMS_JAVA_SOURCE} from '../scripts/feature-streams-candidate.mjs';
import {featureEnginePlanHash} from '../../../packages/contracts/dist/feature-engine-comparison.js';
import {createHash} from 'node:crypto';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(new URL('../scripts/feature-engine-compare.mjs',import.meta.url));
const invalid={code:'FEATURE_COMPARE_FAILED'},output=join(ROOT,'.local/compare-unit-absent');
const fields=['attempt_count','attempt_amount','gross_count','gross_amount','reversed_count','reversed_amount','net_active_count','net_amount'];
const values=[['12','2312','12','2312','2','901','11','1411'],['12','2215','12','2215','2','901','11','1314'],['12','2215','12','2215','2','901','11','1314'],['1','700','1','700','0','0','1','700'],['2','2000','1','800','1','800','0','0'],['1','200','1','200','0','0','1','200'],null,Array(8).fill('0')];
// Explicitly fabricated internal validation evidence; never fed to the public runner.
async function fixture(){
 const input=await loadFeatureEngineInput();
 const rows=n=>input.records.slice(0,n).map((r,i)=>({position:i,value:canonical(r)}));
 const result=i=>values[i]===null?{status:'unavailable',reason:'UNKNOWN_REVERSAL'}:{status:'available',vector:Object.fromEntries(fields.map((f,k)=>[f,values[i][k]]))};
 const phase=first=>({phase:first?'prefix':'final',prefix_before:rows(first?0:13),rows:rows(first?13:26),physical_end_offset:first?13:39,last_processed_offset:first?12:38,sent_records:first?13:26,snapshots:first?[]:input.plan.queries.map((q,i)=>({query_id:q.id,result:result(i)})),topology:'exact-position-revisions (stores: [exact-revisions])',clean_close:true});
 const original=Array.from({length:6},()=>({count:null,amount:null,reason:'INPUT_MISSING'}));
 original[3].reason='HISTORY_INCOMPLETE';
 for(const [i,k]of [0,1,4,5].entries()){const q=input.plan.queries[i];original[k]={query:{as_of:q.as_of,currency:q.currency},window_end:q.anchor_at,count:i===3?'1':'11',amount:['14.11','13.14','13.14','7.00'][i],reason:null};}
 return {input,prefix:phase(true),final:phase(false),original,extended:[4,5,6,7].map(result)};
}
const compare=f=>compareFeatureOutputs(f.input,f.prefix,f.final,f.original,f.extended);
test('import and rejected CLI are inert, bounded and payload-free',async()=>{
 const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/feature-engine-compare.mjs',import.meta.url).href)})`],{encoding:'utf8',timeout:5000,maxBuffer:4096});
 assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
 assert.deepEqual(parseArguments(['--output',output]),{output});
 for(const args of [[],['--output'],['--output','/tmp/x'],['--output','.local/x'],['--output',output+'/../x'],['--output',output,'--fake'],['--receipt','secret_payload'],['--runner',output]])assert.throws(()=>parseArguments(args),invalid);
 const cli=spawnSync(process.execPath,[script,'--receipt','secret_payload'],{encoding:'utf8',timeout:5000,maxBuffer:4096});assert.equal(cli.status,1);assert.equal(cli.stdout,'');assert.equal(cli.stderr,'FEATURE_COMPARE_FAILED\n');
 for(const o of [{output,runner:()=>true},{output,receipt:{success:true}},{output,success:true}])await assert.rejects(runFeatureEngineComparison(o),invalid);
 await assert.rejects(lstat(output),{code:'ENOENT'});assert.equal(ownedStreamsProcessHandles().length,0);
});
test('independent golden assertions match only supported semantics and detach inputs',async()=>{
 const f=await fixture(),before=canonical(f),r=compare(f);assert.equal(r.matched_queries,8);assert.equal(r.production_ready,false);assert.equal(Object.hasOwn(r,'native_acceptance'),false);assert.ok(r.unsupported.includes('unclean_crash'));assert.equal(canonical(f),before);
});
test('independent original/extended/replay/currency/availability/state mismatches fail closed',async()=>{
 for(const mutate of [
  f=>f.original[0].amount='14.12',f=>f.original[1].count='12',f=>f.original[2].reason=null,
  f=>f.original[3].amount='0.00',f=>f.original[5].query.currency='SYN',
  f=>f.original[1].query.as_of='2026-01-01T12:00:00Z',
  f=>f.extended[0].vector.net_amount='1',f=>f.extended[1].vector.gross_amount='800',
  f=>f.extended[2]={status:'available',vector:Object.fromEntries(fields.map(k=>[k,'0']))},
  f=>f.final.snapshots[0].result.vector.net_amount='1314',
  f=>f.final.snapshots[7].result.vector.net_amount='99900',
  f=>f.final.prefix_before[0].value='{}',f=>f.prefix.rows.pop(),
  f=>f.final.rows[0].value=canonical({...f.input.records[0],event:{}}),
  f=>f.final.physical_end_offset=26,f=>f.final.last_processed_offset=37,
  f=>f.final.clean_close=false,f=>f.final.rows.push(f.final.rows[0]),
  f=>f.input.plan.runtime.streams='other',f=>f.input.plan.corpora[0].sha256='0'.repeat(64),
  f=>f.final.snapshots=f.extended.map((result,i)=>({query_id:String(i),result})),
  f=>f.final={success:true,expected:values},f=>f.final.rows=undefined,
 ]){const f=await fixture();mutate(f);assert.throws(()=>compare(f));}
});
test('accessors, cycles and oversized evidence do not invoke caller code',async()=>{
 const f=await fixture();let calls=0;Object.defineProperty(f.original[0],'amount',{enumerable:true,get(){calls++;return '14.11';}});assert.throws(()=>compare(f),invalid);assert.equal(calls,0);
 const cyclic=await fixture();cyclic.final.self=cyclic.final;assert.throws(()=>compare(cyclic),invalid);
 const huge=await fixture();huge.final.topology='x'.repeat(2097153);assert.throws(()=>compare(huge),invalid);
});
test('no-follow private reads bound bytes and reject missing, linked or nonprivate evidence',async()=>{
 const base=await mkdtemp(join(ROOT,'.local/compare-unit-'));
 try{const p=join(base,'private.json');await writeFile(p,'{}',{mode:0o600});assert.equal((await readComparisonFile(p,true,2)).toString(),'{}');await assert.rejects(readComparisonFile(p,true,1),invalid);
 await assert.rejects(readComparisonFile(join(base,'missing')));await symlink(p,join(base,'link'));await assert.rejects(readComparisonFile(join(base,'link')));
 await writeFile(join(base,'public'),'{}',{mode:0o644});await assert.rejects(readComparisonFile(join(base,'public')),invalid);
 await mkdir(join(base,'directory'),{mode:0o700});await assert.rejects(readComparisonFile(join(base,'directory')),invalid);
 await assert.rejects(verifyFeatureEngineComparison(base),invalid);
 await assert.rejects(runFeatureEngineComparison({output:base}),invalid);
 assert.equal(ownedStreamsProcessHandles().length,0);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('actual bounded worker restart/replay, contributions and persisted cursor agree with independent expectations',async()=>{
 const {openFeatureContributionWorker}=await import('../dist/feature-contribution-worker.js');
 const fixtureData=JSON.parse(await readFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json')));
 const base=await mkdtemp(join(ROOT,'.local/compare-worker-unit-')),path=join(base,'worker');let w;
 try{
 w=openFeatureContributionWorker(path,fixtureData.policy);
 for(const d of fixtureData.deliveries.slice(0,3))w.consume(d);
 const prefix=w.receipt();w.close();w=null;
 const bytes=await readComparisonFile(join(path,'publication.json'));
 w=openFeatureContributionWorker(path,fixtureData.policy);
 for(const d of fixtureData.deliveries.slice(0,3))w.consume(d);
 assert.deepEqual(w.receipt(),prefix);assert.deepEqual(await readComparisonFile(join(path,'publication.json')),bytes);
 for(const d of fixtureData.deliveries.slice(3))w.consume(d);
 const actual=fixtureData.queries.map(q=>w.materialize(q).result);
 const f=await fixture();f.extended=actual;assert.equal(compare(f).matched_queries,8);
 assert.equal(w.receipt().next_offset,8);assert.equal(w.receipt().deliveries,8);assert.ok(w.receipt().generation<=20);
 w.close();w=null;
 const disk=JSON.parse(await readComparisonFile(join(path,'publication.json')));
 assert.equal(disk.publication.state.contributions.evidence.next_position,8);
 assert.ok((await readComparisonFile(join(path,'publication.json'))).length<=2097152);
 // Changed same-position duplicate cannot advance durable state.
 w=openFeatureContributionWorker(path,fixtureData.policy);const before=w.receipt();
 const changed=structuredClone(fixtureData.deliveries[0]);changed.revision.attempt_amount='11.00';
 assert.throws(()=>w.consume(changed));assert.deepEqual(w.receipt(),before);
 }finally{w?.close();await rm(base,{recursive:true,force:true});}
});
test('internal provenance validation rejects missing/changed source, compiled, runtime and teardown evidence',async()=>{
 const input=await loadFeatureEngineInput(),hash=x=>createHash('sha256').update(x).digest('hex');
 const names=['apps/risk-workers/scripts/feature-streams-candidate.mjs','apps/risk-workers/scripts/feature-stream-spike.mjs','apps/risk-workers/scripts/cdc-runtime.mjs','apps/risk-workers/scripts/cdc-runtime-pins.json','packages/contracts/src/feature-engine-comparison.ts','packages/contracts/src/feature-catalog.ts','packages/contracts/dist/feature-engine-comparison.js','packages/contracts/dist/feature-catalog.js','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'];
 const current=Object.fromEntries(await Promise.all(names.map(async p=>[p,hash(await readFile(join(ROOT,p)))])));
 const receipt={version:1,scope:'local_synthetic',candidate:'kafka_streams',owned_processes:0,production_ready:false,acceptance:'pending_parent_comparison',plan:input.plan,plan_sha256:featureEnginePlanHash(input.plan),java_source_sha256:hash(STREAMS_JAVA_SOURCE),source_hashes:current,logical_records:26,physical_records:39,input_partitions:1,observations:{elapsed_ms:20,setup_ms:2,phase_ms:10,process_output_bytes:20,peak_scratch_bytes:100},phases:['prefix','final'].map(phase=>({phase,bytes:20,elapsed_ms:5,sha256:'a'.repeat(64)})),native_state_files:[{name:'state/CURRENT',bytes:2,sha256:'a'.repeat(64)},{name:'state/01.sst',bytes:20,sha256:'b'.repeat(64)}]};
 assert.equal(validateComparisonProvenance(receipt,input,current).acceptance,'pending_parent_comparison');
 for(const mutate of [
  r=>delete r.source_hashes[names[0]],r=>r.source_hashes[names[2]]='0'.repeat(64),r=>r.source_hashes[names[3]]='0'.repeat(64),r=>r.source_hashes[names[6]]='0'.repeat(64),
  r=>r.plan.runtime.streams='other',r=>r.java_source_sha256='0'.repeat(64),r=>r.plan_sha256='0'.repeat(64),
  r=>r.owned_processes=1,r=>r.physical_records=26,r=>r.input_partitions=2,
  r=>r.observations.elapsed_ms=180001,r=>r.observations.process_output_bytes=2097153,
  r=>r.observations.peak_scratch_bytes=2*1024**3+1,r=>r.phases.pop(),
  r=>r.native_state_files=[],r=>r.native_state_files[0].name='../CURRENT',r=>r.native_state_files[1].bytes=2097153,
 ]){const r=structuredClone(receipt);mutate(r);assert.throws(()=>validateComparisonProvenance(r,input,current),invalid);}
 const changed=structuredClone(current);changed[names[0]]='f'.repeat(64);assert.throws(()=>validateComparisonProvenance(receipt,input,changed),invalid);
 assert.throws(()=>validateComparisonProvenance({success:true,expected:values},input,current),invalid);
});
test('actual original worker uses the same thirteen-record prefix as Streams and preserves exact replay',async()=>{
 const f=JSON.parse(await readFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/golden.json')));
 const {openFeatureStreamConsumer}=await import('../dist/feature-stream-consumer.js');
 const plan={version:'synthetic-feature-stream-1',identity:'synthetic_declared',run_id:'synthetic_run',input_identity:'synthetic_golden_v1',namespace:'synthetic_golden',topic:'synthetic_golden.synthetic_run',window_seconds:3600,coverage_start:f.coverage_start,queries:f.snapshots.map(({expected,...q})=>q),limits:{records:32,revisions:32,snapshots:8,capture_bytes:32768,state_bytes:1048576}};
 const base=await mkdtemp(join(ROOT,'.local/compare-original-unit-'));
 try{
 await mkdir(join(base,'original'),{mode:0o700});await mkdir(join(base,'original/pipeline'),{mode:0o700});
 const deliveries=f.events.map((event,offset)=>({identity:'synthetic_declared',topic:plan.topic,partition:0,offset,event}));
 const w=openFeatureStreamConsumer(join(base,'original/pipeline/consumer'),plan);
 try{for(const d of deliveries)w.consume(d);for(const q of plan.queries)w.materialize(q.id);}finally{w.close();}
 const text=deliveries.map(d=>`R\t0\t${d.offset}\t${Buffer.from(canonical(d)).toString('base64')}\n`).join('')+'E\t18\t18\n';
 await writeFile(join(base,'original/pipeline/capture-initial.txt'),text,{mode:0o600});
 await runBoundedOriginalRecovery(base);
 const prefix=JSON.parse(await readComparisonFile(join(base,'bounded-prefix.json'))),final=JSON.parse(await readComparisonFile(join(base,'matched-original/checkpoint.json')));
 assert.equal(prefix.next_offset,13);assert.equal(prefix.state.deliveries.length,13);assert.equal(final.next_offset,18);assert.equal(final.state.snapshots.length,6);
 assert.equal(final.state.snapshots[0].amount,'14.11');assert.equal(final.state.snapshots[1].amount,'13.14');
 assert.equal(final.state.snapshots[5].amount,'7.00');
 assert.deepEqual((await readComparisonFile(join(base,'matched-original/checkpoint.json'))).length<=1048576,true);
 await assert.rejects(runBoundedOriginalRecovery(base)); // exclusive prefix retention cannot overwrite
 }finally{await rm(base,{recursive:true,force:true});}
});
