import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateRiskJobInput, riskJobInputHash, listRiskJobs, readRiskJob, readRiskJobAttempts } from '../dist/index.js';
import { riskJobFixture } from './fixtures/risk-job.mjs';

test('semantic dedup excludes UUID aliases while context, target and policy content remain authoritative', () => {
  const input=validateRiskJobInput(riskJobFixture().input), alias=structuredClone(input), id=randomUUID(); alias.job_ref=id; alias.risk_request.run_id=id;
  alias.alert_policy.included_codes.reverse(); assert.equal(riskJobInputHash(input),riskJobInputHash(validateRiskJobInput(alias)));
  for (const mutate of [v=>v.alert_policy.minimum_severity='critical',v=>v.risk_request.context.as_of='2026-10-23T00:00:00.000Z',v=>{v.risk_request.target.revision_number=2;v.risk_request.context.binding.revision_number=2}]) {
    const changed=structuredClone(input);mutate(changed);assert.notEqual(riskJobInputHash(input),riskJobInputHash(validateRiskJobInput(changed)));
  }
});
test('malformed/excessive/live manifests and nested private overrides fail strict validation', () => {
  const input=riskJobFixture().input;
  for (const mutate of [v=>v.risk_request.context.events=Array(201).fill(v.risk_request.context.events[0]),v=>v.risk_request.context.secret='private',v=>v.job_ref=1,v=>v.risk_request.policy.rules[0].weight_bps=0]) {
    const changed=structuredClone(input);mutate(changed);assert.throws(()=>validateRiskJobInput(changed),e=>e.code==='JOB_INVALID_INPUT');
  }
});
const row=()=>({job_ref:randomUUID(),namespace:'synthetic_test',transaction_id:'000001',revision_number:1,status:'pending',effective_status:'pending',stage:'assessment',attempt_number:0,
  assessment_run_id:null,alert_id:null,result_code:null,error_code:null,created_at:'2026-10-22T00:00:00.000Z',updated_at:'2026-10-22T00:00:00.000Z',next_attempt_at:'2026-10-22T00:00:00.000Z'});
test('read projection excludes unexpected private driver fields and uses bound workspace/cursors', async () => {
  const value=row();let args;
  const db={query:async(sql,parameters)=>{args=parameters;return{rows:[{...value,manifest:'SYNTHETIC_PRIVATE',lease_token:'SYNTHETIC_PRIVATE'}]}}};
  const page=await listRiskJobs(db,'synthetic_other',null,1);assert.equal(page.items.length,1);assert.deepEqual(args,['synthetic_other',null,2]);assert.ok(!JSON.stringify(page).includes('PRIVATE'));
  for (const mutate of [v=>v.status='unknown',v=>v.effective_status='completed',v=>v.stage='done',v=>v.error_code='SYNTHETIC_PRIVATE',v=>v.alert_id=randomUUID()]) {
    const corrupt=structuredClone(value);mutate(corrupt);await assert.rejects(readRiskJob({query:async()=>({rows:[corrupt]})},'synthetic_local',value.job_ref),e=>e.code==='JOB_STORAGE_UNAVAILABLE');
  }
});
test('invalid pages reject before SQL and arbitrary storage errors never escape', async () => {
  let called=false;const db={query:async()=>{called=true;throw new Error('SYNTHETIC_PRIVATE')}};
  for (const promise of [listRiskJobs(db,'synthetic_local','bad'),listRiskJobs(db,'synthetic_local',null,11),readRiskJobAttempts(db,'synthetic_local',randomUUID(),9)]) await assert.rejects(promise,e=>e.code==='JOB_INVALID_INPUT');
  assert.equal(called,false);await assert.rejects(listRiskJobs(db,'synthetic_local'),e=>e.code==='JOB_STORAGE_UNAVAILABLE'&&!e.message.includes('PRIVATE'));
});
