import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransactionRevisions,createTransactionRisks } from '@lmps/database';
import { modelFeatureRequest,riskHash } from '@lmps/risk';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { ROOT,dsn } from '../../../packages/database/scripts/local.mjs';
import { createBackup,restoreDrill } from '../../../packages/database/scripts/backup.mjs';
import { reviewWithModel } from '../../risk-workers/dist/model-review.js';
import { exportLabels } from '../../risk-workers/scripts/label-export.mjs';
import { openShadowRuntime } from './shadow-runtime.mjs';
import { CORE_ROLES } from './local-core.mjs';
const execute=promisify(execFile),id=n=>'51000000-0000-4000-8000-'+String(n).padStart(12,'0');
export async function runShadowDemo(root){
  let runtime,writer,risks;
  try{
    runtime=await openShadowRuntime(root);root=runtime.root;
    writer=createTransactionRevisions(dsn(runtime.state,'intake'));risks=createTransactionRisks(dsn(runtime.state,'intake'));
    const f=transactionRiskFixture();f.request.run_id=id(1);await writer.append(f.revision);await risks.evaluate(f.request);
    const deployment=JSON.parse(await readFile(join(root,'ml/deployment.json'),'utf8'));
    const request={format:1,execution_mode:'shadow',workspace_key:'synthetic_local',request_id:id(2),assessment_run_id:id(1),
      policy:{policy_id:'synthetic_shadow_demo',version:'synthetic_v1',task:'fraud',probability_threshold:'0.000000000',missing_model:'skip',model:deployment.model,
        alert_policy:{policy_id:'synthetic_shadow_demo_alert',version:'synthetic_v1',minimum_severity:'high',included_codes:['FRAUD_HIGH_AMOUNT'],include_partial:true}}};
    const reviewed=await reviewWithModel(request,{dsn:dsn(runtime.state,'intake'),endpoint:runtime.ml_url+'/v1/shadow/score',token_file:join(root,'ml/auth.token'),public_key_file:join(root,'ml/public.json')});
    assert.equal(reviewed.view.decision.reason_code,'MODEL_CONFIRMED');const caseId=id(3),base='/v1/local/cases/'+caseId;
    const command=(action,version,extra={})=>({action,expected_version:version,request_id:id(10+version),note:'Invented shadow integration evidence',...extra});
    await runtime.api.request('author','POST',base+'/create',command('create',0,{title:'Synthetic shadow and label demo',alert_id:reviewed.view.alert_id}),201);
    await runtime.api.request('author','POST',base+'/assignment',command('assign',1,{assignee_subject:CORE_ROLES.analyst.sub}),201);
    await runtime.api.request('analyst','POST',base+'/start',command('start',2),201);
    await runtime.api.request('analyst','POST',base+'/outcomes',command('record_outcome',3,{dimensions:Object.fromEntries(['fraud','mule_network','aml'].map(task=>[task,{outcome:'unknown',rationale:'Invented fixture; independent evidence required'}]))}),201);
    await runtime.api.request('analyst','POST',base+'/close',command('close',4),201);
    const adjudication={request_id:id(30),expected_version:0,outcome_version:4,alert_id:reviewed.view.alert_id,task:'fraud',outcome:1,action:'adjudicate',mature_at:'2026-01-01T00:00:00.000Z',
      evidence:{kind:'synthetic_fixture',reference:'synthetic-demo-fixture-truth',sha256:riskHash({scope:'invented-only',task:'fraud',demo:'No51'})}};
    await runtime.api.request('adjudicator','POST',base+'/labels/'+id(4),adjudication,201);
    const label=(await runtime.api.request('adjudicator','GET','/v1/local/labels/'+id(4))).label;assert.equal(label.eligibility,'eligible');
    const exported=await exportLabels(dsn(runtime.state),[id(4)],join(root,'label-exports'),id(5));
    const token=await readFile(join(root,'ml/auth.token'),'utf8'),features=modelFeatureRequest(f.request,f.observation),latencies=[],accepted=[],statuses={};let next=0;
    await Promise.all(Array.from({length:8},async()=>{while(next<100){next++;const started=performance.now();const response=await fetch(runtime.ml_url+'/v1/shadow/score',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(features),signal:AbortSignal.timeout(5000)});await response.arrayBuffer();
      const elapsed=performance.now()-started;latencies.push(elapsed);if(response.status===200)accepted.push(elapsed);statuses[response.status]=(statuses[response.status]??0)+1;}}));
    const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(3)):null;};
    // Separate controlled observations make the aggregate drift path observable without counting them as load samples.
    for(let i=0;i<50;i++){
      const response=await fetch(runtime.ml_url+'/v1/shadow/score',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(features),signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,200);await response.arrayBuffer();
    }
    const metrics=(await runtime.status()).metrics;
    assert.equal(metrics.feature_drift.status,'available');
    const backup=await createBackup(runtime.state,join(root,'backups')),drill=await restoreDrill(backup.directory);assert.equal(drill.status,'PASS');
    const runId=randomUUID(),folder=join(root,'acceptance',runId);await mkdir(join(root,'acceptance'),{mode:0o700,recursive:true});await mkdir(folder,{mode:0o700});
    const python=async(...args)=>execute(join(ROOT,'.venv/bin/python'),['-B','-m','lmps_ml.pipeline',...args],{cwd:join(ROOT,'services/ml-inference'),timeout:30000,maxBuffer:65536});
    await python('backup','--root',join(root,'ml'),'--output',join(folder,'ml-backup'));
    await python('restore','--bundle',join(folder,'ml-backup'),'--output',join(folder,'ml-restored'));
    const report={format:'lmps-shadow-demo-1',data:'invented_only',run_id:runId,model_receipt:reviewed.status,case_id:caseId,case_state:'closed',label_id:id(4),label_eligibility:label.eligibility,
      label_export:exported.status,controlled_drift_probe_requests:50,load:{requests:100,concurrency:8,statuses,all_http_p50_ms:percentile(latencies,.5),all_http_p95_ms:percentile(latencies,.95),all_http_p99_ms:percentile(latencies,.99),
        accepted_p95_ms:percentile(accepted,.95),meaning:'local_model_endpoint_including_busy_responses_not_payment_capacity'},metrics,
      pg_restore:drill.status,pg_tables:Object.keys(drill.table_counts).length,ml_restore:'PASS',production_ready:false,enforcement:false};
    await writeFile(join(folder,'report.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});return report;
  }finally{await writer?.close();await risks?.close();await runtime?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==3)throw new Error();const report=await runShadowDemo(process.argv[2]);console.info(JSON.stringify({status:'complete',run_id:report.run_id,pg_restore:report.pg_restore,ml_restore:report.ml_restore,load:report.load,enforcement:false}));}
  catch{console.error('SHADOW_DEMO_FAILED; committed fixture steps retained; private diagnostics withheld.');process.exitCode=1;}
}
