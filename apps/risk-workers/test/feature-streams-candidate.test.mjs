import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {parseArguments,runFeatureStreamsCandidate,verifyStreamsArtifacts,loadFeatureEngineInput,validatePhaseEvidence,canonical,ownedStreamsProcessHandles,executeStreamsHelper} from '../scripts/feature-streams-candidate.mjs';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(new URL('../scripts/feature-streams-candidate.mjs',import.meta.url));
const output=join(ROOT,'.local/streams-unit-never-created'),invalid={code:'FEATURE_STREAMS_FAILED'};
const fields=['attempt_count','attempt_amount','gross_count','gross_amount','reversed_count','reversed_amount','net_active_count','net_amount'];
const vectors=[
 ['12','2312','12','2312','2','901','11','1411'],['12','2215','12','2215','2','901','11','1314'],
 ['12','2215','12','2215','2','901','11','1314'],['1','700','1','700','0','0','1','700'],
 ['2','2000','1','800','1','800','0','0'],['1','200','1','200','0','0','1','200'],null,['0','0','0','0','0','0','0','0']
];
function fixture(input,phase='final'){
 const first=phase==='prefix',prefix=input.plan.recovery.prefix_records;
 const rows=n=>input.records.slice(0,n).map((r,i)=>({position:i,value:canonical(r)}));
 return {phase,prefix_before:rows(first?0:prefix),rows:rows(first?prefix:26),physical_end_offset:first?13:39,last_processed_offset:first?12:38,sent_records:first?13:26,
  snapshots:first?[]:input.plan.queries.map((q,i)=>({query_id:q.id,result:vectors[i]===null?{status:'unavailable',reason:'UNKNOWN_REVERSAL'}:{status:'available',vector:Object.fromEntries(fields.map((f,k)=>[f,vectors[i][k]]))}})),
  topology:'Topologies: exact-position-revisions (stores: [exact-revisions])',clean_close:true};
}

test('import is inert and CLI exposes only a normalized new private destination',()=>{
 const imported=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(new URL('../scripts/feature-streams-candidate.mjs',import.meta.url).href)+')'],{encoding:'utf8',timeout:5000});
 assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
 assert.deepEqual(parseArguments(['--output',output]),{output});
 for(const args of [[],['--help'],['--output'],['--output','/tmp/private'],['--output','.local/x'],['--output',output+'/../x'],['--output',output,'--fake'],['--runner',output]])assert.throws(()=>parseArguments(args),invalid);
 assert.equal(ownedStreamsProcessHandles().length,0);
});

test('exact frozen input contains raw records and a shared eight-query cohort without expected answers',async()=>{
 const input=await loadFeatureEngineInput();assert.deepEqual(Object.keys(input).sort(),['plan','records']);
 assert.equal(input.records.length,26);assert.equal(input.plan.queries.length,8);
 assert.deepEqual(input.plan.corpora.map(c=>[c.id,c.records]),[['original',18],['extended',8]]);
 assert.equal(input.plan.recovery.prefix_records,13);assert.equal(input.plan.recovery.replay_records,13);
 assert.equal(input.plan.queries[0].anchor_at,'2026-01-01T12:00:00Z');assert.equal(input.plan.queries[1].as_of,'2026-01-01T12:01:00Z');
 assert.equal(input.plan.queries[3].currency,'ALT');assert.equal(input.plan.queries[5].currency,'USD');
 assert.equal(canonical(input).includes('"expected"'),false);
 for(const [i,row] of input.records.entries())assert.equal(row.position,i);
});

test('public invocation rejects result/executable/prototype/accessor injection before native activity',async()=>{
 let calls=0;
 for(const options of [{output,success:true},{output,runner(){}},{output,executable:'/bin/true'},Object.create({output}),{get output(){calls++;return output;}}]){
  await assert.rejects(runFeatureStreamsCandidate(options),invalid);
 }
 assert.equal(calls,0);assert.equal(ownedStreamsProcessHandles().length,0);
});

test('existing destinations are never overwritten and real CLI failure cannot record success',async t=>{
 const base=await mkdtemp(join(ROOT,'.local/streams-existing-'));await chmod(base,0o700);t.after(()=>rm(base,{recursive:true,force:true}));
 const file=join(base,'preserve.txt');await writeFile(file,'original',{mode:0o600});
 await assert.rejects(runFeatureStreamsCandidate({output:base}),invalid);assert.equal(await readFile(file,'utf8'),'original');
 const child=spawnSync(process.execPath,[script,'--output',base],{encoding:'utf8',timeout:5000});
 assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(child.stderr,'FEATURE_STREAMS_FAILED\n');
 assert.equal(ownedStreamsProcessHandles().length,0);
});

test('supplementary runtime guards reject missing, writable and symlinked artifacts',async t=>{
 for(const runtime of [null,{}, {kafka:output}])await assert.rejects(verifyStreamsArtifacts(runtime),invalid);
 const base=await mkdtemp(join(ROOT,'.local/streams-jars-'));await chmod(base,0o700);t.after(()=>rm(base,{recursive:true,force:true}));
 const libs=join(base,'libs');await mkdir(libs,{mode:0o700});
 const names=['kafka-streams-4.1.2.jar','rocksdbjni-9.7.3.jar','jackson-databind-2.19.4.jar'];
 for(const name of names)await writeFile(join(libs,name),'invented metadata fixture; not native proof',{mode:0o600});
 await chmod(join(libs,names[0]),0o666);await assert.rejects(verifyStreamsArtifacts({kafka:base}),invalid);
 await chmod(join(libs,names[0]),0o600);await rm(join(libs,names[0]));await symlink(join(libs,names[1]),join(libs,names[0]));await assert.rejects(verifyStreamsArtifacts({kafka:base}),invalid);
});

test('independent phase parsing verifies raw store rows, retained prefix, offsets and fixed query values',async()=>{
 const input=await loadFeatureEngineInput(),prefix=fixture(input,'prefix'),final=fixture(input);
 assert.deepEqual(validatePhaseEvidence(prefix,input,'prefix'),prefix);assert.deepEqual(validatePhaseEvidence(final,input,'final'),final);
 assert.deepEqual(prefix.rows,final.prefix_before);assert.equal(final.snapshots[6].result.reason,'UNKNOWN_REVERSAL');assert.equal(final.snapshots[7].result.vector.net_amount,'0');
 const saved=canonical(final);const copy=validatePhaseEvidence(final,input,'final');copy.rows[0].value='changed';assert.equal(canonical(final),saved);
});

test('copied expected results cannot hide changed native records, duplicated positions or missing restart state',async()=>{
 const input=await loadFeatureEngineInput();
 for(const mutate of [
  r=>r.rows[0].value=r.rows[0].value.replace('10.02','10.03'),
  r=>r.rows[1].position=0,
  r=>r.rows.pop(),
  r=>r.prefix_before.pop(),
  r=>r.prefix_before[0].value='{}',
  r=>r.physical_end_offset=26,
  r=>r.last_processed_offset=37,
  r=>r.sent_records=13,
  r=>r.clean_close=false,
  r=>r.topology='not the required persistent topology',
  r=>r.accepted=true,
  r=>r.snapshots[0].result.vector.net_amount='1412',
  r=>r.snapshots[0].query_id=r.snapshots[1].query_id,
  r=>r.snapshots[6].result=r.snapshots[7].result,
  r=>r.snapshots[7].result={status:'unavailable',reason:'UNKNOWN_REVERSAL'},
 ]){const changed=fixture(input);mutate(changed);assert.throws(()=>validatePhaseEvidence(changed,input,'final'),invalid);}
});

test('phase envelopes enforce input identity counts, exact budgets, detached JSON and bounded output',async()=>{
 const input=await loadFeatureEngineInput();
 for(const mutate of [
  x=>x.plan.budgets.records=2001,
  x=>x.plan.budgets.queries=9,
  x=>x.plan.budgets.scratch_bytes=2147483649,
  x=>x.plan.budgets.invocation_ms=180001,
  x=>x.plan.runtime.streams='other',
  x=>x.records.push(x.records[0]),
  x=>x.records[0].position=1,
  x=>x.records[0].corpus='extended',
 ]){const changed=structuredClone(input);mutate(changed);assert.throws(()=>validatePhaseEvidence(fixture(input),changed,'final'),invalid);}
 let calls=0;const value=fixture(input);Object.defineProperty(value,'rows',{enumerable:true,get(){calls++;return [];}});
 assert.throws(()=>validatePhaseEvidence(value,input,'final'),invalid);assert.equal(calls,0);
 const oversized=fixture(input);oversized.topology='x'.repeat(2097153);assert.throws(()=>validatePhaseEvidence(oversized,input,'final'),invalid);
 const cyclic=fixture(input);cyclic.loop=cyclic;assert.throws(()=>validatePhaseEvidence(cyclic,input,'final'),invalid);
});

test('invalid CLI diagnostics never echo caller payload or a completion marker',()=>{
 const result=spawnSync(process.execPath,[script,'--runner','private_payload'],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'FEATURE_STREAMS_FAILED\n');
});

function fakeProcess(start,ignoreTerm=false){
 const signals=[];const spawner=()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=signal=>{signals.push(signal);if(!ignoreTerm||signal==='SIGKILL')queueMicrotask(()=>child.emit('close',1));return true;};
  queueMicrotask(()=>start(child));return child;
 };return {spawner,signals};
}
test('phase subprocess bounds output and confirms teardown on excess bytes or nonzero exit',async()=>{
 const runtime={java:'/invented/java',kafka:'/invented/kafka'};
 const excess=fakeProcess(child=>child.stdout.write('x'.repeat(65)));
 await assert.rejects(executeStreamsHelper(runtime,[],ROOT,100,64,excess.spawner),invalid);
 assert.deepEqual(excess.signals,['SIGTERM']);assert.equal(ownedStreamsProcessHandles().length,0);
 const failed=fakeProcess(child=>{child.stderr.write('private_payload\nSTREAMS_FAILURE_CLASS:java.lang.IllegalStateException\n');child.emit('close',1);});
 await assert.rejects(executeStreamsHelper(runtime,[],ROOT,100,1024,failed.spawner),error=>{
  assert.equal(error.code,'FEATURE_STREAMS_FAILED');assert.deepEqual(error.diagnostics,['STREAMS_FAILURE_CLASS:java.lang.IllegalStateException']);assert.equal(JSON.stringify(error).includes('private_payload'),false);return true;
 });assert.equal(ownedStreamsProcessHandles().length,0);
});
test('phase timeout terminates an unresponsive owned process with a bounded force-kill fallback',async()=>{
 const fake=fakeProcess(()=>{},true),started=Date.now();
 await assert.rejects(executeStreamsHelper({java:'/invented/java',kafka:'/invented/kafka'},[],ROOT,10,64,fake.spawner),invalid);
 assert.deepEqual(fake.signals,['SIGTERM','SIGKILL']);assert.ok(Date.now()-started<3500);assert.equal(ownedStreamsProcessHandles().length,0);
 for(const ms of [0,-1,45001,Infinity])await assert.rejects(executeStreamsHelper({},[],ROOT,ms),invalid);
});
