import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { modelFeatureRequest,validateModelGateRequest,riskHash,modelGateDecision,evaluateTransactionRisk } from '../dist/index.js';
import { ML_FEATURE_SPEC } from '@lmps/contracts/model-signal';
const fixture=JSON.parse(readFileSync(new URL('../../contracts/fixtures/ml-feature-parity.json',import.meta.url),'utf8'));
fixture.expected.snapshot.feature_spec_sha256=riskHash(ML_FEATURE_SPEC);
fixture.expected.snapshot.feature_sha256=riskHash(fixture.expected.snapshot);
test('point-in-time ML features share exact Python/TypeScript fingerprints and preserve fixed precision',()=>{
  assert.equal(fixture.synthetic_only,true);assert.deepEqual(modelFeatureRequest(fixture.request,fixture.observation),fixture.expected);
  const future=structuredClone(fixture.request),correction={...future.context.events[6],revision_number:2,available_at:'2026-01-02T00:00:00.000Z',amount:'1.00'};
  future.context.events.push(correction);assert.deepEqual(modelFeatureRequest(future,fixture.observation),fixture.expected);
  future.context.identity_status='unverified';const unavailable=modelFeatureRequest(future,fixture.observation).snapshot;
  assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.values,null);assert.equal(unavailable.net_amount_cents,null);
});
test('gate rejects coercion, extra fields and cross-dimension rule policies; missing signal never implies zero',()=>{
  const request={format:1,execution_mode:'shadow',workspace_key:'synthetic_local',request_id:randomUUID(),assessment_run_id:fixture.request.run_id,
    policy:{policy_id:'synthetic_gate',version:'synthetic_v1',task:'fraud',probability_threshold:'0.500000000',missing_model:'skip',model:{name:'synthetic_model',version:'1',artifact_sha256:'a'.repeat(64)},
      alert_policy:{policy_id:'synthetic_alerts',version:'synthetic_v1',minimum_severity:'high',included_codes:['FRAUD_HIGH_AMOUNT'],include_partial:true}}};
  validateModelGateRequest(request);const result=evaluateTransactionRisk(fixture.request,fixture.observation),decision=modelGateDecision(result,request,null);
  assert.equal(decision.reason_code,'MODEL_UNAVAILABLE');assert.equal(decision.probability,null);
  for(const change of [{format:'1'},{request_id:[request.request_id]},{extra:true},{policy:{...request.policy,model:{...request.policy.model,version:1}}},{policy:{...request.policy,probability_threshold:0.5}},{policy:{...request.policy,alert_policy:{...request.policy.alert_policy,included_codes:['MULE_FAN_IN']}}}])assert.throws(()=>validateModelGateRequest({...request,...change}));
  const changed=structuredClone(fixture.request);changed.context.events.at(-1).amount='1.00';assert.equal(modelFeatureRequest(changed,fixture.observation).snapshot.status,'unavailable');
});
