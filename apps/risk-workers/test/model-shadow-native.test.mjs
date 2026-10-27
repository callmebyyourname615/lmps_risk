import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import { createDatabase,createTransactionRisks,createTransactionRevisions,createModelSignals,createLocalCases,readLocalCase,readCaseHistory,readModelReceipt } from '@lmps/database';
import { modelFeatureRequest,readModelTrustFile,riskHash,verifyShadowResult } from '@lmps/risk';
import { reviewWithModel } from '../dist/model-review.js';
import { availablePort,dsn,initializeCluster,startCluster,stopCluster,loadState,ROOT } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { createBackup,restoreDrill } from '../../../packages/database/scripts/backup.mjs';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';

let temp,state,owner,reader,writer,risks,models,cases,server,port,trust,reference,config,f;
const ws='synthetic_local';
const command=(action,expected_version,extra={})=>({action,request_id:randomUUID(),expected_version,note:'Synthetic ML case evidence',...extra});
const input=(changes={})=>({format:1,execution_mode:'shadow',workspace_key:ws,request_id:randomUUID(),assessment_run_id:f.request.run_id,
  policy:{policy_id:'synthetic_model_gate',version:'synthetic_v1',task:'fraud',probability_threshold:'0.000000000',missing_model:'skip',model:reference,
    alert_policy:{policy_id:'synthetic_ml_confirmed',version:'synthetic_v1',minimum_severity:'high',included_codes:['FRAUD_HIGH_AMOUNT'],include_partial:true},...changes}});
const count=async table=>(await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;
before(async()=>{
  temp=await mkdtemp('/tmp/lmps-ml-e2e-');const ml=join(temp,'ml');await mkdir(ml,{mode:0o700});
  execFileSync('uv',['run','--locked','--offline','--directory','services/ml-inference','python','-m','lmps_ml.demo','--root',ml],{cwd:ROOT,stdio:'pipe',timeout:60000,maxBuffer:1024*1024});
  const demo=JSON.parse(await readFile(join(ml,'demo.json'),'utf8'));assert.deepEqual(demo.training,{baseline:'complete',logistic:'complete',lightgbm:'complete'});reference=demo.model;
  trust=await readModelTrustFile(join(ml,'public.json'));port=await availablePort();
  server=spawn('uv',['run','--locked','--offline','--directory','services/ml-inference','python','-m','lmps_ml'],{
    cwd:ROOT,stdio:'ignore',env:{...process.env,LMPS_ML_PORT:String(port),LMPS_ML_ROOT:ml,LMPS_ML_TOKEN_FILE:join(ml,'auth.token'),LMPS_ML_SIGNING_KEY_FILE:join(ml,'signing.key')}});
  let ready=false;
  for(let i=0;i<200;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/health/ready`,{signal:AbortSignal.timeout(300)});if(r.ok){ready=true;break;}}catch{}
    if(server.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(ready,true,'Actual FastAPI model warmup/readiness');
  state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
  owner=createDatabase(dsn(state,'migration'),'migration');reader=createDatabase(dsn(state));writer=createTransactionRevisions(dsn(state,'intake'));risks=createTransactionRisks(dsn(state,'intake'));
  models=createModelSignals(dsn(state,'intake'),trust);cases=createLocalCases(dsn(state,'case'));
  config={dsn:dsn(state,'intake'),endpoint:`http://127.0.0.1:${port}/v1/shadow/score`,token_file:join(ml,'auth.token'),public_key_file:join(ml,'public.json')};
});
beforeEach(async()=>{
  await owner.pool.query('TRUNCATE platform.local_label_adjudications,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies');
  f=transactionRiskFixture();await writer.append(f.revision);await risks.evaluate(f.request);
});
after(async()=>{
  for(const repository of [models,cases,risks,writer,reader,owner])await repository?.close();
  if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
  if(temp&&!state)try{state=await loadState(join(temp,'pg'));}catch{}
  if(state)await stopCluster(state);if(temp)await rm(temp,{recursive:true,force:true});
});
test('actual dataset→3 CPU learners→MLflow→pinned HTTP shadow→rule gate→Alert→Case→Outcome/Audit; backup restores all proofs',async()=>{
  const request=input(),first=await reviewWithModel(request,config);assert.equal(first.status,'inserted');
  assert.equal(first.view.decision.reason_code,'MODEL_CONFIRMED');assert.ok(first.view.alert_id);assert.equal(first.view.enforcement,false);
  assert.equal(Object.keys(first.view.probabilities).length,3);assert.equal((await reviewWithModel(request,config)).status,'duplicate');assert.equal(await count('local_model_receipts'),1);
  const id=randomUUID(),act=(body,actor='synthetic_coordinator')=>cases.command(ws,id,actor,body);
  await act(command('create',0,{title:'Synthetic model confirmed rule',alert_id:first.view.alert_id}));
  await act(command('assign',1,{assignee_subject:'synthetic_analyst'}));await act(command('start',2),'synthetic_analyst');
  const dimensions=Object.fromEntries(['fraud','mule_network','aml'].map(task=>[task,{outcome:'unknown',rationale:'Invented fixture; no confirmed crime label'}]));
  await act(command('record_outcome',3,{dimensions}),'synthetic_analyst');await act(command('close',4),'synthetic_analyst');
  const view=await readLocalCase(reader.pool,ws,id);assert.equal(view.state,'closed');assert.equal(view.current_outcome.training_eligible,false);
  assert.equal((await readCaseHistory(reader.pool,ws,id,'events')).items.length,5);
  const backups=join(temp,'backups');await mkdir(backups,{mode:0o700});const backup=await createBackup(state,backups),restored=await restoreDrill(backup.directory);
  assert.equal(restored.status,'PASS');assert.equal(restored.table_counts['platform.local_model_receipts'],1);
});
test('below-threshold and unavailable signals stay explicit; rules fallback is opt-in and versioned',async()=>{
  const high=await reviewWithModel(input({probability_threshold:'1.000000000'}),config);assert.equal(high.view.decision.reason_code,'MODEL_BELOW_THRESHOLD');assert.equal(high.view.alert_id,null);
  const skip=input({version:'synthetic_missing'}),unavailable=await reviewWithModel(skip,{...config,endpoint:`http://127.0.0.1:${await availablePort()}/v1/shadow/score`});
  assert.equal(unavailable.view.decision.reason_code,'MODEL_UNAVAILABLE');assert.deepEqual(unavailable.view.probabilities,{});assert.equal(unavailable.view.alert_id,null);
  const fallback=await models.record(input({version:'synthetic_fallback',missing_model:'rules_only'}),null);assert.equal(fallback.view.decision.reason_code,'EXPLICIT_RULES_FALLBACK');assert.ok(fallback.view.alert_id);
});
test('forged/stale signals cannot create receipts; immutable policy/request conflicts and atomic rollback',async()=>{
  const prepared=await models.prepare(input()),features=prepared.features,token=await readFile(config.token_file,'utf8');
  const reply=await fetch(config.endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(features)}),signal=await reply.json();
  assert.equal(verifyShadowResult(signal,features,trust).status,'available');
  await assert.rejects(models.record(input(),{...signal,probabilities:{...signal.probabilities,fraud:'1.000000000'}}),e=>e.code==='ML_PROOF_INVALID');
  const different=structuredClone(features);different.snapshot.feature_sha256='b'.repeat(64);assert.throws(()=>verifyShadowResult(signal,different,trust));
  assert.equal(await count('local_model_receipts'),0);
  const request=input();await models.record(request,signal);
  await assert.rejects(models.record({...request,policy:{...request.policy,probability_threshold:'1.000000000'}},signal),e=>e.code==='ML_REQUEST_CONFLICT');
  await assert.rejects(models.record(input({probability_threshold:'1.000000000'}),signal),e=>e.code==='ML_POLICY_CONFLICT');
  assert.equal(await readModelReceipt(reader.pool,'synthetic_other',request.request_id,trust),null);
  // The migration owner's fault injection proves the receipt and Alert share one transaction.
  await owner.pool.query("ALTER TABLE platform.local_model_receipts ADD CONSTRAINT synthetic_fault CHECK(false) NOT VALID");
  try{await assert.rejects(models.record(input({version:'synthetic_rollback',alert_policy:{...request.policy.alert_policy,version:'synthetic_rollback'}}),signal));}
  finally{await owner.pool.query('ALTER TABLE platform.local_model_receipts DROP CONSTRAINT synthetic_fault');}
  assert.equal(await count('local_model_receipts'),1);assert.equal(await count('local_alerts'),1);assert.equal(await count('local_model_gate_policies'),1);
});
test('new append-only ledgers retain column grants and validate stored proof tampering',async()=>{
  const result=await reviewWithModel(input(),config);
  for(const role of ['app','intake','case','reviewer','outbox','policy']){
    const db=createDatabase(dsn(state,role),role);
    try{for(const table of ['local_model_receipts','local_model_gate_policies'])for(const sql of [`DELETE FROM platform.${table}`,`TRUNCATE platform.${table}`,`UPDATE platform.${table} SET recorded_by='synthetic_forged'`])await assert.rejects(db.pool.query(sql),e=>e.code==='42501');}
    finally{await db.close();}
  }
  const row=(await owner.pool.query('SELECT snapshot FROM platform.local_model_receipts')).rows[0].snapshot;row.model_result.probabilities.fraud='0.000000000';
  await owner.pool.query('UPDATE platform.local_model_receipts SET snapshot=$1,snapshot_sha256=$2',[JSON.stringify(row),riskHash(row)]);
  await assert.rejects(readModelReceipt(reader.pool,ws,result.view.request_id,trust),e=>e.code==='ML_STORAGE_UNAVAILABLE');
});
