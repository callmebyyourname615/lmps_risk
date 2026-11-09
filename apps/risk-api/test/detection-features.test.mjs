import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectionFixture } from './fixtures/detection.mjs';
import { DetectionRuntime } from '../dist/detection-runtime.js';
import { dsn } from '../../../packages/database/scripts/local.mjs';
import { initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot } from '@lmps/risk';
import { featurePublicationContentHash } from '@lmps/contracts/feature-serving';

test('scheduled synthetic feature handoff freezes context, survives replay and withholds stale input', {timeout:30000}, async()=>{
  const f=await detectionFixture();let runtime, competitor, mode='fresh', readerFailure, reads=0;
  const evidenceReader=async target=>{
    if(mode==='failed')throw new Error('synthetic reader unavailable');
    const asOf='2026-01-01T12:00:00Z',version='synthetic-feature-serving-1';
    const query={id:'current',target:target.transaction_id,as_of:asOf,currency:'SYN',evidence:'available',coverage_complete:true,flags_available:false};
    const plan={version:'synthetic-feature-stream-1',identity:'synthetic_declared',run_id:'synthetic_run',input_identity:'synthetic_fixture',namespace:target.namespace,topic:`${target.namespace}.synthetic_run`,window_seconds:3600,coverage_start:'2026-01-01T08:00:00Z',queries:[query],limits:{records:2000,revisions:2000,snapshots:8,capture_bytes:2097152,state_bytes:1048576}};
    const scope={version,mode:'local_synthetic',workspace_key:'synthetic_local',plan,policy:{id:'synthetic_fresh',version:'synthetic_v1',max_age_seconds:120}};
    const event={...target,sender:'synthetic_A',receiver:'synthetic_B',occurred_at:asOf,available_at:asOf,currency:'SYN',amount:'900.00',reversed_amount:'0.00',status:'succeeded'};
    let state=initializeFeatureStream(plan);state=applyFeatureStreamDelivery(state,{identity:'synthetic_declared',topic:plan.topic,partition:0,offset:0,event});state=materializeFeatureStreamSnapshot(state,'current').state;
    const publication={version,scope,generation:1,predecessor:null,state,published_at:asOf,expires_at:'2026-01-01T13:00:00Z',content_hash:Array(8).fill('00000000').join('-')};publication.content_hash=featurePublicationContentHash(publication);
    return {publication,scope,serving_request:{version,workspace_key:'synthetic_local',plan,query,currency:'SYN',policy:scope.policy,now:mode==='stale'?'2026-01-01T12:02:01Z':asOf}};
  };
  let cancelled=false;
  const reader=async(target,signal)=>{reads++;if(mode==='blocked')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(new Error('synthetic reader cancelled'));},{once:true}));try{return await evidenceReader(target);}catch(error){readerFailure=error;throw error;}};
  try{
    await f.approve();await f.template();await f.append('synthetic_feature_target');
    runtime=new DetectionRuntime(dsn(f.state,'intake'),true,50,reader);runtime.onModuleInit();
    competitor=new DetectionRuntime(dsn(f.state,'intake'),true,50,reader);competitor.onModuleInit();
    let row;
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){row=(await f.owner.pool.query("SELECT manifest,status,job_ref FROM platform.local_risk_jobs WHERE transaction_id='synthetic_feature_target'")).rows[0];if(row?.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,30));}
    if(!row && readerFailure)throw readerFailure;
    assert.equal(row?.status,'completed');assert.ok(row.manifest.risk_request.context);
    await competitor.onApplicationShutdown();competitor=null;assert.equal(reads,1);
    const frozen=(await f.owner.pool.query('SELECT snapshot FROM platform.local_transaction_risks WHERE run_id=$1',[row.job_ref])).rows[0].snapshot;
    assert.ok(frozen.result.feature_snapshot_sha256);assert.equal(frozen.request.context.events.length,1);
    await runtime.onApplicationShutdown();runtime=null;
    mode='stale';await f.append('synthetic_stale_target');runtime=new DetectionRuntime(dsn(f.state,'intake'),false,2000,reader);await runtime.tick();
    const stale=(await f.owner.pool.query("SELECT manifest FROM platform.local_risk_jobs WHERE transaction_id='synthetic_stale_target'")).rows[0];assert.equal(stale.manifest.risk_request.context,null);
    await runtime.tick();assert.equal((await f.owner.pool.query("SELECT count(*)::int AS n FROM platform.local_risk_jobs WHERE transaction_id='synthetic_feature_target'")).rows[0].n,1);
    mode='failed';await f.append('synthetic_waiting_target');await runtime.tick();assert.equal(runtime.snapshot().state,'unavailable');
    assert.equal((await f.owner.pool.query("SELECT count(*)::int AS n FROM platform.local_risk_jobs WHERE transaction_id='synthetic_waiting_target'")).rows[0].n,0);
    mode='blocked';await runtime.tick();assert.equal(cancelled,true);assert.equal(runtime.snapshot().state,'unavailable');
  }finally{await competitor?.onApplicationShutdown();await runtime?.onApplicationShutdown();await f.close();}
});
