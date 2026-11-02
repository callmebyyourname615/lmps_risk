import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonical, runtimeBinding, compare, verify, main } from '../scripts/feature-parity.mjs';
import { FEATURE_PARITY_VERSION as version, FEATURE_PARITY_SEMANTICS as semantics, featureParityInputHash, validateFeatureParityInput } from '../../../packages/contracts/dist/feature-parity.js';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const script=join(root,'apps/risk-workers/scripts/feature-parity.mjs');
const hash=x=>createHash('sha256').update(x).digest('hex');
const at='2026-01-01T12:00:00Z';
const rec=(id,extra={})=>({event_id:'synthetic_'+id,key:'synthetic_key',currency:'USD',revision:0,source_position:0,occurred_at:at,available_at:at,availability_sha256:'a'.repeat(64),record_sha256:'b'.repeat(64),amount:'1.25',active:true,...extra});
const query=(id,member_ids,extra={})=>({id:'synthetic_'+id,key:'synthetic_key',currency:'USD',as_of:at,anchor_at:at,window_seconds:3600,member_ids:member_ids.map(x=>'synthetic_'+x).sort(),...extra});
function fixture(records, queries) {
  mkdirSync(join(root,'.local'),{recursive:true,mode:0o700});
  const dir=mkdtempSync(join(root,'.local/parity-unit-'));
  const input={version,mode:'local_synthetic',records:records.map((r,source_position)=>({...r,source_position}))};
  const plan={version,mode:'local_synthetic',input_sha256:featureParityInputHash(input),semantics,runtime:runtimeBinding(),fixture:{now:at,retention_seconds:3600,coverage:'explicit_cohort_only'},queries};
  const source=join(dir,'source.json'), planPath=join(dir,'plan.json');
  writeFileSync(source,canonical(input),{mode:0o600});writeFileSync(planPath,canonical(plan),{mode:0o600});
  return {dir,source,planPath,plan,input};
}
test('actual Python dataset and TS stream: correction, future, reversal, currency, unavailable and zero',async()=>{
  const f=fixture([rec('a'),rec('a',{revision:1,amount:'2.50'}),rec('a',{revision:2,amount:'99.00',available_at:'2026-01-01T12:00:01Z'}),rec('b',{amount:'8.00'}),rec('b',{revision:1,active:false,amount:'8.00'}),rec('c',{currency:'EUR',amount:'7.00'}),rec('d',{available_at:null,availability_sha256:null}),rec('edge',{occurred_at:'2026-01-01T11:00:00Z',amount:'100.00'}),rec('future',{available_at:'2026-01-01T12:00:01Z'})],
    [query('usd',['a','b','edge']),query('eur',['c'],{currency:'EUR'}),query('missing',['d']),query('empty',[]),query('future',['future'])]);
  try {
    const r=await compare(f.source,f.planPath);
    assert.deepEqual(r.online.map(x=>[x.status,x.count,x.amount]),[['available','1','2.50'],['available','1','7.00'],['unavailable',null,null],['available','0','0.00'],['unavailable',null,null]]);
    assert.deepEqual(r.online,r.offline);
    const output=join(f.dir,'evidence');
    const run=spawnSync(process.execPath,[script,'--source',f.source,'--plan',f.planPath,'--output',output],{cwd:f.dir,encoding:'utf8',timeout:170000});
    assert.equal(run.status,0,run.stderr);
    const original=readFileSync(join(output,'evidence.json'));
    await verify(output);
    await assert.rejects(main(['--source',f.source,'--plan',f.planPath,'--output',output]));
    assert.deepEqual(readFileSync(join(output,'evidence.json')),original);
    const forged=JSON.parse(original);forged.offline[0].amount='99.00';
    writeFileSync(join(output,'evidence.json'),canonical(forged));
    await assert.rejects(verify(output));
    const wrong=JSON.parse(original);wrong.provenance['packages/risk/dist/feature-stream.js']='0'.repeat(64);
    writeFileSync(join(output,'evidence.json'),canonical(wrong));await assert.rejects(verify(output));
    const wrongRuntime=JSON.parse(original);wrongRuntime.runtime.python='fake_module';
    writeFileSync(join(output,'evidence.json'),canonical(wrongRuntime));await assert.rejects(verify(output));
    writeFileSync(join(output,'evidence.json'),original);
    writeFileSync(f.source,canonical({...f.input,records:[]}));
    await assert.rejects(verify(output));
  } finally {rmSync(f.dir,{recursive:true,force:true});}
});
test('actual exact source bytes/records, selected cap and one-over; eight query cap',async()=>{
  const records=Array.from({length:2000},(_,i)=>rec('r'+i));
  const f=fixture(records,[query('exact',Array.from({length:256},(_,i)=>'r'+i)),query('over',Array.from({length:257},(_,i)=>'r'+i))]);
  try {
    const raw=readFileSync(f.source);writeFileSync(f.source,Buffer.concat([raw,Buffer.alloc(2097152-raw.length,32)]));
    const result=await compare(f.source,f.planPath);
    assert.deepEqual(result.online.map(o=>[o.status,o.count,o.amount]),[['available','256','320.00'],['unsupported',null,null]]);
    writeFileSync(f.source,Buffer.concat([readFileSync(f.source),Buffer.from(' ')]));
    await assert.rejects(compare(f.source,f.planPath));
    writeFileSync(f.source,raw);
    f.plan.queries=Array.from({length:8},(_,i)=>query('q'+i,[]));writeFileSync(f.planPath,canonical(f.plan));
    assert.equal((await compare(f.source,f.planPath)).report.comparisons.length,8);
    f.plan.queries.push(query('ninth',[]));writeFileSync(f.planPath,canonical(f.plan));await assert.rejects(compare(f.source,f.planPath));
  } finally {rmSync(f.dir,{recursive:true,force:true});}
});
test('strict inert CLI, runtime binding, unsafe paths and unsupported cases',async()=>{
  assert.notEqual(spawnSync(process.execPath,[script],{encoding:'utf8'}).status,0);
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',`import ${JSON.stringify(script)}`],{encoding:'utf8'}).status,0);
  const f=fixture([rec('a',{amount:'0.00'})],[query('zero',['a']),query('window',[],{window_seconds:60})]);
  try {
    const r=await compare(f.source,f.planPath);assert.deepEqual(r.report.comparisons.map(x=>x.status),['unsupported','unsupported']);
    f.plan.runtime.compiled_sha256='0'.repeat(64);writeFileSync(f.planPath,canonical(f.plan));
    await assert.rejects(compare(f.source,f.planPath));
    const link=join(f.dir,'link');symlinkSync(f.source,link);await assert.rejects(compare(link,f.planPath));
    const hard=join(f.dir,'hard');linkSync(f.source,hard);await assert.rejects(compare(f.source,f.planPath));rmSync(hard);
    await assert.rejects(main(['--source',f.source,'--plan',f.planPath,'--output','/tmp/forbidden']));
    await assert.rejects(main(['--runner','fake']));
  } finally {rmSync(f.dir,{recursive:true,force:true});}
});
test('exact and one-over contract input record and byte limits',()=>{
  const input={version,mode:'local_synthetic',records:Array.from({length:2000},(_,i)=>rec('r'+i,{source_position:i}))};
  assert.equal(validateFeatureParityInput(input).records.length,2000);
  assert.throws(()=>validateFeatureParityInput({...input,records:[...input.records,rec('over',{source_position:2000})]}));
  assert.throws(()=>validateFeatureParityInput({...input,extra:'x'.repeat(2097152)}));
  assert.equal(hash(canonical(input)).length,64);
});
