import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { once } from 'node:events';
import { createModelSignals,createTransactionRisks,createTransactionRevisions,readLabelReview,createDatabase } from '@lmps/database';
import { modelFeatureRequest,readModelTrustFile } from '@lmps/risk';
import { initializeShadowRuntime,openShadowRuntime,runtimeControl } from '../scripts/shadow-runtime.mjs';
import { availablePort,dsn,running } from '../../../packages/database/scripts/local.mjs';
import { closedLabelCase } from '../../../packages/database/test/fixtures/labels.mjs';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { exportLabels } from '../../risk-workers/scripts/label-export.mjs';
let temp,root,ports,runtime,labelId,caseId;
before(async()=>{temp=await mkdtemp('/tmp/lmps-shadow-ops-');root=join(temp,'runtime');ports={api_port:await availablePort(),ml_port:await availablePort(),control_port:await availablePort()};
  const initialized=await initializeShadowRuntime(root,ports);assert.equal(initialized.tables,31);runtime=await openShadowRuntime(root);});
after(async()=>{await runtime?.close();if(temp)await rm(temp,{recursive:true,force:true});});
test('persistent actual ML/Core runtime serves signed inference, scoped label APIs and aggregate monitoring',async()=>{
  const f=transactionRiskFixture(),writer=createTransactionRevisions(dsn(runtime.state,'intake')),risks=createTransactionRisks(dsn(runtime.state,'intake'));
  const token=await readFile(join(root,'ml/auth.token'),'utf8'),trust=await readModelTrustFile(join(root,'ml/public.json')),models=createModelSignals(dsn(runtime.state,'intake'),trust);
  try{
    await writer.append(f.revision);await risks.evaluate(f.request);const features=modelFeatureRequest(f.request,f.observation);
    const scored=await fetch(runtime.ml_url+'/v1/shadow/score',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(features)});assert.equal(scored.status,200);
    const signal=await scored.json(),command={format:1,execution_mode:'shadow',workspace_key:'synthetic_local',request_id:randomUUID(),assessment_run_id:f.request.run_id,
      policy:{policy_id:'synthetic_runtime_gate',version:'synthetic_v1',task:'fraud',probability_threshold:'0.000000000',missing_model:'skip',model:{name:signal.model.name,version:signal.model.version,artifact_sha256:signal.model.artifact_sha256},
        alert_policy:{policy_id:'synthetic_runtime_alert',version:'synthetic_v1',minimum_severity:'high',included_codes:['FRAUD_HIGH_AMOUNT'],include_partial:true}}};
    const saved=await models.record(command,signal);assert.ok(saved.view.alert_id);
    const receipt=await runtime.api.request('reader','GET','/v1/local/model-receipts/'+command.request_id);assert.equal(receipt.receipt.decision.reason_code,'MODEL_CONFIRMED');
    const fixture=await closedLabelCase(runtime.state);caseId=fixture.caseId;labelId=fixture.labelId;
    const candidates=await runtime.api.request('adjudicator','GET','/v1/local/cases/'+caseId+'/label-candidates');assert.equal(candidates.items.length,3);
    const result=await runtime.api.request('adjudicator','POST',`/v1/local/cases/${caseId}/labels/${labelId}`,fixture.command,201);assert.equal(result.view.label.outcome,1);
    const denied=await fetch(runtime.api.url+`/v1/local/labels/${labelId}`,{headers:{authorization:'Bearer '+await runtime.api.token('analyst')}});assert.equal(denied.status,403);
    const label=await runtime.api.request('adjudicator','GET','/v1/local/labels/'+labelId);assert.equal(label.label.eligibility,'eligible');
    const exportId=randomUUID(),exported=await exportLabels(dsn(runtime.state),[labelId],join(root,'label-exports'),exportId);assert.equal(exported.eligible,1);
    assert.equal((await exportLabels(dsn(runtime.state),[labelId],join(root,'label-exports'),exportId)).status,'duplicate');
    assert.equal((await fetch(runtime.ml_url+'/v1/shadow/metrics')).status,401);
    const status=await runtime.status();assert.equal(status.status,'local_components_ready');assert.ok(status.metrics.scoring_completions>=1);assert.equal(status.production_ready,false);
    assert.equal((await fetch(runtime.control_url+'/stop',{method:'POST'})).status,401);
  }finally{for(const repository of [models,risks,writer])await repository.close();}
});
test('single-writer fencing preserves status; restart retains labels and private authentication; stop is instance-bound',async()=>{
  await assert.rejects(openShadowRuntime(root));assert.equal((await runtimeControl(root,'status')).status,'local_components_ready');
  const before=await readFile(join(root,'ml/auth.token'),'utf8');await runtime.close();assert.equal(running(runtime.state),false);
  runtime=await openShadowRuntime(root);assert.equal(await readFile(join(root,'ml/auth.token'),'utf8'),before);
  const label=await runtime.api.request('adjudicator','GET','/v1/local/labels/'+labelId);assert.equal(label.label.eligibility,'eligible');
  const status=await runtimeControl(root,'status');assert.equal(status.metrics.scoring_completions,0);assert.equal(status.metrics.feature_drift.value,null);
  assert.equal((await runtimeControl(root,'stop')).status,'stopping');
  for(let i=0;i<100&&running(runtime.state);i++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(running(runtime.state),false);
});
test('tampered pinned artifacts fail startup and leave the owned cluster stopped',async()=>{
  const path=join(root,'ml/logistic/metadata.json'),original=await readFile(path);await writeFile(path,'{}',{mode:0o600});
  try{await assert.rejects(openShadowRuntime(root));assert.equal(running(runtime.state),false);}finally{await writeFile(path,original,{mode:0o600});}
});
