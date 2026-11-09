import { constants } from 'node:fs';
import { open, lstat, mkdir, realpath } from 'node:fs/promises';
import { join, dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { deepStrictEqual } from 'node:assert';
import { parseArguments, runGraphSqlBaseline } from './graph-sql-baseline.mjs';
export { parseArguments };
const root = fileURLToPath(new URL('../../../', import.meta.url));
const max = 16777216;
const hash = b => createHash('sha256').update(b).digest('hex');
function check(ok) { if (!ok) throw Error('GRAPH_COMPARE_INVALID'); }
function equal(a,b) { try { deepStrictEqual(a,b); } catch { throw Error('GRAPH_COMPARE_MISMATCH'); } }
async function read(path, limit=max) {
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const s=await f.stat(); check(s.isFile()&&s.size<=limit); const b=Buffer.alloc(s.size+1); let n=0;
    while(n<b.length) { const r=await f.read(b,n,b.length-n,n); if(!r.bytesRead) break; n+=r.bytesRead; }
    check(n===s.size); return b.subarray(0,n);
  } finally { await f.close(); }
}
async function destination(output) {
  parseArguments(['--output',output]); let p=parse(output).root;
  for(const part of dirname(output).slice(p.length).split('/').filter(Boolean)) { p=join(p,part); const s=await lstat(p); check(s.isDirectory()&&!s.isSymbolicLink()); }
  const s=await lstat(p); check(s.uid===process.getuid()&&!(s.mode&0o022));
  try { await lstat(output); check(false); } catch(e) { if(e.code!=='ENOENT') throw e; }
}
const sources=['apps/risk-workers/src/graph-sql.ts','apps/risk-workers/dist/graph-sql.js','apps/risk-workers/src/graph-benchmark-contract.ts','apps/risk-workers/dist/graph-benchmark-contract.js','apps/risk-workers/fixtures/graph-benchmark.json','apps/risk-workers/scripts/graph-sql-baseline.mjs','apps/risk-workers/scripts/graph-benchmark-compare.mjs','services/ml-inference/lmps_ml/graph_benchmark.py','packages/risk/src/features.ts','packages/risk/dist/features.js','packages/risk/src/index.ts','packages/risk/dist/index.js','packages/database/scripts/local.mjs','infrastructure/postgres/major-version','infrastructure/postgres/postgresql.conf'];
async function snapshot() {
  const result={}; for(const p of sources) result[p]=hash(await read(join(root,p)));
  for(const [name,p] of [['node',process.execPath],['python',join(root,'.venv/bin/python')]]) result[`runtime:${name}`]=hash(await read(await realpath(p),134217728));
  return result;
}
function python(bytes) {
  const start=performance.now();
  const p=spawnSync(join(root,'.venv/bin/python'),['-B','-I',join(root,'services/ml-inference/lmps_ml/graph_benchmark.py')],{input:bytes,encoding:'utf8',timeout:10000,maxBuffer:max,env:{LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'}});
  check(!p.error&&p.status===0&&!p.signal&&p.stderr==='');
  const result=JSON.parse(p.stdout); equal(Object.keys(result).sort(),['observations','version']); equal(result.version,'local_synthetic_graph_v1');
  return {observations:result.observations,elapsed_ms:performance.now()-start};
}
function installedRuntime() {
  const url=new URL('../../../packages/database/scripts/local.mjs',import.meta.url).href;
  const p=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(url)}); m.localMode(); process.stdout.write(JSON.stringify(m.binaryDirectory()))`],{encoding:'utf8',timeout:10000,maxBuffer:65536,detached:true,killSignal:'SIGKILL'});
  if(p.pid) { try { process.kill(-p.pid,'SIGKILL'); } catch(e) { check(e.code==='ESRCH'); } }
  check(!p.error&&p.status===0&&!p.signal&&!p.stderr); const r=JSON.parse(p.stdout);
  check(r.directory===resolve(r.directory)&&/^\d+\.\d+$/.test(r.version)); return r;
}
// Diagnostic assertions cannot publish or grant native acceptance.
export function assertObservations(actual,reference) { check(Buffer.byteLength(JSON.stringify(actual))<=max); equal(actual,reference); }
// Supplementary metadata assertion, never a native execution or publication API.
export function assertSqlMetadata(sql,current) {
  check(Object.keys(sql).every(k=>['version','scope','production_ready','cleanup','timing_unit','profile','elapsed_ms','runtime','fixture_sha256','source_hashes','setup_ms','setup_scope','observations'].includes(k)));
  check(sql.cleanup==='confirmed'&&sql.scope==='local_synthetic'&&sql.production_ready===false&&sql.timing_unit==='milliseconds'&&sql.profile==='no_index');
  check(Number.isFinite(sql.elapsed_ms)&&sql.elapsed_ms>=0&&sql.elapsed_ms<=180000);
  equal(sql.runtime.node,current.node); equal(sql.fixture_sha256,current.fixture_sha256);
  equal(sql.source_hashes,current.source_hashes);
  check(Buffer.byteLength(JSON.stringify(sql))<=max);
}
const fixed={fan:['4000',4,[['in1','out1'],['in1','out2'],['in2','out1'],['in2','out2']],[]],chain_cycle:['3000',3,[['a','b'],['b','c']],[['a','b','c']]],equal_time:['2000',2,[],[]],lifecycle:['1500',1,[],[]],isolation:['1000',1,[],[]],future_revision:['1000',1,[],[]],prefix_revision:['1000',1,[],[]],window:['1000',1,[],[]],future_only:'target_unavailable',identity:'identity_unverified',partial_history:'history_incomplete',missing_history:'history_incomplete',burst:['128000',128,[],[]],skew:['1000',1,[],[]],dense:['64000',64,[],[]]};
export function assertFixedOracle(name,o) {
  const v=fixed[name]; check(v);
  if(typeof v==='string') { equal(o.availability,{status:'unavailable',reason:v}); equal(o.metrics,null); equal(o.truncated,false); return; }
  equal(o.availability,{status:'available'}); equal(o.truncated,false);
  equal([o.metrics.net_cents,o.metrics.edges],[v[0],v[1]]);
  const ids=p=>p.edges.map(e=>e.transaction_id);
  equal(o.metrics.paths.filter(p=>p.edges.length===2).map(ids).sort(),[...v[2]].sort()); equal(o.metrics.cycles.map(ids).sort(),[...v[3]].sort());
  if(name==='fan') { equal(o.metrics.fan_in.find(n=>n.handle==='synthetic_H').count,2); equal(o.metrics.fan_out.find(n=>n.handle==='synthetic_H').count,2); }
  if(['burst','skew','dense'].includes(name)) equal([o.metrics.nodes,o.metrics.emitted_path_states],{burst:[129,128],skew:[2,1],dense:[16,64]}[name]);
}
export async function compareTsOverlap(entry) {
  if(!entry?.ts_overlap) return {support:'unsupported',reason:'outside documented small single-revision overlap'};
  const {calculateRiskFeatures}=await import('../../../packages/risk/dist/features.js'); const c=entry.corpus,q=c.queries[0],results=[];
  for(const {event:t} of c.deliveries) {
    const target={namespace:t.namespace,transaction_id:t.transaction_id,revision_number:t.revision_number};
    const f=calculateRiskFeatures({target,policy:{currency:q.currency,window_seconds:3600,baseline_windows:1,minimum_amount:'1.00',structuring_ceiling:'100.00',near_threshold_bps:9000,graph_depth:q.max_hops},context:{events:c.deliveries.map(d=>d.event),as_of:q.as_of,identity_status:'synthetic_declared',coverage_complete:true,coverage_start:q.coverage.start}},{status:'available',currency:t.currency,amount:t.amount,reversed_amount:t.reversed_amount,transaction_status:t.status});
    results.push({target,features:Object.fromEntries(['MULE_FAN_IN','MULE_FAN_OUT','MULE_NETWORK_CYCLE','AML_MULTI_HOP_FLOW'].map(k=>[k,{...f[k],...(f[k].value===undefined?{}:{value:String(f[k].value)})}]))});
  }
  const projected=python(Buffer.from(JSON.stringify({...c,queries:results.map((r,i)=>({...q,id:`ts_overlap_${i}`,target:r.target,anchor_at:c.deliveries[i].event.occurred_at}))})));
  const differences=[];
  for(let i=0;i<results.length;i++) {
    const r=results[i],t=c.deliveries[i].event,m=projected.observations[i].metrics;
    if(!m) {
      equal(projected.observations[i].availability,{status:'unavailable',reason:'history_incomplete'});
      for(const f of Object.values(r.features)) equal(f.reason,'HISTORY_INCOMPLETE');
      differences.push({target:r.target,reason:'target_window_precedes_declared_coverage',ts_availability:'HISTORY_INCOMPLETE',benchmark_target_projection:projected.observations[i].availability});
      continue;
    }
    const ends=p=>['namespace','transaction_id','revision_number'].every(k=>p.edges.at(-1)[k]===r.target[k]);
    // TS returns only the longest target-ending path/cycle, while B13 emits all.
    const expected={MULE_FAN_IN:m.fan_in.find(n=>n.handle===t.receiver).count,MULE_FAN_OUT:m.fan_out.find(n=>n.handle===t.sender).count,MULE_NETWORK_CYCLE:Math.max(0,...m.cycles.filter(ends).map(p=>p.edges.length)),AML_MULTI_HOP_FLOW:Math.max(1,...m.paths.filter(ends).map(p=>p.edges.length))};
    for(const [code,value] of Object.entries(expected)) {
      equal(r.features[code].value,String(value));
      const witnesses=(code==='MULE_NETWORK_CYCLE'?m.cycles:m.paths).filter(ends);
      differences.push({target:r.target,code,ts_value:r.features[code].value,benchmark_projected_value:String(value),ts_refs:r.features[code].refs,benchmark_target_ending_witnesses:witnesses});
    }
  }
  return {support:'overlap',difference:'TS target-time anchored longest target-ending witness; benchmark query-time anchored all-node paths; distinct work budgets',results,differences,projection:projected};
}
/** Closed default flow; no caller corpus, runner, runtime, result or success override. */
export async function runGraphBenchmarkCompare(output) {
  check(arguments.length===1); await destination(output);
  check(!Object.keys(process.env).some(k=>k.startsWith('PG')||k==='LMPS_PG_BIN'||k.includes('POSTGRES_DSN')));
  const before=await snapshot();
  const raw=await read(join(root,'apps/risk-workers/fixtures/graph-benchmark.json'),2097152),fixture=JSON.parse(raw);
  const {graphSqlPlan,graphSqlProfiles}=await import('../dist/graph-sql.js');
  const inputs=[...fixture.cases.map(entry=>({name:entry.name,corpus:entry.corpus,entry})),...graphSqlProfiles(fixture.cases[0].corpus).map((corpus,i)=>({name:['burst','skew','dense'][i],corpus}))];
  const refs=[];
  for(const input of inputs) {
    const plan=graphSqlPlan(input.corpus),bytes=Buffer.from(JSON.stringify(input.corpus)); equal(JSON.parse(plan.load.values[0]),input.corpus.deliveries);
    const p=python(bytes); for(const o of p.observations) assertFixedOracle(input.name,o);
    refs.push({...input,plan,bytes,python:p,ts:await compareTsOverlap(input.entry)});
  }
  const version=spawnSync(join(root,'.venv/bin/python'),['-B','-I','--version'],{encoding:'utf8',timeout:5000,maxBuffer:4096}); check(!version.error&&version.status===0&&!version.stderr);
  equal(await snapshot(),before); await mkdir(output,{mode:0o700});
  // Same installed pinned runtime helper as the genuine runner; never accepts a
  // caller executable path. Binary bytes are bound across the actual trial.
  const binaries=installedRuntime();
  const binaryHashes={};
  for(const name of ['postgres','initdb','pg_ctl']) binaryHashes[name]=hash(await read(await realpath(join(binaries.directory,name)),134217728));
  const sql=await runGraphSqlBaseline(join(output,'sql'));
  equal(sql.runtime.postgres,binaries.version);
  for(const [name,h] of Object.entries(binaryHashes)) equal(hash(await read(await realpath(join(binaries.directory,name)),134217728)),h);
  const sqlSources=['src/graph-sql.ts','dist/graph-sql.js','src/graph-benchmark-contract.ts','dist/graph-benchmark-contract.js','fixtures/graph-benchmark.json','scripts/graph-sql-baseline.mjs','packages/database/scripts/local.mjs','infrastructure/postgres/major-version','infrastructure/postgres/postgresql.conf'];
  assertSqlMetadata(sql,{node:process.version,fixture_sha256:hash(raw),source_hashes:Object.fromEntries(sqlSources.map(p=>[p,before[p.startsWith('packages/')||p.startsWith('infrastructure/')?p:`apps/risk-workers/${p}`]]))});
  equal(sql.observations.map(e=>e.name),refs.map(e=>e.name)); const comparisons=[];
  for(let i=0;i<refs.length;i++) {
    const r=refs[i],s=sql.observations[i]; equal(s.queries.length,r.python.observations.length);
    for(let j=0;j<s.queries.length;j++) {
      const q=s.queries[j]; equal(q.id,r.corpus.queries[j].id); equal(q.profile,'no_index'); check(Number.isFinite(q.query_ms)&&q.query_ms>=0&&q.explain.length>0); equal(q.repetitions,{observation:1,explain_analyze:1});
      const bound=r.corpus.queries[j],latest=new Map();
      for(const d of r.corpus.deliveries) { const e=d.event; if(d.source_position<=bound.source_prefix&&e.available_at<=bound.as_of&&e.namespace===bound.namespace) { const old=latest.get(e.transaction_id); if(!old||old.revision_number<e.revision_number) latest.set(e.transaction_id,e); } }
      equal(q.loaded_rows,r.corpus.deliveries.length); equal(q.selected_rows,latest.size);
      assertObservations(q.observation,r.python.observations[j]); assertFixedOracle(r.name,q.observation);
    }
    comparisons.push({name:r.name,input_sha256:hash(r.bytes),corpus_sha256:r.plan.corpus_sha256,query_sha256:r.plan.queries.map(q=>q.query_sha256),python:r.python,ts:r.ts});
  }
  equal(await snapshot(),before); equal(JSON.parse(await read(join(output,'sql/sql.json'))),sql);
  const report={version:1,scope:'local_synthetic',production_ready:false,status:'matched',cleanup:'confirmed',source_hashes:before,raw_fixture_sha256:hash(raw),runtime:{node:process.version,python:version.stdout.trim(),postgres:sql.runtime.postgres,postgres_artifact_sha256:binaryHashes},sampling:{runs:1,sql_observations_per_query:1,sql_explain_analyze_per_query:1,python_processes:refs.length+refs.filter(r=>r.entry?.ts_overlap).length},timing_unit:'milliseconds',python_timing_scope:'process_startup_validation_query_serialization',index:{status:'pending',reason:'genuine SQL runner measures no_index only'},sql,comparisons};
  const bytes=JSON.stringify(report); check(Buffer.byteLength(bytes)+Buffer.byteLength(JSON.stringify(sql))<=max);
  const f=await open(join(output,'comparison.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o400);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { await runGraphBenchmarkCompare(parseArguments(process.argv.slice(2))); }
  catch { console.error('GRAPH_COMPARE_UNAVAILABLE'); process.exitCode=1; }
}
