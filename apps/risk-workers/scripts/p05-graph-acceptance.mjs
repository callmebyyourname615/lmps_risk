import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { join, dirname, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { deepStrictEqual as equal } from 'node:assert';
import { parseArguments as outputArgument, runGraphBenchmarkCompare, assertFixedOracle, assertSqlMetadata, compareTsOverlap } from './graph-benchmark-compare.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)), limit=16777216;
const own='apps/risk-workers/scripts/p05-graph-acceptance.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function check(v) { if(!v) throw Error('GRAPH_ACCEPTANCE_INVALID'); }
export function parseArguments(args) {
  check(Array.isArray(args)&&args.length===2&&['--output','--verify'].includes(args[0]));
  return {mode:args[0],output:outputArgument(['--output',args[1]])};
}
async function directory(p) {
  let a=parse(p).root;
  for(const part of p.slice(a.length).split('/').filter(Boolean)) { a=join(a,part); const s=await lstat(a); check(s.isDirectory()&&!s.isSymbolicLink()); }
  const s=await lstat(p); check(s.uid===process.getuid()&&!(s.mode&0o077));
}
async function read(p,max=limit) {
  const f=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const s=await f.stat(); check(s.isFile()&&s.size<=max); const b=await f.readFile(); check(b.length===s.size&&b.length<=max); return b; } finally { await f.close(); }
}
async function files(output) {
  await directory(output); const result={}; let total=0;
  async function walk(p,relative='') {
    for(const name of (await readdir(p)).sort()) {
      const path=join(p,name),key=relative+name,s=await lstat(path);
      check(!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o077));
      if(s.isDirectory()) { await walk(path,key+'/'); continue; }
      check(s.isFile()&&s.nlink===1&&!(s.mode&0o222)); total+=s.size; check(total<=limit);
      result[key]={sha256:hash(await read(path)),bytes:s.size,mtime_ms:s.mtimeMs,inode:s.ino,device:s.dev};
    }
  }
  await walk(output); return result;
}
async function source(p) {
  check(['runtime:node','runtime:python'].includes(p)||(!p.includes('..')&&!p.startsWith('/')&&!p.includes(':')));
  const path=p==='runtime:node'?await realpath(process.execPath):p==='runtime:python'?await realpath(join(root,'.venv/bin/python')):join(root,p);
  return hash(await read(path,134217728));
}
/** Read-only semantic replay. Never launches PostgreSQL or accepts supplied observations. */
export async function verifyGraphAcceptance(output) {
  check(arguments.length===1); outputArgument(['--output',output]);
  const before=await files(output);
  equal(Object.keys(before).sort(),['acceptance.json','comparison/comparison.json','comparison/sql/sql.json']);
  const manifest=JSON.parse(await read(join(output,'acceptance.json')));
  const report=JSON.parse(await read(join(output,'comparison/comparison.json')));
  equal(manifest,{version:1,scope:'local_synthetic',production_ready:false,status:'local_benchmark_support',parent_acceptance:'pending',source_sha256:await source(own),artifacts:Object.fromEntries(Object.entries(before).filter(([k])=>k!=='acceptance.json'))});
  check(report.status==='matched'&&report.cleanup==='confirmed'&&report.production_ready===false&&report.scope==='local_synthetic');
  equal(report.sql,JSON.parse(await read(join(output,'comparison/sql/sql.json'))));
  const required=['apps/risk-workers/src/graph-sql.ts','apps/risk-workers/dist/graph-sql.js','apps/risk-workers/src/graph-benchmark-contract.ts','apps/risk-workers/dist/graph-benchmark-contract.js','apps/risk-workers/fixtures/graph-benchmark.json','apps/risk-workers/scripts/graph-sql-baseline.mjs','apps/risk-workers/scripts/graph-benchmark-compare.mjs','services/ml-inference/lmps_ml/graph_benchmark.py','packages/risk/src/features.ts','packages/risk/dist/features.js','packages/risk/src/index.ts','packages/risk/dist/index.js','packages/database/scripts/local.mjs','infrastructure/postgres/major-version','infrastructure/postgres/postgresql.conf','runtime:node','runtime:python'];
  equal(Object.keys(report.source_hashes).sort(),required.sort());
  for(const [p,h] of Object.entries(report.source_hashes)) equal(await source(p),h);
  equal(report.runtime.node,process.version);
  const url=new URL('../../../packages/database/scripts/local.mjs',import.meta.url).href;
  const native=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(url)}); m.localMode(); process.stdout.write(JSON.stringify(m.binaryDirectory()))`],{encoding:'utf8',timeout:10000,maxBuffer:65536});
  check(!native.error&&native.status===0&&!native.stderr);
  const runtime=JSON.parse(native.stdout); equal(runtime.version,report.runtime.postgres);
  equal(Object.keys(report.runtime.postgres_artifact_sha256).sort(),['initdb','pg_ctl','postgres']);
  for(const [name,h] of Object.entries(report.runtime.postgres_artifact_sha256)) equal(hash(await read(await realpath(join(runtime.directory,name)),134217728)),h);
  const fixture=JSON.parse(await read(join(root,'apps/risk-workers/fixtures/graph-benchmark.json')));
  equal(report.raw_fixture_sha256,await source('apps/risk-workers/fixtures/graph-benchmark.json'));
  const {graphSqlPlan,graphSqlProfiles}=await import('../dist/graph-sql.js');
  const inputs=[...fixture.cases,...graphSqlProfiles(fixture.cases[0].corpus).map((corpus,i)=>({name:['burst','skew','dense'][i],corpus}))];
  equal(report.comparisons.map(c=>c.name),inputs.map(c=>c.name));
  equal(report.sql.observations.map(c=>c.name),inputs.map(c=>c.name));
  const sqlSources=Object.fromEntries(Object.keys(report.sql.source_hashes).map(p=>[p,report.source_hashes[p.startsWith('packages/')||p.startsWith('infrastructure/')?p:`apps/risk-workers/${p}`]]));
  equal(Object.keys(sqlSources).sort(),['src/graph-sql.ts','dist/graph-sql.js','src/graph-benchmark-contract.ts','dist/graph-benchmark-contract.js','fixtures/graph-benchmark.json','scripts/graph-sql-baseline.mjs','packages/database/scripts/local.mjs','infrastructure/postgres/major-version','infrastructure/postgres/postgresql.conf'].sort());
  assertSqlMetadata(report.sql,{node:process.version,fixture_sha256:report.raw_fixture_sha256,source_hashes:sqlSources});
  for(let i=0;i<inputs.length;i++) {
    const input=inputs[i],bytes=Buffer.from(JSON.stringify(input.corpus)),plan=graphSqlPlan(input.corpus),c=report.comparisons[i];
    equal([c.input_sha256,c.corpus_sha256,c.query_sha256],[hash(bytes),plan.corpus_sha256,plan.queries.map(q=>q.query_sha256)]);
    const p=spawnSync(join(root,'.venv/bin/python'),['-B','-I',join(root,'services/ml-inference/lmps_ml/graph_benchmark.py')],{input:bytes,encoding:'utf8',timeout:10000,maxBuffer:limit,env:{LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'}});
    check(!p.error&&p.status===0&&!p.signal&&!p.stderr);
    const observed=JSON.parse(p.stdout).observations;
    equal(c.python.observations,observed);
    // TS overlap includes elapsed process time; compare semantic projections only.
    const ts=await compareTsOverlap(input); if(ts.projection) delete ts.projection.elapsed_ms;
    const stored=structuredClone(c.ts); if(stored.projection) delete stored.projection.elapsed_ms;
    equal(stored,ts);
    const queries=report.sql.observations[i].queries; check(queries.length===observed.length);
    for(let j=0;j<observed.length;j++) {
      const q=queries[j],bound=input.corpus.queries[j],latest=new Map();
      for(const d of input.corpus.deliveries) { const e=d.event; if(d.source_position<=bound.source_prefix&&e.available_at<=bound.as_of&&e.namespace===bound.namespace) { const old=latest.get(e.transaction_id); if(!old||old.revision_number<e.revision_number) latest.set(e.transaction_id,e); } }
      assertFixedOracle(input.name,observed[j]); equal(q.observation,observed[j]); equal(q.id,bound.id);
      equal(q.loaded_rows,input.corpus.deliveries.length); equal(q.selected_rows,latest.size);
      equal(q.profile,'no_index'); equal(q.repetitions,{observation:1,explain_analyze:1});
      check(Number.isFinite(q.query_ms)&&q.query_ms>=0&&q.explain.length>0);
    }
  }
  equal(await files(output),before);
  return {status:'verified_local_support',production_ready:false,parent_acceptance:'pending'};
}
export async function runGraphAcceptance(output) {
  check(arguments.length===1); outputArgument(['--output',output]); await directory(dirname(output));
  await mkdir(output,{mode:0o700});
  const initial=await source(own);
  await runGraphBenchmarkCompare(join(output,'comparison'));
  equal(await source(own),initial);
  const artifacts=await files(output);
  const manifest={version:1,scope:'local_synthetic',production_ready:false,status:'local_benchmark_support',parent_acceptance:'pending',source_sha256:initial,artifacts};
  const bytes=JSON.stringify(manifest); check(Buffer.byteLength(bytes)+Object.values(artifacts).reduce((n,a)=>n+a.bytes,0)<=limit);
  const f=await open(join(output,'acceptance.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o400);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const {mode,output}=parseArguments(process.argv.slice(2)); await (mode==='--verify'?verifyGraphAcceptance:runGraphAcceptance)(output); }
  catch { console.error('GRAPH_ACCEPTANCE_UNAVAILABLE'); process.exitCode=1; }
}
