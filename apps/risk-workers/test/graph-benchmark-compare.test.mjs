import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertObservations, assertFixedOracle, assertSqlMetadata, compareTsOverlap, parseArguments, runGraphBenchmarkCompare } from '../scripts/graph-benchmark-compare.mjs';
import { graphSqlProfiles } from '../dist/graph-sql.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(new URL('../scripts/graph-benchmark-compare.mjs',import.meta.url));
const fixture=JSON.parse(readFileSync(new URL('../fixtures/graph-benchmark.json',import.meta.url)));
function python(corpus) {
  const p=spawnSync(join(root,'.venv/bin/python'),['-B','-I',join(root,'services/ml-inference/lmps_ml/graph_benchmark.py')],{input:JSON.stringify(corpus),encoding:'utf8',timeout:10000,maxBuffer:16777216,env:{LANG:'C.UTF-8'}});
  assert.ifError(p.error); assert.equal(p.status,0); assert.equal(p.stderr,''); return JSON.parse(p.stdout).observations;
}
test('actual Python fixed independent assertions: every frozen case and finite profile',()=>{
  for(const entry of [...fixture.cases,...graphSqlProfiles(fixture.cases[0].corpus).map((corpus,i)=>({name:['burst','skew','dense'][i],corpus}))]) {
    for(const o of python(entry.corpus)) assertFixedOracle(entry.name,o);
  }
});
test('supplementary diagnostics reject forged expected copies, arithmetic, witnesses, coverage, future leakage and hashes; never native proof',()=>{
  const [o]=python(fixture.cases[0].corpus);
  assert.throws(()=>assertFixedOracle('fan',fixture.cases[0].oracle));
  for(const mutate of [x=>x.metrics.net_cents='4001',x=>x.metrics.paths.find(p=>p.edges.length===2).edges.reverse(),x=>x.coverage.complete=false,x=>x.source_prefix++,x=>x.currency='EUR',x=>x.namespace='synthetic_other',x=>x.corpus_sha256='forged',x=>x.query_sha256='forged',x=>x.semantics_sha256='forged',x=>x.truncated=true,x=>x.availability={status:'unavailable',reason:'target_unavailable'},x=>x.metrics.edges++,x=>x.metrics.paths.push({edges:[{namespace:'synthetic_graph',transaction_id:'future',revision_number:2}]})]) {
    const changed=structuredClone(o); mutate(changed); assert.throws(()=>assertObservations(changed,o));
  }
  const c=structuredClone(fixture.cases[0].corpus); c.deliveries[0].event.amount='11.00';
  assert.throws(()=>assertObservations(python(c),[o]));
  assert.throws(()=>assertFixedOracle('unknown',o));
});
test('unchanged actual TS detector agrees on target-anchored small projections; differences remain explicit',async()=>{
  for(const e of fixture.cases.filter(e=>e.ts_overlap)) {
    const r=await compareTsOverlap(e); assert.equal(r.support,'overlap'); assert.ok(r.differences.length>0);
  }
  assert.equal((await compareTsOverlap(fixture.cases.find(e=>!e.ts_overlap))).support,'unsupported');
});
test('inert import, strict CLI, no public runner/result override and bounded sanitized CLI errors',()=>{
  const p=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/graph-benchmark-compare.mjs',import.meta.url).href)})`],{encoding:'utf8',timeout:5000,maxBuffer:4096});
  assert.equal(p.status,0); assert.equal(p.stdout+p.stderr,'');
  assert.equal(runGraphBenchmarkCompare.length,1);
  for(const args of [[],['--output','/tmp/x'],['--output',join(root,'.local/postgres-copy')],['--output',join(root,'.local/x'),'--success','true']]) assert.throws(()=>parseArguments(args));
  const bad=spawnSync(process.execPath,[script,'--output','/tmp/x'],{encoding:'utf8',timeout:5000,maxBuffer:4096});
  assert.equal(bad.status,1); assert.equal(bad.stdout,''); assert.equal(bad.stderr.trim(),'GRAPH_COMPARE_UNAVAILABLE');
});
test('supplementary metadata cannot hide uncertain cleanup, changed runtime/source/input or oversized output',()=>{
  const current={node:process.version,fixture_sha256:'fixture',source_hashes:{source:'a',compiled:'b'}};
  const report={scope:'local_synthetic',production_ready:false,cleanup:'confirmed',timing_unit:'milliseconds',profile:'no_index',elapsed_ms:1,runtime:{node:process.version},fixture_sha256:current.fixture_sha256,source_hashes:current.source_hashes};
  assertSqlMetadata(report,current);
  for(const mutate of [r=>r.cleanup='unknown',r=>r.runtime.node='forged',r=>r.source_hashes.source='changed',r=>r.source_hashes.compiled='changed',r=>r.fixture_sha256='changed',r=>r.elapsed_ms=180001,r=>r.partial=true,r=>r.payload='x'.repeat(16777216)]) {
    const r=structuredClone(report); mutate(r);
    // Unexpected metadata must not be silently interpreted as complete evidence.
    assert.throws(()=>assertSqlMetadata(r,current));
  }
  const oversized={payload:'x'.repeat(16777216)}; assert.throws(()=>assertObservations(oversized,oversized));
});
test('existing and symlink destinations fail before Python or native execution',async()=>{
  await mkdir(join(root,'.local'),{recursive:true,mode:0o700}); const p=await mkdtemp(join(root,'.local/compare-test-'));
  try {
    await assert.rejects(runGraphBenchmarkCompare(p));
    await symlink(p,join(p,'link')); await assert.rejects(runGraphBenchmarkCompare(join(p,'link/output')));
    await assert.rejects(runGraphBenchmarkCompare(join(p,'unused'),{success:true}));
  } finally { await rm(p,{recursive:true,force:true}); }
});
test('parent-host native: genuine comparison only, no mocked native acceptance',{skip:process.env.LMPS_GRAPH_PARENT_NATIVE!=='1',timeout:240000},async()=>{
  const output=join(root,'.local',`graph-compare-${process.pid}-${Date.now()}`);
  const r=await runGraphBenchmarkCompare(output);
  assert.equal(r.status,'matched'); assert.equal(r.cleanup,'confirmed'); assert.equal(r.production_ready,false);
  assert.equal(r.comparisons.length,fixture.cases.length+3);
  assert.deepEqual(JSON.parse(readFileSync(join(output,'comparison.json'))),r);
});
