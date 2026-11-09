import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {makeSourcePublication} from '../packages/contracts/dist/source-publication.js';
import {createDatabase,createTransactionRevisions,createRiskPolicies,datasetRowsHash} from '../packages/database/dist/index.js';
import {riskFixture} from '../packages/risk/fixtures/request.mjs';
import {availablePort,initializeCluster,startCluster,stopCluster,dsn} from '../packages/database/scripts/local.mjs';
import {migrations} from '../packages/database/scripts/migrations.mjs';
import {matchReviewBindings} from './bind-intake-review.mjs';
import {planJointApplication,applyJointApplication} from './apply-intake-joint-mapping.mjs';
import {configurePortalIntakePolicy,drainIntakeDetection} from './portal-intake-policy.mjs';
import * as portalPolicySource from '../packages/risk/fixtures/portal-policy.mjs';

function fixture() {
  const pairs=[{result:'OK',shouldrevert:'0'},{result:'ERROR',shouldrevert:'1'},
    {result:'LMPS PAYMENT TIME IS EXPIRE',shouldrevert:'1'},{result:'OK',shouldrevert:null},{result:'OK',shouldrevert:null}];
  const rows=pairs.map((pair,i)=>[String(i+1),'2026-11-03 00:00:00','1000000.00',i<2?'LAK':'THB',pair.result,'2026-11-03 00:00:01']);
  const importSha=createHash('sha256').update(JSON.stringify(rows)).digest('hex'),batch=randomUUID(),generation=randomUUID();
  const snapshot={manifest:{source_table:'transfer',dataset_sha256:importSha,batch_ref:batch,rows_sha256:datasetRowsHash(rows)},rows};
  const input={binding:{format:'lmps-review-binding-input-1',manifest_sha256:'a'.repeat(64),review_sha256:'b'.repeat(64),import_sha256:importSha,
    review_file:'review/transfer-0000.csv',import_file:'import/transfer-0000.csv',
    rows:rows.map((values,i)=>({values,review_row_number:i+1,review_row_sha256:String(i+1).repeat(64)}))},pairs};
  const stored=rows.map((values,i)=>{const p=makeSourcePublication({workspace:'synthetic_local',namespace:'synthetic_csv',generation,batch,
    dataset_sha256:importSha,rows_sha256:snapshot.manifest.rows_sha256,source_namespace:'lmps_transfer',row_number:i+1,values,
    observed_at:'2026-11-04T00:00:00.000Z',expected_revision:0});
    return {workspace_key:'synthetic_local',namespace:'synthetic_csv',transaction_id:p.transaction.transaction_id,revision_number:1,payload:p.transaction,publication:p.publication};});
  return {input,snapshot,stored,bound:matchReviewBindings(input.binding,snapshot,stored)};
}

test('plan appends only four changed rows and accepts exact replay while preserving unchanged evidence',()=>{
  const f=fixture(),before=structuredClone(f.stored);
  const plan=planJointApplication(f.input,f.bound,f.snapshot,f.stored);
  assert.equal(plan.revisions.length,4);assert.equal(plan.report.retained_v1_revisions,1);
  assert.deepEqual(plan.report.counts,{succeeded:1,failed:2,unknown:2});assert.deepEqual(f.stored,before);
  for(const r of plan.revisions)f.stored.push({workspace_key:r.workspace_key,namespace:r.transaction.source_reference.namespace,
    transaction_id:r.transaction.transaction_id,revision_number:r.expected_revision+1,payload:r.transaction,publication:r.publication});
  const retry=planJointApplication(f.input,f.bound,f.snapshot,f.stored);
  assert.equal(retry.revisions.length,0);assert.equal(retry.already_applied,4);assert.deepEqual(retry.report,plan.report);
});

test('changed original, stale latest, binding, review or pair selection fails before writing',()=>{
  for(const mutate of [f=>f.stored[0].payload.amount='1.00',f=>f.bound.rows[0].publication_sha256='0'.repeat(64),
    f=>f.input.pairs[1].result='OTHER',f=>f.input.binding.rows[1].review_row_sha256='0'.repeat(64),
    f=>f.stored.push({...f.stored[0],revision_number:2}),f=>f.stored.pop(),f=>f.snapshot.rows[0][2]='2.00']) {
    const f=fixture();mutate(f);assert.throws(()=>planJointApplication(f.input,f.bound,f.snapshot,f.stored));
  }
});

test('native atomic rollback, concurrent retry, original detection and Alert deduplication',async()=>{
  const temporary=await mkdtemp('/tmp/lmps-joint-application-');let state,owner,db,writer,policies;
  try {
    state=await initializeCluster(join(temporary,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
    owner=createDatabase(dsn(state,'migration'),'migration');db=createDatabase(dsn(state,'intake'),'intake');writer=createTransactionRevisions(dsn(state,'intake'));
    const f=fixture();
    for(const r of f.stored)await writer.append({format:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:r.workspace_key,
      expected_revision:0,transaction:r.payload,publication:r.publication});
    const read=async()=>(await owner.pool.query('SELECT workspace_key,namespace,transaction_id,revision_number,payload,publication FROM platform.local_transaction_revisions ORDER BY transaction_id,revision_number')).rows;
    f.stored=await read();f.bound=matchReviewBindings(f.input.binding,f.snapshot,f.stored);
    policies=createRiskPolicies(dsn(state,'policy'));
    const baseline=riskFixture().request.policy,ref={policy_id:baseline.policy_id,policy_version:baseline.version};
    for(const [action,actor,extra] of [['create','synthetic_maker',{policy:baseline}],['submit','synthetic_maker',{...ref,expected_revision:0}],
      ['approve','synthetic_checker',{...ref,expected_revision:1}],['activate','synthetic_checker',{...ref,namespace:'synthetic_snapshot',currency:'SYN',expected_generation:0}]])
      await policies.command('synthetic_local',actor,{action,request_id:randomUUID(),note:'Synthetic test binding',...extra});
    await configurePortalIntakePolicy(state,portalPolicySource);await drainIntakeDetection(state);
    const alertsBefore=(await owner.pool.query('SELECT count(*)::int n FROM platform.local_alerts')).rows[0].n;assert.equal(alertsBefore,1);
    await owner.pool.query("ALTER TABLE platform.local_transaction_revisions ADD CONSTRAINT joint_test_failure CHECK (NOT (revision_number=2 AND transaction_id='lmps_3_20261103000000'))");
    await assert.rejects(applyJointApplication(db,f.input,f.bound,f.snapshot));assert.deepEqual(await read(),f.stored);
    await owner.pool.query('ALTER TABLE platform.local_transaction_revisions DROP CONSTRAINT joint_test_failure');
    const results=await Promise.all([applyJointApplication(db,f.input,f.bound,f.snapshot),applyJointApplication(db,f.input,f.bound,f.snapshot)]);
    assert.deepEqual(results.map(r=>r.status).sort(),['applied','duplicate']);assert.equal(results.reduce((n,r)=>n+r.inserted,0),4);
    assert.deepEqual((await read()).filter(r=>r.revision_number===1),f.stored);
    assert.deepEqual(await drainIntakeDetection(state),{enqueued:1,processed:1});
    assert.equal((await owner.pool.query('SELECT count(*)::int n FROM platform.local_alerts')).rows[0].n,alertsBefore);
    assert.equal((await applyJointApplication(db,f.input,f.bound,f.snapshot)).inserted,0);
    assert.deepEqual(await drainIntakeDetection(state),{enqueued:0,processed:0});
    const corrected=(await read()).find(r=>r.revision_number===2&&r.payload.currency==='LAK');
    assert.equal(corrected.payload.transaction_status,'failed');assert.equal(corrected.publication.provenance,'user_supplied_file');
    assert.equal(corrected.payload.occurred_at,null);assert.equal(corrected.payload.sender.status,'unresolved');
    const forged=structuredClone(corrected.payload);forged.transaction_status='reversed';
    await assert.rejects(owner.pool.query(`INSERT INTO platform.local_transaction_revisions
      (workspace_key,namespace,transaction_id,revision_number,payload,publication,provenance) VALUES ('synthetic_local','synthetic_csv',$1,3,$2,$3,'user_supplied_file')`,
      [corrected.transaction_id,JSON.stringify({...forged,transaction_revision:'synthetic_forged'}),JSON.stringify({...corrected.publication,
        binding:{...corrected.publication.binding,expected_revision:2,transaction_revision:'synthetic_forged'}})]));
  } finally {
    for(const service of [policies,writer,db,owner])await service?.close();if(state)await stopCluster(state);
    await rm(temporary,{recursive:true,force:true});
  }
});
