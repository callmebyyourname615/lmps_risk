import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { OFFLINE_REPLAY_VERSION, validateReplayInput } from '../dist/offline-replay.js';

const input = () => ({ format:1, execution_mode:'offline_analysis', evaluator_version:OFFLINE_REPLAY_VERSION, run_id:randomUUID(),
  workspace_key:'offline_test', batch_ref:randomUUID(), dataset_sha256:'0'.repeat(64),
  policy:{version:'simulation_test_v1',purpose:'simulation_only',amount_semantics:'raw_recorded_amount',amount_unit:'as_recorded',
    lifecycle_scope:'all_recorded_rows',thresholds:[{source_ccy:'Z',amount_gte:'100.00'},{source_ccy:' A ',amount_gte:'0.01'}]} });
const invalid = fn => assert.throws(fn,e=>e.code==='REPLAY_INVALID_INPUT'&&!e.message.includes('PRIVATE'));
test('replay input clones and canonicalizes only threshold ordering, preserving literal codes',()=>{
  const v=input(),before=structuredClone(v),checked=validateReplayInput(v);assert.deepEqual(v,before);
  assert.deepEqual(checked.policy.thresholds.map(t=>t.source_ccy),[' A ','Z']);checked.policy.thresholds[0].amount_gte='2.00';assert.deepEqual(v,before);
});
test('replay requires explicit pinned offline scope/version and rejects extra fields',()=>{
  for(const change of [{format:2},{execution_mode:'test'},{evaluator_version:'unknown'},{run_id:'bad'},{batch_ref:1},{workspace_key:'synthetic_local'},
    {dataset_sha256:'bad'},{rows_sha256:0},{private:'PRIVATE'}])invalid(()=>validateReplayInput({...input(),...change}));
  for(const v of [null,[],{},'PRIVATE'])invalid(()=>validateReplayInput(v));
  for(const name of ['run_id','batch_ref','workspace_key','dataset_sha256']){const v=input();v[name]+='\n';invalid(()=>validateReplayInput(v));}
});
test('simulation declarations cannot imply normalized money, lifecycle, or production approval',()=>{
  for(const change of [{version:'production_v1'},{purpose:'approved'},{amount_unit:'minor_units'},{amount_semantics:'net_executed_amount'},
    {lifecycle_scope:'succeeded'},{statuses:['S']},{thresholds:[]},{thresholds:Array(33).fill({source_ccy:'Z',amount_gte:'1.00'})}]){
    const v=input();Object.assign(v.policy,change);invalid(()=>validateReplayInput(v));
  }
});
test('threshold codes are exact bounded Unicode and money is a positive exact decimal string',()=>{
  for(const threshold of [0,'0.00','-1.00','1.001','01.00','1e3','1.00\n','10000000000000000000000.00']){
    const v=input();v.policy.thresholds[0].amount_gte=threshold;invalid(()=>validateReplayInput(v));
  }
  for(const currency of [null,1,'','X\nY','\ud800','🟢'.repeat(201)]){
    const v=input();v.policy.thresholds[0].source_ccy=currency;invalid(()=>validateReplayInput(v));
  }
  const v=input();v.policy.thresholds=[{source_ccy:'🟢'.repeat(200),amount_gte:'9999999999999999999999.99'}];assert.doesNotThrow(()=>validateReplayInput(v));
  v.policy.thresholds.push({...v.policy.thresholds[0]});invalid(()=>validateReplayInput(v));
  v.policy.thresholds=[{source_ccy:'Z',amount_gte:'1.00',extra:'PRIVATE'}];invalid(()=>validateReplayInput(v));
});
test('replay refuses production/live environments before database access',()=>{
  for(const [name,value] of [['NODE_ENV','production'],['LMPS_ENVIRONMENT','production'],['LMPS_EXECUTION_MODE','live']]){
    const prior=process.env[name];process.env[name]=value;try{invalid(()=>validateReplayInput(input()));}
    finally{if(prior===undefined)delete process.env[name];else process.env[name]=prior;}
  }
});
