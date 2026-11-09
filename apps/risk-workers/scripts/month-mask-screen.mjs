import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { datasetMode } from '@lmps/contracts/offline-dataset';
import { OBSERVED_MASK_SOURCE_PROFILE, observedMaskKey, observedMaskTime, referenceObservedWindow, RISK_CATALOG, riskHash } from '@lmps/risk';
import { privateDirectory, readPrivateJson, savePrivateReportFiles } from './private-json.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const execute = promisify(execFile), MAXIMUM = 2 * 1024**2;
const producer = ['month-readiness.mjs','dataset_readiness.py','dataset_month_stream.py','dataset_profile.py','dataset_pilot.py','export_transfer.py'];
const files = ['apps/risk-workers/scripts/month-mask-screen.mjs','apps/risk-workers/scripts/dataset_mask_screen.py',
  'apps/risk-workers/scripts/dataset_amount_backtest.py','apps/risk-workers/scripts/private-json.mjs',
  ...producer.map(n=>'apps/risk-workers/scripts/'+n),
  'packages/contracts/src/observed-mask.ts','packages/contracts/dist/observed-mask.js',
  'packages/risk/src/observed-mask.ts','packages/risk/dist/observed-mask.js',
  'packages/risk/src/index.ts','packages/risk/dist/index.js',
  'packages/contracts/src/offline-dataset.ts','packages/contracts/dist/offline-dataset.js'];
const uid = h => `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
async function hashes(names) {
  return Promise.all(names.map(async name=>({name,sha256:createHash('sha256').update(await readFile(join(ROOT,name))).digest('hex')})));
}
async function producerBinding() {
  return riskHash((await hashes(producer.map(n=>'apps/risk-workers/scripts/'+n))).map((v,i)=>({...v,name:producer[i]})));
}

async function analysisKey(base) {
  try { await mkdir(base,{mode:0o700}); } catch(e) { if(e.code!=='EEXIST')throw e; }
  await privateDirectory(base);
  const path=join(base,'.mask-key.json');
  try {
    const file=await open(path,'wx',0o600);
    try { await file.writeFile(JSON.stringify({format:'observed-mask-analysis-key-1',key_b64:randomBytes(32).toString('base64')}));await file.sync(); }
    finally { await file.close(); }
  } catch(e) { if(e.code!=='EEXIST')throw e; }
  const r=await readPrivateJson(path,1024);
  if(!r||Object.keys(r).sort().join(',')!=='format,key_b64'||r.format!=='observed-mask-analysis-key-1'
    ||typeof r.key_b64!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(r.key_b64)||Buffer.from(r.key_b64,'base64').length!==32)throw Error();
  return r.key_b64;
}

export function maskParityCases(key) {
  const inputs=[{bank:'SYN_A',representation:'SYN_MASK***1'},{bank:'SYN_B',representation:'SYN_MASK***1'},
    {bank:'SYN_A',representation:'SYN_MASK***2'},{bank:'SYN_A',representation:'ເລກ***😀'}];
  const key_cases=inputs.map(input=>({input,output:observedMaskKey(input,key)}));
  const time_cases=['2026-10-01 00:00:00','2026-10-01 00:05:00','2026-10-31 23:59:59','2024-02-29 12:00:00']
    .map(input=>({input,output:observedMaskTime(input)}));
  const [a,b,c]=key_cases.map(x=>x.output.observed_key),start=observedMaskTime('2026-10-01 00:00:00');
  const window_cases=[];
  for(const w of [300,900,3600]) {
    const end=start+5000;
    const e=(ordinal,t,sender,receiver,amount)=>({ordinal,occurred_unix:t,sender,receiver,amount});
    const events=[e(0,end-w,a,b,'100.00'),e(1,end-w+1,a,c,'2.00'),e(2,end,a,b,'3.00'),
      e(3,end,c,b,'4.00'),e(4,end,a,c,'200000000.00'),e(5,end+1,a,b,'9.00')];
    for(const anchor of [1,2,3,4]) {
      const input={events,anchor,window_seconds:w,scope_start:start};
      window_cases.push({input,output:referenceObservedWindow(input)});
    }
    const input={events:[e(7,start+1,a,a,'0.01')],anchor:7,window_seconds:w,scope_start:start};
    window_cases.push({input,output:referenceObservedWindow(input)});
  }
  return {key_cases,time_cases,window_cases};
}

async function python(request,long=false) {
  const child=execute(join(ROOT,'.venv/bin/python'),['-B',join(ROOT,'apps/risk-workers/scripts/dataset_mask_screen.py')],
    {timeout:long?7230000:30000,maxBuffer:2*MAXIMUM+1024,encoding:'utf8'});
  child.child.stdin.on('error',()=>{});child.child.stdin.end(JSON.stringify(request));
  const {stdout,stderr}=await child;if(stderr)throw Error();return JSON.parse(stdout);
}

export async function runMaskScreen({planPath,profilePath,output}) {
  datasetMode();
  if(![planPath,profilePath,output].every(p=>typeof p==='string'&&isAbsolute(p)&&resolve(p)===p))throw Error();
  for(const path of [dirname(planPath),dirname(profilePath),dirname(output)])await privateDirectory(path);
  const [plan,prior]=await Promise.all([readPrivateJson(planPath,1024**2),readPrivateJson(profilePath,MAXIMUM)]);
  if(prior.format!=='lmps-month-readiness-1'||prior.production_ready!==false||prior.source_semantics!=='unverified'
    ||prior.request_sha256!==riskHash(plan)||prior.tool_binding_sha256!==await producerBinding()
    ||prior.catalog_sha256!==riskHash(RISK_CATALOG)||basename(dirname(profilePath))!==uid(riskHash(prior)))throw Error();
  const target=join(await realpath(dirname(output)),basename(output));
  for(const path of [planPath,profilePath,...plan.files.map(f=>f.path)]) {
    const source=await realpath(path);
    if(source===target||source.startsWith(target+'/')||target.startsWith(source+'/'))throw Error();
  }
  const key_b64=await analysisKey(output),key=Buffer.from(key_b64,'base64');
  const profile=OBSERVED_MASK_SOURCE_PROFILE,cases=maskParityCases(key);
  const binding=await hashes(files),requestHash=riskHash(plan),priorHash=riskHash(prior);
  const common={profile,key_b64,...cases};
  const parity=await python({...common,check_only:true});if(parity.parity!=='passed')throw Error();
  const result=await python({...common,plan,prior,scratch:dirname(output)},true);
  const verify=await python({...common,plan,traces:result.traces},true);
  if(verify.status!=='passed'||verify.anchors!==result.traces.length||result.report.format!=='lmps-observed-mask-screen-1'
    ||riskHash(result.report.profile)!==riskHash(profile)||result.report.identity_status!=='unverified'
    ||result.report.canonical_assessment!==false||result.report.enforcement!==false||result.report.production_ready!==false
    ||riskHash(await hashes(files))!==riskHash(binding)||riskHash(await readPrivateJson(planPath,1024**2))!==requestHash
    ||riskHash(await readPrivateJson(profilePath,MAXIMUM))!==priorHash||await analysisKey(output)!==key_b64
    ||result.report.key_commitment_sha256!==createHash('sha256').update(key).digest('hex'))throw Error();
  for(const trace of result.traces) {
    const metric=result.report.metrics.find(m=>m.pattern===trace.pattern&&m.window_seconds===trace.window_seconds);
    if(!metric||!/^\d+$/.test(trace.metric_integer)||!/^\d+$/.test(trace.cutoff_integer)
      ||BigInt(trace.cutoff_integer)!==BigInt(metric.experimental_cutoff)||BigInt(trace.metric_integer)<BigInt(trace.cutoff_integer)
      ||trace.identity_status!=='unverified'||trace.real_account_claim!==false)throw Error();
  }
  const report={...result.report,request_sha256:requestHash,source_profile_sha256:priorHash,
    tool_binding:binding,tool_binding_sha256:riskHash(binding),trace_sha256:riskHash(result.traces),anchor_trace_verification:verify,
    parity_cases:Object.values(cases).reduce((n,v)=>n+v.length,0),
    key_storage:'private_output_base_keep_for_replay_never_publish',
    core_pattern_results:RISK_CATALOG.map(p=>({code:p.code,status:'not_evaluated',matched_count:null,reason:'CANONICAL_IDENTITY_AND_NET_HISTORY_UNVERIFIED'}))};
  const id=uid(riskHash(report));
  const created=await savePrivateReportFiles(output,'v1',id,[
    {filename:'report.json',content:JSON.stringify(report),maximum:MAXIMUM},
    {filename:'traces.json',content:JSON.stringify(result.traces),maximum:MAXIMUM},
  ]);
  key.fill(0);
  return {status:created?'screened':'duplicate',analysis_id:id,observed_rows:report.observed_rows,
    included_rows:report.cohort.included,candidate_source_row_anchors:report.unique_candidate_source_row_anchors,
    identity_status:'unverified',canonical_assessment:false,production_ready:false};
}

export async function main(args=process.argv.slice(2)) {
  try {
    const {values}=parseArgs({args,options:{plan:{type:'string'},profile:{type:'string'},output:{type:'string'}},allowPositionals:false});
    if(!values.plan||!values.profile||!values.output)throw Error();
    console.info(JSON.stringify(await runMaskScreen({planPath:values.plan,profilePath:values.profile,output:values.output})));return 0;
  } catch { console.error('MASK_SCREEN_FAILED; private diagnostics withheld.');return 1; }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
