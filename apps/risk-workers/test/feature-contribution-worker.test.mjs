import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, statSync, symlinkSync, unlinkSync, linkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openFeatureContributionWorker as open } from '../dist/feature-contribution-worker.js';
import { VECTOR_FIELDS } from '@lmps/contracts/feature-catalog';
import { spawnSync } from 'node:child_process';
const f=JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/p04-extended-golden.json',import.meta.url)));
const root=fileURLToPath(new URL('../../../.local/',import.meta.url));
mkdirSync(root,{recursive:true,mode:0o700});
function fixture(t){const dir=mkdtempSync(join(root,'p04-worker-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); return join(dir,'state');}
const bytes=p=>readFileSync(join(p,'publication.json'),'utf8');
test('durable prefix reopen, exact replay, independent outputs and frozen TTL history',t=>{
 const p=fixture(t); let w=open(p,f.policy);
 for(const d of f.deliveries.slice(0,3)) w.consume(d);
 const frozen=w.materialize(f.queries[0]); const saved=w.receipt(); w.close();
 w=open(p,f.policy); assert.deepEqual(w.receipt(),saved);
 const before=bytes(p); w.consume(f.deliveries[0]); assert.equal(bytes(p),before);
 for(const d of f.deliveries.slice(3)) w.consume(d);
 assert.deepEqual(w.materialize(f.queries[0]),frozen);
 for(const [i,q] of f.queries.slice(1).entries()){
   const result=w.materialize(q).result, expected=f.expected_final[i+1];
   if(expected.reason) assert.equal(result.reason,expected.reason);
   else assert.deepEqual(VECTOR_FIELDS.map(k=>result.vector[k]),expected.vector);
 }
 w.watermark(f.boundaries.ttl_expired); w.close();
 w=open(p,f.policy); assert.equal(w.receipt().next_offset,8); assert.deepEqual(w.materialize(f.queries[0]),frozen); w.close(); w.close();
 assert.equal(statSync(p).mode&0o777,0o700);
 for(const n of ['owner.json','publication.json']) assert.equal(statSync(join(p,n)).mode&0o777,0o600);
});
test('publication fault seams require close/reopen and durable replay',t=>{
 for(const point of ['before_publish','after_publish']){
   const p=fixture(t); let armed=false;
   let w=open(p,f.policy,x=>{if(armed&&x===point) throw Error('unit');}); armed=true;
   assert.throws(()=>w.consume(f.deliveries[0]),e=>e.code==='FEATURE_WORKER');
   assert.throws(()=>w.receipt()); w.close();
   w=open(p,f.policy); assert.equal(w.receipt().next_offset,point==='after_publish'?1:0);
   w.consume(f.deliveries[0]); assert.equal(w.receipt().next_offset,1); w.close();
 }
});
test('exclusive writer, changed identity/cursor/replay and failed input immutability',t=>{
 const p=fixture(t), w=open(p,f.policy); assert.throws(()=>open(p,f.policy));
 w.consume(f.deliveries[0]); const before=bytes(p);
 const changed=structuredClone(f.deliveries[0]); changed.revision.attempt_amount='9.00';
 for(const d of [changed,{...f.deliveries[1],position:2},{position:-1,revision:f.deliveries[0].revision}]){
  const original=JSON.stringify(d); assert.throws(()=>w.consume(d)); assert.equal(JSON.stringify(d),original); assert.equal(bytes(p),before);
 }
 assert.throws(()=>w.watermark('2026-01-01T11:00:00Z')); assert.equal(bytes(p),before);
 w.close(); assert.throws(()=>open(p,{...f.policy,input_identity:'synthetic_other'})); assert.equal(bytes(p),before);
 const original=bytes(p); writeFileSync(join(p,'publication.json'),original.replace('"next_position":1','"next_position":0'));
 assert.throws(()=>open(p,f.policy)); writeFileSync(join(p,'publication.json'),original);
 const reopened=open(p,f.policy); reopened.close();
});
test('unsafe permissions, symbolic/hard links and stranded ownership preserve evidence',t=>{
 for(const mode of ['permission','symlink','hardlink','lock']){
  const p=fixture(t); open(p,f.policy).close(); const cp=join(p,'publication.json'), text=bytes(p);
  if(mode==='permission') chmodSync(cp,0o644);
  if(mode==='symlink'){writeFileSync(join(dirname(p),'target'),text,{mode:0o600}); unlinkSync(cp); symlinkSync('../target',cp);}
  if(mode==='hardlink') linkSync(cp,join(dirname(p),'copy'));
  if(mode==='lock') writeFileSync(join(p,'writer.lock'),'dead-pid',{mode:0o600});
  assert.throws(()=>open(p,f.policy)); assert.equal(bytes(p),text);
 }
});
test('rejected late and exact/one-over retained history/query limits do not publish',t=>{
 const p=fixture(t), policy=structuredClone(f.policy); policy.limits.deliveries=2; policy.limits.queries=1;
 const w=open(p,policy), late=structuredClone(f.deliveries[0]); late.revision.occurred_at=f.boundaries.late;
 let before=bytes(p); assert.equal(w.consume(late).reason,'LATE_EVENT'); assert.equal(bytes(p),before);
 w.consume(f.deliveries[0]); w.consume(f.deliveries[1]); before=bytes(p);
 assert.equal(w.consume(f.deliveries[2]).reason,'LIMIT_EXCEEDED'); assert.equal(bytes(p),before);
 w.materialize(f.queries[0]); before=bytes(p); assert.throws(()=>w.materialize(f.queries[1])); assert.equal(bytes(p),before); w.close();
});
test('complete serialized checkpoint byte bound accepts equality and refuses one less',t=>{
 const policy=structuredClone(f.policy);
 // Policy byte digits are themselves serialized; converge using actual envelope sizes.
 for(let i=0;i<4;i++){
  const p=fixture(t), w=open(p,policy); const n=Buffer.byteLength(bytes(p)); w.close(); policy.limits.bytes=n;
 }
 const p=fixture(t), w=open(p,policy); assert.equal(Buffer.byteLength(bytes(p)),policy.limits.bytes);
 const before=bytes(p); assert.throws(()=>w.consume(f.deliveries[0]),e=>e.code==='FEATURE_WORKER'); assert.equal(bytes(p),before); w.close();
 policy.limits.bytes--; assert.throws(()=>open(fixture(t),policy),e=>e.code==='FEATURE_WORKER');
});
test('corrupt derived state and changed semantic version fail without overwriting',t=>{
 const p=fixture(t); let w=open(p,f.policy); w.consume(f.deliveries[0]); w.close(); const saved=bytes(p);
 for(const mutate of [x=>{x.publication.state.active.positions=[];},x=>{x.publication.content_hash='0'.repeat(64);},x=>{x.publication.state.contributions.evidence.deliveries=[];},x=>{x.plan_sha256='0'.repeat(64);}]){
  const x=JSON.parse(saved); mutate(x); const bad=JSON.stringify(x); writeFileSync(join(p,'publication.json'),bad);
  assert.throws(()=>open(p,f.policy)); assert.equal(bytes(p),bad);
 }
 writeFileSync(join(p,'publication.json'),saved);
 assert.throws(()=>open(p,{...f.policy,semantics:'synthetic_changed'}),e=>e.code==='FEATURE_WORKER');
 w=open(p,f.policy); w.close();
});
test('import is inert in an empty working directory with no service startup',t=>{
 const p=fixture(t); mkdirSync(p,{mode:0o700});
 const module=new URL('../dist/feature-contribution-worker.js',import.meta.url).href;
 const out=spawnSync(process.execPath,['--input-type=module','-e',`import {readdirSync} from 'node:fs'; await import(${JSON.stringify(module)}); if(readdirSync('.').length) process.exitCode=1;`],{cwd:p,timeout:5000,encoding:'utf8'});
 assert.equal(out.status,0,out.stderr); assert.equal(out.stdout,'');
});
test('independent payment/attempt/revision/hot-key caps and eight frozen queries',t=>{
 for(const key of ['payments','attempts','revisions_per_payment','deliveries_per_key']){
  const policy=structuredClone(f.policy); policy.limits[key]=2;
  const p=fixture(t), w=open(p,policy);
  const delivery=position=>{
   const d=structuredClone(f.deliveries[2]); d.position=position; d.revision.revision_number=position+1; d.revision.revision_id=`synthetic_limit${position}`;
   if(key==='payments'||key==='attempts'){d.revision.payment_id=`synthetic_limit${position}`; d.revision.attempt_id=`synthetic_limit${position}`;}
   return d;
  };
  for(let i=0;i<2;i++) assert.equal(w.consume(delivery(i)).status,'applied');
  const before=bytes(p); assert.equal(w.consume(delivery(2)).reason,'LIMIT_EXCEEDED'); assert.equal(bytes(p),before); w.close();
 }
 const p=fixture(t), w=open(p,f.policy);
 for(let i=0;i<8;i++) w.materialize({...f.queries[0],id:`synthetic_frozen${i}`});
 const before=bytes(p); assert.throws(()=>w.materialize({...f.queries[0],id:'synthetic_ninth'})); assert.equal(bytes(p),before); w.close();
});

test('each hand-calculated prefix and final output survives durable reopen',t=>{
 for(let end=1;end<=6;end++){
  const p=fixture(t); let w=open(p,f.policy);
  for(const d of f.deliveries.slice(0,end)){
   const out=w.consume(d);
   assert.deepEqual(VECTOR_FIELDS.map(k=>out.corrections[0].delta[k]),f.expected_prefix_deltas[d.position]);
  }
  w.close(); w=open(p,f.policy);
  assert.deepEqual(VECTOR_FIELDS.map(k=>w.materialize(f.queries[0]).result.vector[k]),f.expected_prefix_vectors[end-1]);
  w.close();
 }
 const p=fixture(t); let w=open(p,f.policy);
 for(const d of f.deliveries) w.consume(d);
 for(const [i,q] of f.queries.entries()){
  const result=w.materialize(q).result, expected=f.expected_final[i];
  if(expected.reason) assert.deepEqual(result,{status:'unavailable',reason:expected.reason});
  else assert.deepEqual(VECTOR_FIELDS.map(k=>result.vector[k]),expected.vector);
 }
 w.watermark(f.boundaries.ttl_equal); w.close(); w=open(p,f.policy);
 const checkpoint=JSON.parse(bytes(p));
 assert.equal(checkpoint.publication.state.active.positions.length,8);
 assert.equal(w.receipt().watermark,f.boundaries.ttl_equal);
 assert.match(w.receipt().policy_hash,/^[a-f0-9]{64}$/);
 w.watermark(f.boundaries.ttl_expired); w.close(); w=open(p,f.policy);
 assert.deepEqual(JSON.parse(bytes(p)).publication.state.active.positions,[]);
 assert.deepEqual(VECTOR_FIELDS.map(k=>w.materialize(f.queries[0]).result.vector[k]),f.expected_final[0].vector);
 w.close();
});

test('lateness equality admits, window excludes left equality, malformed descriptors are inert',t=>{
 const p=fixture(t), w=open(p,f.policy), d=structuredClone(f.deliveries[2]);
 d.position=0; d.revision.occurred_at=f.boundaries.left;
 assert.equal(w.consume(d).status,'applied');
 assert.deepEqual(VECTOR_FIELDS.map(k=>w.materialize(f.queries[0]).result.vector[k]),Array(8).fill('0'));
 const before=bytes(p); let touched=false;
 const bad={position:1,get revision(){touched=true; throw Error('getter');}};
 assert.throws(()=>w.consume(bad),e=>e.code==='FEATURE_WORKER');
 assert.equal(touched,false); assert.equal(bytes(p),before);
 w.close();
});

test('watermark and frozen-query fault recovery validate the actual published generation',t=>{
 for(const operation of ['watermark','materialize']) for(const point of ['before_publish','after_publish']){
  const p=fixture(t); let armed=false;
  let w=open(p,f.policy,x=>{if(armed&&x===point) throw Error('unit');});
  w.consume({...f.deliveries[2],position:0});
  const before=w.receipt(), disk=bytes(p); armed=true;
  const invoke=()=>operation==='watermark'?w.watermark(f.boundaries.ttl_equal):w.materialize(f.queries[0]);
  assert.throws(invoke,e=>e.code==='FEATURE_WORKER');
  assert.throws(()=>w.consume(f.deliveries[0]));
  if(point==='before_publish') assert.equal(bytes(p),disk);
  w.close(); w=open(p,f.policy);
  assert.equal(w.receipt().generation,before.generation+(point==='after_publish'?1:0));
  invoke(); const settled=bytes(p); invoke(); assert.equal(bytes(p),settled);
  assert.equal(w.receipt().next_offset,1); w.close();
 }
});

test('live checkpoint replacement blocks every operation without overwriting evidence',t=>{
 const p=fixture(t), w=open(p,f.policy);
 w.consume(f.deliveries[0]);
 const saved=bytes(p), changed=JSON.parse(saved);
 changed.plan_sha256='0'.repeat(64);
 const evidence=JSON.stringify(changed);
 writeFileSync(join(p,'publication.json'),evidence);
 for(const invoke of [()=>w.consume(f.deliveries[1]),()=>w.watermark(f.boundaries.ttl_equal),
  ()=>w.materialize(f.queries[0]),()=>w.receipt(),()=>w.close()]){
  assert.throws(invoke,e=>e.code==='FEATURE_WORKER');
  assert.equal(bytes(p),evidence);
 }
 assert.throws(()=>open(p,f.policy),e=>e.code==='FEATURE_WORKER');
 // Only restoration of the exact owned evidence lets the original handle close.
 writeFileSync(join(p,'publication.json'),saved);
 w.close(); open(p,f.policy).close();
});

test('unowned directories and extra files cannot become worker output',t=>{
 for(const populated of [false,true]){
  const p=fixture(t); mkdirSync(p,{mode:0o700});
  if(populated) writeFileSync(join(p,'evidence'),'preserve',{mode:0o600});
  assert.throws(()=>open(p,f.policy),e=>e.code==='FEATURE_WORKER');
  if(populated) assert.equal(readFileSync(join(p,'evidence'),'utf8'),'preserve');
 }
 const p=fixture(t); open(p,f.policy).close();
 const before=bytes(p); writeFileSync(join(p,'unexpected'),'preserve',{mode:0o600});
 assert.throws(()=>open(p,f.policy),e=>e.code==='FEATURE_WORKER');
 assert.equal(bytes(p),before);
 assert.equal(readFileSync(join(p,'unexpected'),'utf8'),'preserve');
});
