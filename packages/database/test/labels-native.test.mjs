import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,beforeEach,after,test } from 'node:test';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase,createLabelReviews,createLocalCases,labelCandidates,readLabelReview } from '../dist/index.js';
import { availablePort,initializeCluster,startCluster,stopCluster,loadState,dsn } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { createBackup,restoreDrill } from '../scripts/backup.mjs';
import { closedLabelCase } from './fixtures/labels.mjs';
let temp,state,reader,owner,labels,cases,f;
const ws='synthetic_local',reviewer='synthetic_independent_reviewer';
const act=(command=f.command,actor=reviewer,id=f.labelId)=>labels.adjudicate(ws,f.caseId,id,actor,command);
before(async()=>{temp=await mkdtemp('/tmp/lmps-labels-');state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
  reader=createDatabase(dsn(state));owner=createDatabase(dsn(state,'migration'),'migration');labels=createLabelReviews(dsn(state,'policy'));cases=createLocalCases(dsn(state,'case'));});
beforeEach(async()=>{await owner.pool.query('TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies');f=await closedLabelCase(state);});
after(async()=>{for(const r of [cases,labels,reader,owner])await r?.close();if(temp&&!state)try{state=await loadState(join(temp,'pg'));}catch{}if(state)await stopCluster(state);if(temp)await rm(temp,{recursive:true,force:true});});
test('Case unknown opinions become candidates only; independent fixture adjudication and exact retries have immutable evidence',async()=>{
  const candidates=await labelCandidates(reader.pool,ws,f.caseId);assert.equal(candidates.items.length,3);assert.ok(candidates.items.every(c=>c.label_outcome===null&&c.training_eligible===false));
  await assert.rejects(act(f.command,'synthetic_analyst'),e=>e.code==='LABEL_SELF_REVIEW');
  const results=await Promise.all([act(),act()]);assert.deepEqual(results.map(r=>r.status).sort(),['duplicate','inserted']);
  assert.equal(results[0].view.eligibility,'eligible');assert.equal(results[0].view.label.outcome,1);assert.deepEqual(results[0].view.target,f.target);
  await assert.rejects(act({...f.command,outcome:0}),e=>e.code==='LABEL_CONFLICT');
});
test('unknown, immature and unverified external evidence never become negative labels; revocation retains history',async()=>{
  const unknown=await act({...f.command,outcome:null});assert.equal(unknown.view.reason_code,'LABEL_UNKNOWN');assert.equal(unknown.view.label.outcome,null);
  const unverified=await act({...f.command,request_id:randomUUID(),expected_version:1,evidence:{...f.command.evidence,kind:'external_resolution_unverified'}});assert.equal(unverified.view.reason_code,'LABEL_PROVENANCE_UNVERIFIED');
  const future=await act({...f.command,request_id:randomUUID(),expected_version:2,mature_at:'2099-01-01T00:00:00.000Z'});assert.equal(future.view.reason_code,'LABEL_IMMATURE');
  const revoked=await act({...f.command,request_id:randomUUID(),expected_version:3,action:'revoke',outcome:null});assert.equal(revoked.view.reason_code,'LABEL_REVOKED');assert.equal(revoked.view.version,4);
});
test('reopen invalidates exported eligibility; ordinary roles cannot rewrite labels and backups restore audit rows',async()=>{
  await act();await cases.command(ws,f.caseId,'synthetic_coordinator',{action:'reopen',request_id:randomUUID(),expected_version:5,note:'Reopen fixture evidence'});
  assert.equal((await readLabelReview(reader.pool,ws,f.labelId)).reason_code,'CASE_EVIDENCE_CHANGED');assert.equal(await readLabelReview(reader.pool,'synthetic_other',f.labelId),null);
  for(const role of ['app','policy','case','intake','reviewer']){const db=createDatabase(dsn(state,role),role);try{for(const sql of ['DELETE FROM platform.local_label_adjudications','TRUNCATE platform.local_label_adjudications',"UPDATE platform.local_label_adjudications SET actor_subject='synthetic_spoof'"])await assert.rejects(db.pool.query(sql),e=>e.code==='42501');}finally{await db.close();}}
  await mkdir(join(temp,'backups'),{mode:0o700});const backup=await createBackup(state,join(temp,'backups')),restored=await restoreDrill(backup.directory);assert.equal(restored.table_counts['platform.local_label_adjudications'],1);
});
