import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createDatabase,createTransactionRevisions,createTransactionRisks,createLocalAlerts,readMonitoringSnapshot,datasetRowsHash } from '@lmps/database';
import { makeSourcePublication,sourcePublicationTransaction,sourceTransactionId,sourceContentHash } from '@lmps/contracts/source-publication';
import { parseMonitoringFilters } from '@lmps/contracts/monitoring';
import { availablePort,initializeCluster,startCluster,stopCluster,dsn } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { datasetFixture } from '../../../packages/database/test/fixtures/offline-dataset.mjs';
import { revision } from '../../../packages/database/test/fixtures/transaction-revision.mjs';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';
import { importOfflineDataset } from '../dist/offline-dataset.js';
import { publishOfflineBatch, inspectOfflineSourceContract } from '../dist/offline-publication.js';
import { readMonitoringTimeline, readDetectionHealth } from '@lmps/database';
import { parseDetectionFilters } from '@lmps/contracts/detection-health';
import * as portalPolicySource from '../../../packages/risk/fixtures/portal-policy.mjs';

test('unknown CSV results retain unavailable evidence across Monitoring, Timeline and Detection Health',async()=>{
  const temporary=await mkdtemp('/tmp/lmps-unknown-monitoring-');let state,db,writer,risks;
  try{
    state=await initializeCluster(join(temporary,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
    db=createDatabase(dsn(state),'app','synthetic_csv');writer=createTransactionRevisions(dsn(state,'intake'));risks=createTransactionRisks(dsn(state,'intake'));
    const projected=makeSourcePublication({workspace:'synthetic_local',namespace:'synthetic_csv',generation:randomUUID(),batch:randomUUID(),
      dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),source_namespace:'lmps_transfer',row_number:1,
      values:['1','2026-11-03 00:00:00','1.00','LAK','ERROR','2026-11-03 00:00:01'],observed_at:'2026-11-04T00:00:00.000Z',expected_revision:0});
    await writer.append({format:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:'synthetic_local',expected_revision:0,...projected});
    const target={namespace:'synthetic_csv',transaction_id:projected.transaction.transaction_id,revision_number:1};
    const policy=riskFixture().request.policy;policy.currency='LAK';
    await risks.evaluate({format:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:'synthetic_local',run_id:randomUUID(),target,policy,context:null});
    const snapshot=await readMonitoringSnapshot(db.pool,'synthetic_local',parseMonitoringFilters({}));
    assert.equal(snapshot.summary.counts.transactions,1);assert.equal(snapshot.summary.assessment_statuses.unavailable,1);
    assert.equal(snapshot.transactions[0].transaction_status,'unknown');
    assert.equal(snapshot.network[0].reason,'IDENTITY_UNVERIFIED');
    const timeline=await readMonitoringTimeline(db.pool,'synthetic_local',{namespace:target.namespace,transaction_id:target.transaction_id});
    assert.equal(timeline.assessments[0].bound,true);assert.equal(timeline.assessments[0].result.assessment_status,'unavailable');
    const worker={configured:false,enabled:false,state:'disabled',last_completed_at:null,last_enqueued:null,last_processed:null,interval_seconds:10};
    const health=await readDetectionHealth(db.pool,'synthetic_local',parseDetectionFilters({}),worker);
    assert.equal(health.counts.with_assessment,1);assert.equal(health.rows[0].assessment_status,'unavailable');
  }finally{for(const service of [db,writer,risks])await service?.close();if(state)await stopCluster(state);await rm(temporary,{recursive:true,force:true});}
});

test('source publication retains file provenance and raw evidence; test mapping cannot be forged into other status/currency',()=>{
  const input={workspace:'synthetic_local',namespace:'synthetic_csv',generation:randomUUID(),batch:randomUUID(),dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),source_namespace:'lmps_transfer',row_number:1,
    values:['1','2026-10-01 12:00:00','1000000.00','LAK','OK','2026-10-01 12:00:01'],observed_at:'2026-10-02T00:00:00.000Z',expected_revision:0};
  const p=makeSourcePublication(input);assert.equal(p.publication.provenance,'user_supplied_file');assert.equal(p.transaction.transaction_status,'succeeded');assert.equal(p.transaction.currency,'LAK');
  assert.equal(p.transaction.occurred_at,null);assert.equal(p.transaction.sender.status,'unresolved');
  for(const mutate of [p=>p.provenance='local_synthetic',p=>p.origin.values[2]='1.00',p=>p.normalization_input.status_code='SYNTH_FAILED',p=>p.origin.mapping='owner_verified',p=>p.binding.currency.code='THB']){
    const value=structuredClone(p.publication);mutate(value);assert.throws(()=>sourcePublicationTransaction(value));
  }
  input.values[4]='TRANSACTION_FAILED';assert.equal(makeSourcePublication(input).transaction.transaction_status,'failed');
  input.values[4]='UNKNOWN';assert.equal(makeSourcePublication(input).transaction.transaction_status,'unknown');
});

test('schema-shaped keys and decimal values retain distinct observations and exact corrections',()=>{
  const original=['2147483647','2026-10-01 12:00:00','9999999999999999999999.99','LAK','OK','2026-10-01 12:00:01'];
  const otherTime=[...original];otherTime[1]='2026-10-01 12:00:01';
  const corrected=[...original];corrected[2]='9999999999999999999999.98';
  assert.notEqual(sourceTransactionId(original),sourceTransactionId(otherTime));
  assert.equal(sourceTransactionId(original),sourceTransactionId(corrected));
  assert.notEqual(sourceContentHash(original),sourceContentHash(corrected));
  const input={workspace:'synthetic_local',namespace:'synthetic_csv',generation:randomUUID(),batch:randomUUID(),dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),source_namespace:'lmps_transfer',row_number:1,values:original,observed_at:'2026-10-02T00:00:00.000Z',expected_revision:0};
  const first=makeSourcePublication(input);
  assert.equal(first.transaction.amount,original[2]);
  assert.equal(first.transaction.occurred_at,null);
  assert.equal(first.transaction.sender.status,'unresolved');
  const next=makeSourcePublication({...input,values:corrected,expected_revision:1});
  assert.equal(next.transaction.amount,corrected[2]);
  assert.notEqual(first.transaction.transaction_revision,next.transaction.transaction_revision);
  assert.equal(first.transaction.transaction_id,next.transaction.transaction_id);
});

test('CSV staging -> original source/revision/risk/Alert/Monitoring pipeline supports retry, correction, stale-file refusal and source isolation',async()=>{
  const temporary=await mkdtemp('/tmp/lmps-csv-pipeline-');let state,writer,owner,app,all,risks,alerts;
  try{
    state=await initializeCluster(join(temporary,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
    owner=createDatabase(dsn(state,'migration'),'migration');writer=createTransactionRevisions(dsn(state,'intake'));
    app=createDatabase(dsn(state),'app','synthetic_csv');all=createDatabase(dsn(state));
    await writer.append(revision());
    const generation=randomUUID();
    async function stage(amount='1000000.00'){
      const f=datasetFixture(3);f.rows=f.rows.map((row,i)=>[...row.slice(0,2),i===0?amount:'20.00',i===2?'THB':'LAK',i===1?'TRANSACTION_FAILED':'OK',row[5]]);
      f.manifest.rows_sha256=datasetRowsHash(f.rows);const bytes=JSON.stringify(f.rows);f.manifest.dataset_sha256=createHash('sha256').update(bytes).digest('hex');f.manifest.input_bytes=Buffer.byteLength(bytes);
      await importOfflineDataset(dsn(state,'intake'),f);
      return {format:1,source_workspace:f.manifest.workspace_key,batch_ref:f.manifest.batch_ref,dataset_sha256:f.manifest.dataset_sha256,workspace:'synthetic_local',namespace:'synthetic_csv',generation,
        observed_at:'2026-10-02T00:00:00.000Z',mapping:'operator_intake_test_ok_failed_v1'};
    }
    const first=await stage(),receipt=await publishOfflineBatch(dsn(state,'intake'),first);assert.deepEqual(receipt.counts,{source_rows:3,inserted:3,corrected:0,duplicates:0,quarantined:0});
    assert.equal((await publishOfflineBatch(dsn(state,'intake'),first)).counts.duplicates,3);
    assert.equal((await app.pool.query('SELECT count(*)::int n FROM platform.local_transaction_revisions')).rows[0].n,3);
    assert.equal((await all.pool.query('SELECT count(*)::int n FROM platform.local_transaction_revisions')).rows[0].n,4);
    assert.equal((await owner.pool.query("SELECT count(*)::int n FROM platform.source_records WHERE provenance='user_supplied_file'")).rows[0].n,3);
    const rows=(await app.pool.query('SELECT namespace,transaction_id,revision_number FROM platform.local_transaction_revisions ORDER BY transaction_id')).rows;
    risks=createTransactionRisks(dsn(state,'intake'));alerts=createLocalAlerts(dsn(state,'intake'));
    const policy=riskFixture().request.policy;policy.currency='LAK';policy.rules.find(rule=>rule.code==='FRAUD_HIGH_AMOUNT').threshold='1000000.00';
    const contract=await inspectOfflineSourceContract(dsn(state,'intake'),first,policy);
    assert.equal(contract.source_rows,3);
    assert.deepEqual(contract.patterns[0].counts,{eligible_for_test:1,waiting_policy:1,unavailable:0,not_applicable:1,disabled:0});
    assert.equal(contract.rows_sha256,(await import('@lmps/database')).datasetRowsHash([
      ['1','2026-10-01 12:00:00','1000000.00','LAK','OK','2026-10-01 12:00:00'],
      ['2','2026-10-01 12:00:00','20.00','LAK','TRANSACTION_FAILED','2026-10-01 12:00:00'],
      ['3','2026-10-01 12:00:00','20.00','THB','OK','2026-10-01 12:00:00'],
    ]));
    await assert.rejects(inspectOfflineSourceContract(dsn(state,'intake'),{...first,dataset_sha256:'f'.repeat(64)},policy));
    assert.equal((await app.pool.query('SELECT count(*)::int n FROM platform.local_transaction_revisions')).rows[0].n,3);
    const request={format:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:'synthetic_local',run_id:randomUUID(),target:rows[0],policy,context:null};
    const evaluated=await risks.evaluate(request);assert.equal(evaluated.result.provenance,'user_supplied_file');assert.ok(evaluated.result.risk_types.includes('FRAUD_HIGH_AMOUNT'));
    assert.equal(evaluated.result.assessment_status,'partial');
    const generated=await alerts.generate({format:1,provenance:'local_synthetic',execution_mode:'test',workspace_key:'synthetic_local',assessment_run_id:request.run_id,
      policy:{policy_id:'synthetic_csv_alerts',version:'synthetic_v1',minimum_severity:'high',included_codes:['FRAUD_HIGH_AMOUNT'],include_partial:true}});
    assert.ok(generated.alert_id);
    const snapshot=await readMonitoringSnapshot(app.pool,'synthetic_local',parseMonitoringFilters({}));assert.equal(snapshot.summary.provenance,'local_test');assert.equal(snapshot.summary.counts.transactions,3);assert.equal(snapshot.summary.counts.flagged,1);assert.equal(snapshot.summary.counts.alerts,1);
    const correction=await stage('1.00');correction.observed_at='2026-10-03T00:00:00.000Z';const changed=await publishOfflineBatch(dsn(state,'intake'),correction);assert.equal(changed.counts.corrected,1);assert.equal(changed.counts.duplicates,2);
    const sourceEvidence=async()=>(await owner.pool.query(`SELECT 'records' AS kind,to_jsonb(record) AS content FROM platform.source_records record
      UNION ALL SELECT 'events',to_jsonb(record) FROM platform.source_events record ORDER BY kind,content`)).rows;
    const beforeStale=await sourceEvidence(),unseenStale=await stage('2.00');unseenStale.observed_at='2026-10-02T12:00:00.000Z';
    await assert.rejects(publishOfflineBatch(dsn(state,'intake'),unseenStale));assert.deepEqual(await sourceEvidence(),beforeStale);
    await assert.rejects(publishOfflineBatch(dsn(state,'intake'),first));
    assert.equal((await publishOfflineBatch(dsn(state,'intake'),correction)).counts.duplicates,3);
    const fresh=await readMonitoringSnapshot(app.pool,'synthetic_local',parseMonitoringFilters({}));assert.equal(fresh.summary.counts.transactions,3);assert.equal(fresh.summary.counts.flagged,0);assert.equal(snapshot.summary.counts.flagged,1);
    assert.equal((await app.pool.query('SELECT count(*)::int n FROM platform.local_transaction_revisions')).rows[0].n,4);
  }finally{
    for(const service of [writer,owner,app,all,risks,alerts])await service?.close();
    if(state)await stopCluster(state);await rm(temporary,{recursive:true,force:true});
  }
});

test('synthetic Portal policy fixture executes through approved commands, amount evaluator and detection worker without a THB threshold guess',async()=>{
  const {configurePortalIntakePolicy,evaluatePortalAmountRules,drainIntakeDetection}=await import('../../../tools/portal-intake-policy.mjs');
  const {createRiskPolicies}=await import('@lmps/database');
  const temp=await mkdtemp('/tmp/lmps-csv-policy-');let state,owner,policies;
  try{
    state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
    owner=createDatabase(dsn(state,'migration'),'migration');policies=createRiskPolicies(dsn(state,'policy'));
    const baseline=riskFixture().request.policy;
    const ref={policy_id:baseline.policy_id,policy_version:baseline.version};
    for(const [action,actor,extra] of [['create','synthetic_maker',{policy:baseline}],['submit','synthetic_maker',{...ref,expected_revision:0}],['approve','synthetic_checker',{...ref,expected_revision:1}],['activate','synthetic_checker',{...ref,namespace:'synthetic_snapshot',currency:'SYN',expected_generation:0}]])await policies.command('synthetic_local',actor,{action,request_id:randomUUID(),note:'Existing test binding',...extra});
    const f=datasetFixture(3);f.rows=f.rows.map((row,i)=>[...row.slice(0,2),'1000000.00',i===2?'THB':'LAK',i===1?'TRANSACTION_FAILED':'OK',row[5]]);
    f.manifest.rows_sha256=datasetRowsHash(f.rows);f.manifest.dataset_sha256=createHash('sha256').update(JSON.stringify(f.rows)).digest('hex');f.manifest.input_bytes=Buffer.byteLength(JSON.stringify(f.rows));await importOfflineDataset(dsn(state,'intake'),f);
    await publishOfflineBatch(dsn(state,'intake'),{format:1,source_workspace:f.manifest.workspace_key,batch_ref:f.manifest.batch_ref,dataset_sha256:f.manifest.dataset_sha256,workspace:'synthetic_local',namespace:'synthetic_csv',generation:randomUUID(),observed_at:'2026-10-02T00:00:00.000Z',mapping:'operator_intake_test_ok_failed_v1'});
    const configured=await configurePortalIntakePolicy(state,portalPolicySource);assert.equal(configured.receipt.fraud_amount_threshold,'1000000.00');assert.equal(configured.receipt.aml_amount_threshold,'200000.00');
    const reports=await evaluatePortalAmountRules(state,configured.selected);assert.equal(reports[0].status,'inserted');assert.equal(reports[0].report.provenance,'user_supplied_file');assert.equal(reports[0].report.counts.rule_matches,2);
    await drainIntakeDetection(state);
    assert.equal((await owner.pool.query("SELECT count(*)::int n FROM platform.local_risk_jobs WHERE namespace='synthetic_csv' AND status='completed'")).rows[0].n,2);
    assert.equal((await owner.pool.query("SELECT count(*)::int n FROM platform.local_risk_policy_bindings WHERE namespace='synthetic_csv' AND currency='THB'")).rows[0].n,0);
    assert.equal((await owner.pool.query('SELECT count(*)::int n FROM platform.local_alerts')).rows[0].n,1);
    await configurePortalIntakePolicy(state,portalPolicySource);assert.equal((await evaluatePortalAmountRules(state,configured.selected))[0].status,'duplicate');assert.deepEqual(await drainIntakeDetection(state),{enqueued:0,processed:0});
    assert.equal((await owner.pool.query('SELECT count(*)::int n FROM platform.local_alerts')).rows[0].n,1);
  }finally{for(const service of [owner,policies])await service?.close();if(state)await stopCluster(state);await rm(temp,{recursive:true,force:true});}
});
