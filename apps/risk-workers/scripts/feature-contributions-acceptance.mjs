/** Import-inert explicit local acceptance; no injected runner/configuration. */
import assert from 'node:assert/strict';
import { constants as C } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPackageJSON } from 'node:module';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
// Public checksum of the reviewed plan; output remains the same full SHA-256.
const PLAN='708101d3 86b0fa4f 7e1e66bd 961f87d3 865c744f 6af7bf7a f46dc449 5a46952a'.replaceAll(' ','');
const check=x=>assert.ok(x,'FEATURE_CONTRIBUTIONS_ACCEPTANCE_FAILED');
const encode=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const hash=x=>createHash('sha256').update(x).digest('hex');
async function read(path,max=2097152,privateFile=false){
 const fd=await open(path,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);
 try{const s=await fd.stat();check(s.isFile()&&s.nlink===1&&s.size<=max);if(privateFile)check((s.mode&511)===384&&s.uid===process.getuid());
 const b=Buffer.alloc(max+1);let n=0,k;while((k=(await fd.read(b,n,b.length-n,null)).bytesRead)){n+=k;check(n<=max);}const out=b.subarray(0,n);check(Buffer.from(out.toString()).equals(out));return out;
 }finally{await fd.close();}
}
async function sync(path){const f=await open(path,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
export function parseArguments(args){
 check(Array.isArray(args)&&args.length===2&&args[0]==='--output'&&typeof args[1]==='string');
 const output=args[1],base=join(ROOT,'.local')+'/';
 check(isAbsolute(output)&&output===resolve(output)&&!output.endsWith('/')&&output.startsWith(base)&&!output.slice(base.length).split('/').some(x=>!x||x==='.'||x==='..'));
 return {output};
}
async function validateAncestors(output){
 for(let p=dirname(output);;p=dirname(p)){
  const s=await lstat(p);check(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o022));
  if(p===join(ROOT,'.local')||p.startsWith(join(ROOT,'.local')+'/'))check((s.mode&0o777)===0o700&&s.uid===process.getuid());
  if(p===dirname(p))break;
 }
}
async function provenance(){
 const paths=['packages/contracts/src/feature-catalog.ts','packages/risk/src/feature-contributions.ts','packages/risk/src/feature-window-state.ts','packages/risk/src/index.ts','apps/risk-workers/src/feature-contribution-worker.ts','apps/risk-workers/scripts/feature-contributions-acceptance.mjs','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/test/fixtures/feature-streams/p04-extended-golden.json','packages/risk/fixtures/request.mjs','tasks/ralph/batches/rlp-b08.md','tasks/ralph/batches/rlp-b08.manifest.json','tasks/ralph/phases/p04.md'];
 async function walk(p){for(const name of(await readdir(join(ROOT,p))).sort()){const rel=join(p,name),s=await lstat(join(ROOT,rel));check(!s.isSymbolicLink());if(s.isDirectory())await walk(rel);else if(name.endsWith('.js')||name.endsWith('.ts'))paths.push(rel);}}
 for(const p of ['packages/contracts','packages/risk','apps/risk-workers']){paths.push(p+'/package.json');await walk(p+'/dist');await walk(p+'/src');}
 for(const [base,spec,p]of [['apps/risk-workers/dist/feature-contribution-worker.js','@lmps/risk','packages/risk'],['apps/risk-workers/dist/feature-contribution-worker.js','@lmps/contracts','packages/contracts'],['packages/risk/dist/feature-contributions.js','@lmps/contracts','packages/contracts']])check(await realpath(findPackageJSON(spec,new URL(base,new URL('../../../',import.meta.url))))===join(ROOT,p,'package.json'));
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,hash(await read(join(ROOT,p)))])));
}
async function tree(path){let bytes=0;const hashes={};async function walk(p,rel=''){const s=await lstat(p);check(!s.isSymbolicLink()&&s.uid===process.getuid());if(s.isDirectory()){check((s.mode&511)===448);const entries=await readdir(p);check(entries.length<=3&&rel.split('/').length<=1);for(const n of entries)await walk(join(p,n),join(rel,n));}else{const b=await read(p,2097152,true);bytes+=b.length;check(bytes<=16777216);hashes[rel]=hash(b);}}await walk(path);return {bytes,hashes};}
/** Independent read-only host recheck. No supplied receipt is accepted. */
export async function verifyFeatureContributionEvidence(output){
 parseArguments(['--output',output]);await validateAncestors(output);
 const report=JSON.parse(await read(join(output,'acceptance.json'),2097152,true));
 check(Object.keys(report).sort().join(',')==='deliveries,elapsed_ms,evidence,owned_handles,plan_sha256,production_ready,queries,source_hashes,version');
 check(report.version===1&&report.production_ready===false&&report.plan_sha256===PLAN&&report.deliveries===8&&report.queries===4&&report.owned_handles===0&&report.elapsed_ms<=180000);
 assert.deepEqual(report.source_hashes,await provenance());
 const actual=await tree(output);delete actual.hashes['acceptance.json'];actual.bytes-=Buffer.byteLength(await read(join(output,'acceptance.json'),2097152,true));assert.deepEqual(actual,report.evidence);
 await verifyWorkerEvidence(output);
 assert.deepEqual((await readdir(output)).sort(),['acceptance.json','worker']);
 assert.deepEqual(Object.keys(actual.hashes).sort(),['worker/owner.json','worker/publication.json']);
 check(Number.isSafeInteger(report.elapsed_ms)&&report.elapsed_ms>=0&&actual.bytes+Buffer.byteLength(await read(join(output,'acceptance.json'),2097152,true))<=16777216);
 return {bytes:actual.bytes,files:Object.keys(actual.hashes).length};
}
async function verifyWorkerEvidence(output){
 const f=JSON.parse(await read(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'),65536));
 const r=await import('../../../packages/risk/dist/index.js');const {featureGroupedHash}=await import('../../../packages/contracts/dist/feature-catalog.js');
 // Recompute the publication chain: a rehashed report cannot attest its own generation.
 const publication=(generation,predecessor,state)=>{const body={generation,predecessor,scope:f.policy,state};return {...body,content_hash:featureGroupedHash([body])};};
 let s=r.initializeFeatureWindowState(f.policy),expected=publication(1,null,s);
 const advance=next=>{if(encode(next)!==encode(s)){expected=publication(expected.generation+1,{content_hash:expected.content_hash},next);s=next;}};
 for(const d of f.deliveries)advance(r.applyFeatureWindowState(s,d).state);
 const {VECTOR_FIELDS}=await import('../../../packages/contracts/dist/feature-catalog.js');
 const fixed=[['2','2000','1','800','1','800','0','0'],['1','200','1','200','0','0','1','200'],null,Array(8).fill('0')];
 check(f.deliveries.length===8&&f.queries.length===4);
 for(const [i,q]of f.queries.entries()){
  const out=r.snapshotFeatureWindowState(s,q);
  const expectedResult=fixed[i]===null?{status:'unavailable',reason:'UNKNOWN_REVERSAL'}:{status:'available',vector:Object.fromEntries(VECTOR_FIELDS.map((k,j)=>[k,fixed[i][j]]))};
  assert.deepEqual(out.snapshot.result,expectedResult);
  advance(out.state);
 }
 advance(r.advanceFeatureWatermark(s,f.boundaries.ttl_equal));advance(r.advanceFeatureWatermark(s,f.boundaries.ttl_expired));
 const bytes=await read(join(output,'worker/publication.json'),2097152,true),envelope=JSON.parse(bytes),ownerBytes=await read(join(output,'worker/owner.json'),200,true),owner=JSON.parse(ownerBytes);
 check(typeof owner.owner==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.owner));
 assert.deepEqual(owner,{version:1,owner:owner.owner});check(ownerBytes.toString()===encode(owner));
 assert.deepEqual(envelope,{version:1,plan_sha256:PLAN,owner:owner.owner,scope:f.policy,publication:expected});check(bytes.toString()===encode(envelope));
 assert.deepEqual(r.restoreFeatureWindowState(envelope.publication.state,f.policy),s);
}
export async function runFeatureContributionsAcceptance(options){
 check(arguments.length===1&&options&&Object.keys(options).join()==='output');
 const {output}=parseArguments(['--output',options.output]),start=performance.now();
 await validateAncestors(output);
 try{await lstat(output);check(false);}catch(e){if(e.code!=='ENOENT')throw e;}
 const before=await provenance();
 const f=JSON.parse(await read(join(ROOT,'packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'),65536));check(f.deliveries.length===8&&f.queries.length===4);
 const r=await import('../../../packages/risk/dist/index.js');
 const {VECTOR_FIELDS,featureGroupedHash}=await import('../../../packages/contracts/dist/feature-catalog.js');
 const {openFeatureContributionWorker:worker}=await import('../dist/feature-contribution-worker.js');
 const vectors=[['1','1000','0','0','0','0','0','0'],['1','1000','0','0','0','0','0','0'],['2','2000','1','1000','0','0','1','1000'],['2','2000','1','800','0','0','1','800'],['2','2000','1','800','1','300','1','500'],['2','2000','1','800','1','800','0','0']];
 const available=v=>({status:'available',vector:Object.fromEntries(VECTOR_FIELDS.map((k,i)=>[k,v[i]]))});
 const results=[available(vectors[5]),available(['1','200','1','200','0','0','1','200']),{status:'unavailable',reason:'UNKNOWN_REVERSAL'},available(Array(8).fill('0'))];
 await mkdir(output,{mode:0o700});await sync(dirname(output));let owned=0;
 function use(path,fn){const w=worker(path,f.policy);owned++;try{return fn(w);}finally{w.close();owned--;}}
 let state=r.initializeFeatureWindowState(f.policy),contributions=r.initializeFeatureContributions(f.policy);
 const path=join(output,'worker');
 use(path,w=>{const late=structuredClone(f.deliveries[0]);late.revision.occurred_at=f.boundaries.late;const prior=w.receipt();check(w.consume(late).reason==='LATE_EVENT');assert.deepEqual(w.receipt(),prior);for(const d of f.deliveries.slice(0,3)){w.consume(d);state=r.applyFeatureWindowState(state,d).state;}});
 const prefix=await read(join(path,'publication.json'),2097152,true);
 use(path,w=>{for(const d of f.deliveries.slice(0,3))w.consume(d);});assert.deepEqual(await read(join(path,'publication.json'),2097152,true),prefix);
 const deltas=[['1','1000','0','0','0','0','0','0'],Array(8).fill('0'),['1','1000','1','1000','0','0','1','1000'],['0','0','0','-200','0','0','0','-200'],['0','0','0','0','1','300','0','-300'],['0','0','0','0','0','500','-1','-500']];
 for(const d of f.deliveries){const out=r.applyFeatureContribution(contributions,d);contributions=out.state;if(d.position<6){assert.deepEqual(VECTOR_FIELDS.map(k=>out.corrections[0].delta[k]),deltas[d.position]);assert.deepEqual(r.evaluateFeatureContributions(contributions,f.queries[0]),available(vectors[d.position]));}}
 use(path,w=>{for(const d of f.deliveries.slice(3)){w.consume(d);state=r.applyFeatureWindowState(state,d).state;}for(const [i,q]of f.queries.entries()){assert.deepEqual(r.evaluateFeatureContributions(contributions,q),results[i]);const out=r.snapshotFeatureWindowState(state,q);state=out.state;assert.deepEqual(out.snapshot.result,results[i]);assert.deepEqual(w.materialize(q),out.snapshot);}
 check(r.advanceFeatureWatermark(state,f.boundaries.ttl_equal).active.positions.length===8);w.watermark(f.boundaries.ttl_equal);state=r.advanceFeatureWatermark(state,f.boundaries.ttl_expired);w.watermark(f.boundaries.ttl_expired);assert.deepEqual(state.active.positions,[]);w.consume(f.deliveries[0]);for(const q of f.queries)assert.deepEqual(w.materialize(q),r.snapshotFeatureWindowState(state,q).snapshot);
 });
 const envelope=JSON.parse(await read(join(path,'publication.json'),2097152,true)),owner=JSON.parse(await read(join(path,'owner.json'),200,true));
 check(envelope.owner===owner.owner&&envelope.plan_sha256===PLAN);assert.deepEqual(envelope.scope,f.policy);assert.deepEqual(envelope.publication.state,state);assert.deepEqual(r.restoreFeatureWindowState(envelope.publication.state,f.policy),state);
 const {content_hash,...body}=envelope.publication;assert.equal(content_hash,featureGroupedHash([body]));check(state.contributions.evidence.next_position===8);use(path,w=>check(w.receipt().next_offset===8));
 let s=r.initializeFeatureWindowState(f.policy);const left=structuredClone(f.deliveries[0]);left.revision.occurred_at=f.boundaries.left;s=r.applyFeatureWindowState(s,left).state;assert.deepEqual(r.snapshotFeatureWindowState(s,f.queries[0]).snapshot.result,results[3]);
 left.revision.occurred_at=f.boundaries.late;check(r.applyFeatureWindowState(r.initializeFeatureWindowState(f.policy),left).reason==='LATE_EVENT');
 left.revision.occurred_at=f.boundaries.left;check(r.applyFeatureWindowState(r.initializeFeatureWindowState(f.policy),left).status==='applied');
 const future=structuredClone(f.deliveries[2]);future.position=0;future.revision.available_at='2026-01-01T12:15:00Z';
 let futureState=r.applyFeatureWindowState(r.initializeFeatureWindowState(f.policy),future).state;
 assert.deepEqual(r.snapshotFeatureWindowState(futureState,f.queries[0]).snapshot.result,results[3]);
 futureState=r.advanceFeatureWatermark(futureState,'2026-01-01T12:15:00Z');
 assert.deepEqual(r.snapshotFeatureWindowState(futureState,{...f.queries[0],as_of:'2026-01-01T12:15:00Z'}).snapshot.result,available(['1','1000','1','1000','0','0','1','1000']));
 const prior=encode(state);assert.throws(()=>r.advanceFeatureWatermark(state,f.policy.watermark));check(encode(state)===prior);
 s=r.initializeFeatureWindowState(f.policy);for(let position=0;position<8;position++)s=r.applyFeatureWindowState(s,{...f.deliveries[0],position}).state;const saved=encode(s);check(r.applyFeatureWindowState(s,{...f.deliveries[0],position:8}).reason==='LIMIT_EXCEEDED');check(encode(s)===saved);
 const {riskFixture}=await import('../../../packages/risk/fixtures/request.mjs');const {request,observation}=riskFixture();s=r.initializeFeatureWindowState(f.policy);
 for(const [position,e]of request.context.events.filter(e=>e.sender==='synthetic_A'&&e.occurred_at>'2026-01-01T11:00:00.000Z').entries())s=r.applyFeatureWindowState(s,{position,revision:{...f.deliveries[2].revision,payment_id:e.transaction_id,attempt_id:`synthetic_ref${position}`,revision_id:`synthetic_ref${position}`,revision_number:1,attempt_amount:e.amount,gross_amount:e.amount,occurred_at:e.occurred_at.replace('.000Z','Z'),available_at:e.available_at.replace('.000Z','Z')}}).state;
 const v=r.snapshotFeatureWindowState(s,f.queries[0]).snapshot.result.vector;check(v.net_amount==='265000'&&v.net_active_count==='3');const old=r.evaluateTransactionRisk(request,observation);check(old.findings.find(x=>x.code==='FRAUD_COUNT_VELOCITY').metric.value===v.net_active_count);check(old.findings.find(x=>x.code==='FRAUD_AMOUNT_VELOCITY').metric.value==='2650.00');
 await verifyWorkerEvidence(output);
 const evidence=await tree(output);for(const name of Object.keys(evidence.hashes))check(!name.includes('writer.lock')&&!name.includes('stage-'));check(owned===0);assert.deepEqual(await provenance(),before);assert.deepEqual(await tree(output),evidence);check(performance.now()-start<180000);
 check(evidence.bytes>0&&Object.keys(evidence.hashes).sort().join(',')==='worker/owner.json,worker/publication.json');
 const report={version:1,production_ready:false,plan_sha256:PLAN,source_hashes:before,evidence,deliveries:8,queries:4,owned_handles:owned,elapsed_ms:Math.ceil(performance.now()-start)};
 check(evidence.bytes+Buffer.byteLength(encode(report))<=16777216&&performance.now()-start<175000);
 const stage=join(output,`.acceptance-${randomUUID()}`),fd=await open(stage,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
 try{try{await fd.writeFile(encode(report));await fd.sync();}finally{await fd.close();}await link(stage,join(output,'acceptance.json'));}finally{await unlink(stage);}await sync(output);check(performance.now()-start<=180000);return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await runFeatureContributionsAcceptance(parseArguments(process.argv.slice(2)));process.stdout.write('FEATURE_CONTRIBUTIONS_ACCEPTANCE_RECORDED\n');}catch{process.stderr.write('FEATURE_CONTRIBUTIONS_ACCEPTANCE_FAILED\n');process.exitCode=1;}}
