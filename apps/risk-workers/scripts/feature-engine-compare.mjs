/** Import-inert host-only comparison; no caller runner, receipt or native fake mode. */
import {createHash} from 'node:crypto';
import {constants as C} from 'node:fs';
import {open,lstat,readdir,mkdir,link,unlink,realpath} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runFeatureStreamAcceptance} from './feature-stream-acceptance.mjs';
import {runFeatureContributionsAcceptance,verifyFeatureContributionEvidence} from './feature-contributions-acceptance.mjs';
import {runFeatureStreamsCandidate,loadFeatureEngineInput,validatePhaseEvidence,canonical,ownedStreamsProcessHandles,STREAMS_JAVA_SOURCE,parseArguments as parseOutput} from './feature-streams-candidate.mjs';
import {verifyRuntime} from './cdc-runtime.mjs';
import {validateCapture} from './feature-stream-spike.mjs';
import {detachFeatureJSON} from '../../../packages/contracts/dist/feature-catalog.js';
import {featureEnginePlanHash} from '../../../packages/contracts/dist/feature-engine-comparison.js';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url)),MAX=2097152,TOTAL=16777216;
const fail=()=>Object.assign(new Error('FEATURE_COMPARE_FAILED'),{code:'FEATURE_COMPARE_FAILED'});
const check=v=>{if(!v)throw fail();};
const hash=v=>createHash('sha256').update(v).digest('hex');
const nativeBindings=['apps/risk-workers/scripts/feature-streams-candidate.mjs','apps/risk-workers/scripts/feature-stream-spike.mjs','apps/risk-workers/scripts/cdc-runtime.mjs','apps/risk-workers/scripts/cdc-runtime-pins.json','packages/contracts/src/feature-engine-comparison.ts','packages/contracts/src/feature-catalog.ts','packages/contracts/dist/feature-engine-comparison.js','packages/contracts/dist/feature-catalog.js','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'];
let active=false;
export function parseArguments(args){try{return parseOutput(args);}catch{throw fail();}}
async function ancestors(path){
 for(let p=path;;p=dirname(p)){const s=await lstat(p);check(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o022));if(p===join(ROOT,'.local')||p.startsWith(join(ROOT,'.local')+'/'))check(s.uid===process.getuid()&&(s.mode&511)===448);if(p===dirname(p))break;}
}
export async function readComparisonFile(path,privateFile=true,max=MAX){
 check(typeof path==='string'&&path===resolve(path)&&path.startsWith(ROOT)&&!path.includes('\0'));
 check(Number.isSafeInteger(max)&&max>0&&max<=MAX);
 const f=await open(path,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);
 try{const s=await f.stat();check(s.isFile()&&s.nlink===1&&s.size<=max);if(privateFile)check(s.uid===process.getuid()&&(s.mode&511)===384);
 const b=Buffer.alloc(max+1);let n=0,k;while((k=(await f.read(b,n,b.length-n,null)).bytesRead)){n+=k;check(n<=max);}const out=b.subarray(0,n);check(Buffer.from(out.toString()).equals(out));return out;
 }finally{await f.close();}
}
const json=async p=>JSON.parse(await readComparisonFile(p));
async function provenance(){
 const out={};let count=0;
 async function walk(rel,depth=0){check(depth<=12);const p=join(ROOT,rel),s=await lstat(p);check(!s.isSymbolicLink());if(s.isDirectory()){const names=await readdir(p);check(names.length<=256);for(const n of names.sort())await walk(join(rel,n),depth+1);}else{check(++count<=2048);out[rel]=hash(await readComparisonFile(p,false));}}
 for(const name of ['packages/contracts','packages/risk','apps/risk-workers']){await walk(name+'/src');await walk(name+'/dist');await walk(name+'/package.json');}
 for(const name of ['feature-engine-compare.mjs','feature-streams-candidate.mjs','feature-stream-acceptance.mjs','feature-contributions-acceptance.mjs','feature-stream-spike.mjs','cdc-runtime.mjs','cdc-runtime-pins.json'])await walk('apps/risk-workers/scripts/'+name);
 for(const name of ['golden.json','p04-extended-golden.json'])await walk('packages/risk/test/fixtures/feature-streams/'+name);
 for(const name of ['risk','contracts'])check(await realpath(join(ROOT,'apps/risk-workers/node_modules/@lmps',name))===join(ROOT,'packages',name));
 return out;
}
async function evidenceTree(output){
 const files={};let bytes=0,count=0;
 async function walk(p,rel='',depth=0){check(depth<=5);const s=await lstat(p);check(!s.isSymbolicLink()&&s.uid===process.getuid());if(s.isDirectory()){check((s.mode&511)===448);const names=await readdir(p);check(names.length<=64);for(const n of names.sort()){if(!rel&&n==='comparison.json')continue;await walk(join(p,n),join(rel,n),depth+1);}}else{check(++count<=128);const b=await readComparisonFile(p);bytes+=b.length;check(bytes<=TOTAL);files[rel]={bytes:b.length,sha256:hash(b)};}}
 await walk(output);return {bytes,files};
}
const expected=[['11','1411'],['11','1314'],['11','1314'],['1','700']];
/** Pure detached unit seam: never publishes acceptance or substitutes a native execution. */
export function compareFeatureOutputs(input,prefix,final,original,extended){
 try{
 input=detachFeatureJSON(input);
 check(hash(canonical(input.records))==='ce4e3c40 c070aaf5 e75b6525 33107160 f1f293f8 49c61b5e ed65d330 e21c0aea'.replaceAll(' ',''));
 check(hash(canonical({...input.plan,run_id:'synthetic_compare'}))==='2a96bbad f292eb49 59672e1b 66551d50 8eefa6f8 809dde05 ccaedcff 6b9eddf3'.replaceAll(' ',''));
 const a=detachFeatureJSON(original),b=detachFeatureJSON(extended);
 const p=validatePhaseEvidence(prefix,input,'prefix'),f=validatePhaseEvidence(final,input,'final');
 check(canonical(p.rows)===canonical(f.prefix_before));check(a.length===6&&b.length===4);
 for(const [i,k]of [0,1,4,5].entries()){
  const s=a[k],q=input.plan.queries[i],v=f.snapshots[i].result.vector;
  check(s.query.as_of===q.as_of&&s.query.currency===q.currency&&s.reason===null&&s.window_end===q.anchor_at);
  const cents=BigInt(expected[i][1]);check(s.count===expected[i][0]&&s.amount===`${cents/100n}.${(cents%100n).toString().padStart(2,'0')}`);
  check(v.net_active_count===s.count&&v.net_amount===expected[i][1]);
 }
 check(a[2].count===null&&a[2].amount===null&&a[2].reason==='INPUT_MISSING');
 check(a[3].count===null&&a[3].amount===null&&a[3].reason==='HISTORY_INCOMPLETE');
 for(let i=0;i<4;i++)check(canonical(b[i])===canonical(f.snapshots[i+4].result));
 return {matched_queries:8,logical_records:26,physical_records:39,prefix_records:13,final_records:26,status:'matched_supported_semantics',unsupported:['original_attempt_gross_projection','original_missing_input_history_native_queries','unclean_crash','native_ttl_admission','native_changed_duplicate_trial','native_partial_coverage_trial','burst_beyond_frozen_fixture'],production_ready:false};
 }catch{throw fail();}
}
async function boundedExtended(output){
 const fixture=JSON.parse(await readComparisonFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'),false,65536));
 const {openFeatureContributionWorker}=await import('../dist/feature-contribution-worker.js');
 const path=join(output,'matched-worker');let receipt,prefix;
 function use(fn){const w=openFeatureContributionWorker(path,fixture.policy);try{return fn(w);}finally{w.close();}}
 use(w=>{for(const d of fixture.deliveries.slice(0,3))w.consume(d);prefix=w.receipt();});
 const saved=await readComparisonFile(join(path,'publication.json'));
 use(w=>{for(const d of fixture.deliveries.slice(0,3))w.consume(d);check(canonical(w.receipt())===canonical(prefix));});
 check(saved.equals(await readComparisonFile(join(path,'publication.json'))));
 const results=use(w=>{for(const d of fixture.deliveries.slice(3))w.consume(d);const out=fixture.queries.map(q=>w.materialize(q).result);receipt=w.receipt();return out;});
 check(receipt.next_offset===8&&receipt.deliveries===8&&receipt.generation>=prefix.generation&&receipt.generation<=20);
 return results;
}
/** Internal bounded-worker recovery operation, never native comparison acceptance. */
export async function runBoundedOriginalRecovery(output){
 parseArguments(['--output',output]);await ancestors(output);
 const {openFeatureStreamConsumer}=await import('../dist/feature-stream-consumer.js');
 const base=join(output,'original/pipeline'),prior=await json(join(base,'consumer/checkpoint.json')),plan=prior.state.plan;
 const raw=await readComparisonFile(join(base,'capture-initial.txt'));
 const values=prior.state.deliveries.map(canonical),deliveries=validateCapture(raw.toString(),values);
 const path=join(output,'matched-original');
 function use(fn){const w=openFeatureStreamConsumer(path,plan);try{return fn(w);}finally{w.close();}}
 use(w=>{for(const d of deliveries.slice(0,13))w.consume(d);check(w.receipt().next_offset===13);});
 const prefix=await readComparisonFile(join(path,'checkpoint.json'));
 const f=await open(join(output,'bounded-prefix.json'),C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);try{await f.writeFile(prefix);await f.sync();}finally{await f.close();}
 use(w=>{for(const d of deliveries.slice(0,13))w.consume(d);});
 check(prefix.equals(await readComparisonFile(join(path,'checkpoint.json'))));
 use(w=>{for(const d of deliveries.slice(13))w.consume(d);for(const q of plan.queries)w.materialize(q.id);check(w.receipt().next_offset===18);});
 const final=await json(join(path,'checkpoint.json'));check(canonical(final.state)===canonical(prior.state));
}
/** Internal detached provenance assertion. A passing unit assertion is not a native receipt. */
export function validateComparisonProvenance(value,input,current){
 try{
 const receipt=detachFeatureJSON(value);current=detachFeatureJSON(current);input=detachFeatureJSON(input);
 check(receipt.version===1&&receipt.scope==='local_synthetic'&&receipt.candidate==='kafka_streams'&&receipt.owned_processes===0&&receipt.production_ready===false&&receipt.acceptance==='pending_parent_comparison');
 check(canonical({...receipt.plan,run_id:input.plan.run_id})===canonical(input.plan));
 check(receipt.plan_sha256===featureEnginePlanHash(receipt.plan)&&receipt.java_source_sha256===hash(STREAMS_JAVA_SOURCE));
 check(canonical(Object.keys(receipt.source_hashes).sort())===canonical([...nativeBindings].sort()));
 for(const name of nativeBindings)check(/^[a-f0-9]{64}$/.test(current[name])&&receipt.source_hashes[name]===current[name]);
 check(receipt.logical_records===26&&receipt.physical_records===39&&receipt.input_partitions===1);
 const uint=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
 const o=receipt.observations;check(uint(o.elapsed_ms,180000)&&uint(o.setup_ms,o.elapsed_ms)&&uint(o.phase_ms,o.elapsed_ms)&&uint(o.process_output_bytes,MAX)&&uint(o.peak_scratch_bytes,2*1024**3));
 check(receipt.phases.length===2&&receipt.phases.every((p,i)=>p.phase===['prefix','final'][i]&&uint(p.bytes,MAX)&&uint(p.elapsed_ms,45000)&&/^[a-f0-9]{64}$/.test(p.sha256)));
 check(Array.isArray(receipt.native_state_files)&&receipt.native_state_files.length>0&&receipt.native_state_files.length<=20000);
 let bytes=0;const names=new Set();for(const f of receipt.native_state_files){check(typeof f.name==='string'&&f.name.length<=512&&/^[A-Za-z0-9_./-]+$/.test(f.name)&&!f.name.startsWith('/')&&!f.name.split('/').some(s=>s==='..'||s==='.'||s==='')&&!names.has(f.name));names.add(f.name);check(uint(f.bytes,MAX)&&/^[a-f0-9]{64}$/.test(f.sha256));bytes+=f.bytes;check(bytes<=MAX);}
 check([...names].some(n=>n.endsWith('/CURRENT'))&&[...names].some(n=>n.endsWith('.sst')));
 return receipt;
 }catch{throw fail();}
}
async function validateStored(output,input){
 for(const rel of ['', 'extended','extended/worker','streams','original','original/pipeline','original/pipeline/consumer','matched-worker','matched-original'])await ancestors(join(output,rel));
 await verifyFeatureContributionEvidence(join(output,'extended'));
 const current=await provenance();
 const receipt=validateComparisonProvenance(await json(join(output,'streams/candidate-receipt.json')),input,current);
 const actualInput={...input,plan:receipt.plan};
 const phases=[];check(receipt.phases.length===2);
 for(const phase of ['prefix','final']){const raw=await readComparisonFile(join(output,'streams/phase-'+phase+'.json'));const meta=receipt.phases.find(p=>p.phase===phase);check(meta&&meta.bytes===raw.length&&meta.sha256===hash(raw));phases.push(JSON.parse(raw));}
 check(receipt.source_state_sha256===hash(canonical(phases[1].rows)));
 const original=await json(join(output,'original/pipeline/snapshots.json'));
 await verifyOriginal(output,original);
 const {restoreFeatureWindowState,snapshotFeatureWindowState,initializeFeatureWindowState,applyFeatureWindowState}=await import('../../../packages/risk/dist/index.js');
 const fixture=JSON.parse(await readComparisonFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'),false,65536));
 const envelope=await json(join(output,'matched-worker/publication.json'));
 const s=restoreFeatureWindowState(envelope.publication.state,fixture.policy);check(s.contributions.evidence.next_position===8);
 let rebuilt=initializeFeatureWindowState(fixture.policy);for(const d of fixture.deliveries)rebuilt=applyFeatureWindowState(rebuilt,d).state;
 const extended=fixture.queries.map(q=>{const out=snapshotFeatureWindowState(rebuilt,q);rebuilt=out.state;return out.snapshot.result;});
 check(canonical(s)===canonical(rebuilt));
 return compareFeatureOutputs(actualInput,...phases,original,extended);
}
async function verifyOriginal(output,snapshots){
 const f=JSON.parse(await readComparisonFile(join(ROOT,'packages/risk/test/fixtures/feature-streams/golden.json'),false,65536));
 const plan={version:'synthetic-feature-stream-1',identity:'synthetic_declared',run_id:'synthetic_run',input_identity:'synthetic_golden_v1',namespace:'synthetic_golden',topic:'synthetic_golden.synthetic_run',window_seconds:3600,coverage_start:f.coverage_start,queries:f.snapshots.map(({expected,...q})=>q),limits:{records:32,revisions:32,snapshots:8,capture_bytes:32768,state_bytes:1048576}};
 const base=join(output,'original/pipeline');
 const values=f.events.map((event,offset)=>canonical({identity:'synthetic_declared',topic:plan.topic,partition:0,offset,event}));
 const raw=await readComparisonFile(join(base,'capture-initial.txt'));
 check(raw.equals(await readComparisonFile(join(base,'capture-restart.txt'))));
 const deliveries=validateCapture(raw.toString(),values);
 const {initializeFeatureStream,applyFeatureStreamDelivery,materializeFeatureStreamSnapshot}=await import('../../../packages/risk/dist/index.js');
 let state=initializeFeatureStream(plan),prefix;
 for(const [i,d]of deliveries.entries()){state=applyFeatureStreamDelivery(state,d);if(i===8)prefix=state;}
 for(const [i,q]of plan.queries.entries()){const out=materializeFeatureStreamSnapshot(state,q.id);check(canonical(out.snapshot)===canonical(snapshots[i]));state=out.state;}
 const checkpoint=await json(join(base,'consumer/checkpoint.json')),owner=await json(join(base,'consumer/owner.json'));
 check(checkpoint.next_offset===18&&checkpoint.owner===owner.owner&&canonical(checkpoint.state)===canonical(state));
 const receipt=await json(join(base,'pipeline-receipt.json'));
 const grouped=v=>hash(v).match(/.{8}/g).join(' ');
 check(checkpoint.state_hash===grouped(canonical(state))&&checkpoint.plan_hash===grouped(canonical(plan)));
 check(receipt.owned_processes===0&&receipt.end_offset===18&&receipt.partition===0&&receipt.prefix.next_offset===9&&receipt.prefix.state_hash===grouped(canonical(prefix))&&receipt.committed.state_hash===checkpoint.state_hash);
 const matched=await json(join(output,'matched-original/checkpoint.json'));
 check(canonical(matched.state)===canonical(state)&&matched.next_offset===18&&matched.state_hash===checkpoint.state_hash&&matched.plan_hash===checkpoint.plan_hash);
 let sharedPrefix=initializeFeatureStream(plan);for(const d of deliveries.slice(0,13))sharedPrefix=applyFeatureStreamDelivery(sharedPrefix,d);
 const saved=await json(join(output,'bounded-prefix.json'));
 check(saved.next_offset===13&&saved.owner===matched.owner&&canonical(saved.state)===canonical(sharedPrefix)&&saved.state_hash===grouped(canonical(sharedPrefix))&&saved.plan_hash===checkpoint.plan_hash);
 check(canonical((await readdir(join(output,'matched-original'))).sort())===canonical(['checkpoint.json','owner.json']));
}
async function publish(output,value){
 const text=canonical(value);check(Buffer.byteLength(text)<=MAX);const stage=join(output,'comparison-stage.json');
 const f=await open(stage,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);try{await f.writeFile(text);await f.sync();}finally{await f.close();}
 try{await link(stage,join(output,'comparison.json'));}finally{await unlink(stage);}
 const d=await open(output,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}
}
export async function runFeatureEngineComparison(options){
 let claimed=false;
 try{
 check(arguments.length===1);const o=detachFeatureJSON(options);check(Object.keys(o).join()==='output');const {output}=parseArguments(['--output',o.output]);
 check(!active&&ownedStreamsProcessHandles().length===0);active=true;claimed=true;
 await ancestors(dirname(output));try{await lstat(output);throw fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 const before=await provenance(),input=await loadFeatureEngineInput();await verifyRuntime();await mkdir(output,{mode:0o700});
 const started=performance.now();
 // Each independent native invocation retains its own <=180s deadline and teardown reserve.
 const original=await runFeatureStreamAcceptance({output:join(output,'original')});
 const matchedStart=performance.now();await runBoundedOriginalRecovery(output);const matchedMs=Math.ceil(performance.now()-matchedStart);
 const extendedStart=performance.now();await runFeatureContributionsAcceptance({output:join(output,'extended')});await boundedExtended(output);
 const extendedMs=Math.ceil(performance.now()-extendedStart);
 const native=await runFeatureStreamsCandidate({output:join(output,'streams')});
 const result=await validateStored(output,input);await verifyRuntime();check(canonical(before)===canonical(await provenance())&&ownedStreamsProcessHandles().length===0);
 const evidence=await evidenceTree(output);check(canonical(evidence)===canonical(await evidenceTree(output)));
 const report={version:1,status:result.status,production_ready:false,native_acceptance:'pending_parent_host_verification',matched_queries:8,logical_records:26,physical_streams_records:39,owned_processes:0,unsupported:result.unsupported,source_hashes:before,evidence,
 observations:{comparison_elapsed_ms:Math.ceil(performance.now()-started),bounded_original_elapsed_ms:original.elapsed_ms,bounded_matched_original_elapsed_ms:matchedMs,bounded_extended_elapsed_ms:extendedMs,streams:native.observations},
 limitations:['elapsed_ms_wall_clock_includes_validation_and_durable_io','streams_setup_ms_excludes_native_phase_ms','peak_scratch_bytes_is_sampled_not_rss','no_p95_slo_tco_capacity_or_production_winner','finite_frozen_hot_key_only','parent_promoted_source_trial_and_fresh_validation_required']};
 check(evidence.bytes+Buffer.byteLength(canonical(report))<=TOTAL);await verifyRuntime();check(canonical(before)===canonical(await provenance())&&ownedStreamsProcessHandles().length===0);await publish(output,report);return report;
 }catch{throw fail();}finally{if(claimed)active=false;}
}
export async function verifyFeatureEngineComparison(output){
 try{parseArguments(['--output',output]);await ancestors(output);const r=await json(join(output,'comparison.json'));check(r.version===1&&r.production_ready===false&&r.native_acceptance==='pending_parent_host_verification'&&r.owned_processes===0&&ownedStreamsProcessHandles().length===0);
 check(Object.keys(r).sort().join(',')==='evidence,limitations,logical_records,matched_queries,native_acceptance,observations,owned_processes,physical_streams_records,production_ready,source_hashes,status,unsupported,version');
 check(r.logical_records===26&&r.physical_streams_records===39&&r.evidence.bytes+Buffer.byteLength(canonical(r))<=TOTAL);
 check(canonical(r.source_hashes)===canonical(await provenance()));check(canonical(r.evidence)===canonical(await evidenceTree(output)));const result=await validateStored(output,await loadFeatureEngineInput());check(result.status===r.status&&r.matched_queries===8&&canonical(result.unsupported)===canonical(r.unsupported));
 for(const k of ['comparison_elapsed_ms','bounded_original_elapsed_ms','bounded_matched_original_elapsed_ms','bounded_extended_elapsed_ms'])check(Number.isSafeInteger(r.observations[k])&&r.observations[k]>=0&&r.observations[k]<=600000);
 check(canonical(r.observations.streams)===canonical((await json(join(output,'streams/candidate-receipt.json'))).observations));
 await verifyRuntime();check(canonical(r.source_hashes)===canonical(await provenance())&&canonical(r.evidence)===canonical(await evidenceTree(output)));return {status:r.status,production_ready:false,native_acceptance:'pending_parent_host_verification'};
 }catch{throw fail();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await runFeatureEngineComparison(parseArguments(process.argv.slice(2)));process.stdout.write('FEATURE_COMPARISON_RECORDED\n');}catch{process.stderr.write('FEATURE_COMPARE_FAILED\n');process.exitCode=1;}}
