/** Inert selected-cohort adapter. Python module documents anchor differences.
 * --source ABS --plan ABS --output ABS; read-only rerun: --verify ABS.
 * Intersection is positive count/net, one currency, 1h, <=256 selected records
 * per query (<=2000 source revisions / <=8 queries / <=2MiB per artifact).
 * All other features
 * (log transforms, novelty, graph, model and serving freshness) unsupported.
 * Synthetic probes consume US1101-selected records, never a final snapshot.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync, fstatSync, realpathSync, mkdirSync, writeFileSync, openSync, closeSync, constants } from 'node:fs';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LIMIT = 2097152;
const check = v => { if (!v) throw Error('PARITY_REJECTED'); };
export const canonical = v => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:1)) : x);
const hash = v => createHash('sha256').update(v).digest('hex');
function safe(path, directory=false) {
  check(isAbsolute(path) && resolve(path)===path && path.startsWith(ROOT+'/.local/'));
  for(let parent=dirname(path);parent!==ROOT;parent=dirname(parent)) {
    const s=lstatSync(parent);check(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o077));
  }
  const s=lstatSync(path); check(realpathSync(path)===path && s.uid===process.getuid() && !(s.mode&0o077) && (directory?s.isDirectory():s.isFile()&&s.nlink===1));
  return s;
}
function read(path) {
  const before=safe(path);check(before.size<=LIMIT);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const opened=fstatSync(fd);check(opened.isFile()&&opened.nlink===1&&opened.uid===process.getuid()&&!(opened.mode&0o077)&&opened.ino===before.ino&&opened.dev===before.dev);
    const raw=readFileSync(fd),after=safe(path),finished=fstatSync(fd);
    check(raw.length<=LIMIT && raw.length===before.size && ['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]&&before[k]===finished[k])); return raw;
  } finally { closeSync(fd); }
}
const modules = ['apps/risk-workers/scripts/feature-parity.mjs','services/ml-inference/lmps_ml/__init__.py','services/ml-inference/lmps_ml/feature_parity.py','services/ml-inference/lmps_ml/dataset.py','services/ml-inference/lmps_ml/private.py','packages/contracts/package.json','packages/contracts/src/feature-parity.ts','packages/contracts/src/feature-catalog.ts','packages/contracts/src/feature-stream.ts','packages/contracts/src/feature-serving.ts','packages/risk/src/feature-stream.ts','packages/risk/src/feature-serving.ts','packages/contracts/dist/feature-parity.js','packages/contracts/dist/feature-catalog.js','packages/contracts/dist/feature-stream.js','packages/contracts/dist/feature-serving.js','packages/risk/dist/feature-stream.js','packages/risk/dist/feature-serving.js'];
export function provenance() { return Object.fromEntries(modules.map(p=>{check(realpathSync(join(ROOT,p))===join(ROOT,p)); return [p,hash(readFileSync(join(ROOT,p)))];})); }
function pythonVersion(){const r=spawnSync(join(ROOT,'.venv/bin/python'),['-I','--version'],{encoding:'utf8',timeout:5000,maxBuffer:1024,env:{PATH:'/usr/bin:/bin'}});check(r.status===0&&!r.error);return r.stdout.trim().replaceAll(' ','-');}
export function runtimeBinding() {
  const p=provenance(), group=compiled=>Object.fromEntries(Object.entries(p).filter(([k])=>k.includes('/dist/')===compiled));
  return {python:pythonVersion(),typescript:process.version,source_sha256:hash(canonical(group(false))),compiled_sha256:hash(canonical(group(true)))};
}
function python(value) {
  const result=spawnSync(join(ROOT,'.venv/bin/python'),['-I','-c',"import sys;sys.path.insert(0,'services/ml-inference');from lmps_ml.feature_parity import main;main()"],{
    cwd:ROOT, input:canonical(value), encoding:'utf8', maxBuffer:LIMIT, timeout:15000,
    env:{PATH:'/usr/bin:/bin',LMPS_ENVIRONMENT:'test',LMPS_EXECUTION_MODE:'test',PYTHONDONTWRITEBYTECODE:'1'}});
  check(!result.error && result.status===0 && result.signal===null && !result.stderr);
  const x=JSON.parse(result.stdout); check(Object.keys(x).sort().join(',')==='amount,count,module,status' && x.module==='lmps_ml.dataset.build_dataset+net' && x.status==='available'); return x;
}
export async function compare(source, planPath) {
  check(process.env.NODE_ENV!=='production' && ['local','test'].includes(process.env.LMPS_ENVIRONMENT??'local'));
  const before=provenance(), sourceRaw=read(source), planRaw=read(planPath), started=performance.now();
  const c=await import('../../../packages/contracts/dist/feature-parity.js');
  const stream=await import('../../../packages/risk/dist/feature-stream.js');
  const serving=await import('../../../packages/risk/dist/feature-serving.js');
  const sc=await import('../../../packages/contracts/dist/feature-serving.js');
  const input=c.validateFeatureParityInput(JSON.parse(sourceRaw)), plan=c.validateFeatureParityPlan(JSON.parse(planRaw));
  check(plan.input_sha256===c.featureParityInputHash(input) && canonical(plan.runtime)===canonical(runtimeBinding()));
  const online=[],offline=[],unsupported=[];
  for(const q of plan.queries) {
    check(performance.now()-started<70000);
    const cohort=c.selectFeatureParityCohort(plan,input,q.id);
    let status=cohort.status==='eligible'?'available':cohort.status;
    const reasons=[];
    if(q.window_seconds!==3600)reasons.push('WINDOW_NOT_ONE_HOUR');
    if(Date.parse(plan.fixture.now)-Date.parse(q.anchor_at)+q.window_seconds*1000>plan.fixture.retention_seconds*1000)reasons.push('WINDOW_OUTSIDE_FIXTURE_RETENTION');
    if(q.anchor_at<'2000-01-01T00:00:00Z'||q.anchor_at>'9997-12-31T23:59:58Z'||q.as_of>'9997-12-31T23:59:58Z')reasons.push('PROBE_TIMESTAMP_RANGE');
    if(cohort.records.length>256)reasons.push('SELECTED_RECORD_LIMIT_256');
    if(cohort.records.some(r=>r.active&&r.amount==='0.00'))reasons.push('ACTIVE_ZERO_EXCLUDED_BY_EXISTING_ENGINES');
    if(cohort.records.some(r=>r.amount.length>25))reasons.push('PYTHON_AMOUNT_PRECISION_LIMIT');
    if(reasons.length){status='unsupported';for(const reason of reasons)unsupported.push({query_id:q.id,reason});}
    if(status==='unsupported'&&!unsupported.some(r=>r.query_id===q.id))unsupported.push({query_id:q.id,reason:'SEMANTIC_VERSION_UNSUPPORTED'});
    const base={query:q,plan_sha256:c.featureParityPlanHash(plan),input_sha256:plan.input_sha256,cohort_sha256:cohort.cohort_sha256,semantics:plan.semantics,runtime:plan.runtime,status,count:null,amount:null};
    if(status!=='available') {online.push(base);offline.push({...base});continue;}
    const query={id:'synthetic_query',target:'synthetic_probe',as_of:q.as_of,currency:q.currency,evidence:'available',coverage_complete:true,flags_available:false};
    const p={version:'synthetic-feature-stream-1',identity:'synthetic_declared',run_id:'synthetic_run',input_identity:'synthetic_parity',namespace:'synthetic_parity',topic:'synthetic_parity.synthetic_run',window_seconds:3600,coverage_start:new Date(Date.parse(q.anchor_at)-3600000).toISOString().replace('.000Z','Z'),queries:[query],limits:{records:2000,revisions:2000,snapshots:1,capture_bytes:LIMIT,state_bytes:1048576}};
    let state=stream.initializeFeatureStream(p);
    const events=cohort.records.map((r,i)=>({namespace:p.namespace,transaction_id:'synthetic_event_'+i,revision_number:1,sender:'synthetic_sender',receiver:'synthetic_receiver',occurred_at:r.occurred_at,available_at:q.as_of,currency:q.currency,amount:r.amount,reversed_amount:r.active?'0.00':r.amount,status:r.active?'succeeded':'reversed'}));
    events.push({namespace:p.namespace,transaction_id:'synthetic_probe',revision_number:1,sender:'synthetic_sender',receiver:'synthetic_receiver',occurred_at:q.anchor_at,available_at:q.as_of,currency:q.currency,amount:'0.00',reversed_amount:'0.00',status:'pending'});
    const deliveries=events.map((event,offset)=>({identity:p.identity,topic:p.topic,partition:0,offset,event}));
    state=stream.restoreFeatureStream({...state,deliveries:deliveries.slice(0,-1),next_offset:deliveries.length-1},p);
    state=stream.applyFeatureStreamDelivery(state,deliveries.at(-1));
    const frozen=stream.materializeFeatureStreamSnapshot(state,query.id),s=frozen.snapshot;
    check(s.reason===null && s.window_end===q.anchor_at);
    const scope={version:sc.FEATURE_SERVING_VERSION,mode:'local_synthetic',workspace_key:'synthetic_parity',plan:p,policy:{id:'synthetic_parity',version:'synthetic_v1',max_age_seconds:0}};
    const publication={version:scope.version,scope,generation:1,predecessor:null,state:frozen.state,published_at:q.as_of,expires_at:new Date(Date.parse(q.as_of)+1000).toISOString().replace('.000Z','Z'),content_hash:Array(8).fill('00000000').join('-')};
    publication.content_hash=sc.featurePublicationContentHash(publication);
    const served=serving.serveFeatureSnapshot(publication,scope,{version:scope.version,workspace_key:scope.workspace_key,plan:p,query,currency:q.currency,policy:scope.policy,now:q.as_of});
    check(served.status==='available' && served.count===s.count && served.amount===s.amount);
    const py=python({query:q,records:cohort.records});
    online.push({...base,count:served.count,amount:served.amount});offline.push({...base,count:py.count,amount:py.amount});
  }
  check(performance.now()-started<75000);
  const report=c.compareFeatureParity(plan,input,online,offline);
  check(!report.comparisons.some(r=>r.status==='mismatch'));
  check(canonical(before)===canonical(provenance()) && sourceRaw.equals(read(source)) && planRaw.equals(read(planPath)));
  return {version:'selected-cohort-evidence-1',production_ready:false,source,plan:planPath,source_sha256:hash(sourceRaw),plan_sha256:hash(planRaw),provenance:before,runtime:runtimeBinding(),online,offline,unsupported,report,acceptance:'pending_parent_promoted_verification'};
}
export async function verify(output) {safe(output,true); const bytes=read(join(output,'evidence.json')),old=JSON.parse(bytes); const actual=await compare(old.source,old.plan);check(canonical(old)===canonical(actual)&&bytes.equals(read(join(output,'evidence.json'))));return actual;}
export async function main(args=process.argv.slice(2)) {
  if(args.length===2&&args[0]==='--verify') {await verify(args[1]);return;}
  check(args.length===6&&args[0]==='--source'&&args[2]==='--plan'&&args[4]==='--output');
  const output=args[5]; check(isAbsolute(output)&&resolve(output)===output&&output.startsWith(ROOT+'/.local/'));safe(dirname(output),true);
  const evidence=await compare(args[1],args[3]);const bytes=canonical(evidence);check(Buffer.byteLength(bytes)<=LIMIT);
  safe(dirname(output),true);mkdirSync(output,{mode:0o700});safe(output,true);writeFileSync(join(output,'evidence.json'),bytes,{mode:0o600,flag:'wx'});
  const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--verify',output],{cwd:ROOT,timeout:80000,maxBuffer:LIMIT,env:{PATH:'/usr/bin:/bin'}});check(r.status===0&&!r.error);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('PARITY_REJECTED\n');process.exitCode=1;});
