import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createRiskJobs, createTransactionRevisions, createTransactionRisks, readRiskJob } from '../../../packages/database/dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { riskJobFixture } from '../../../packages/database/test/fixtures/risk-job.mjs';
import { runRiskJob } from '../../risk-workers/dist/risk-job.js';
import { enqueueRiskJob } from '../../risk-workers/scripts/risk-jobs.mjs';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, state, owner, reader, writer, jobs, app, auth, origin, base, input;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-risk-job-http-'); state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state));
  writer = createTransactionRevisions(dsn(state, 'intake')); jobs = createRiskJobs(dsn(state, 'intake'));
  auth = await authFixture(temporary);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
  await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  base = join(temporary, 'inputs'); await mkdir(join(base, 'v1'), { recursive: true, mode: 0o700 });
});
beforeEach(async () => {
  await owner.pool.query('TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies,platform.local_transaction_revisions');
  const f = riskJobFixture(); input = f.input; await writer.append(f.f.f.revision);
  const directory = join(base, 'v1', input.job_ref); await mkdir(directory, { mode: 0o700 }); await writeFile(join(directory, 'input.json'), JSON.stringify(input), { mode: 0o600 });
});
after(async () => {
  await app?.close(); for (const r of [jobs, writer, reader, owner]) await r?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
async function request(path, { scope = 'risk-jobs:read', workspace_key = 'synthetic_local', locale = 'en', method = 'GET', token } = {}) {
  return fetch(origin + path, { method, headers: { Authorization: 'Bearer ' + (token ?? await auth.token({ scope, workspace_key })), 'Accept-Language': locale } });
}
test('private enqueue→worker→real PG→HTTP job/attempt/risk/alert reads complete with stable bilingual references', async () => {
  assert.equal((await enqueueRiskJob(base, input.job_ref, dsn(state, 'intake'))).status, 'inserted');
  assert.equal((await enqueueRiskJob(base, input.job_ref, dsn(state, 'intake'))).status, 'duplicate');
  const result = await runRiskJob(dsn(state, 'intake'), input.job_ref); assert.equal(result.status, 'completed'); assert.equal(result.result_code, 'ALERT_CREATED');
  const path = '/v1/local/risk-jobs/' + input.job_ref;
  const en = await request(path), lo = await request(path, { locale: 'lo' }); assert.equal(en.status, 200); assert.equal(lo.headers.get('content-language'), 'lo');
  const a = await en.json(), b = await lo.json(); assert.equal(a.job.assessment_run_id, input.job_ref); assert.equal(a.job.alert_id, b.job.alert_id);
  assert.equal(a.job.status, 'completed'); assert.notEqual(a.job.status_message, b.job.status_message); assert.equal(a.job.namespace, input.risk_request.target.namespace);
  for (const data of [a, b]) for (const forbidden of ['manifest', 'observation', 'lease_token', 'lease_until', 'input_sha256', 'context', 'password']) assert.ok(!JSON.stringify(data).includes(forbidden));
  const history = await (await request(path + '/attempts')).json(); assert.equal(history.items[0].status, 'completed'); assert.equal(history.items[0].finished_stage, 'done');
  const risk = await request('/v1/local/risk-assessments/' + input.job_ref, { scope: 'risk:read' }); assert.equal(risk.status, 200); assert.equal((await risk.json()).assessment.findings.length, 15);
  const alert = await request('/v1/local/alerts/' + a.job.alert_id, { scope: 'alerts:read', locale: 'lo' }); assert.equal(alert.status, 200); assert.equal((await alert.json()).alert.alert_id, a.job.alert_id);
  assert.equal((await runRiskJob(dsn(state, 'intake'), input.job_ref)).status, 'idle');
});
test('job reads enforce an independent scope, verified workspace, no-store and deny HTTP mutations', async () => {
  await jobs.enqueue(input); const path='/v1/local/risk-jobs/' + input.job_ref;
  assert.equal((await fetch(origin + path)).status, 401);
  for (const scope of ['risk:read', 'sync:read', 'alerts:read', 'source:read']) assert.equal((await request(path, { scope })).status, 403);
  const foreign=await request(path, { workspace_key: 'synthetic_other' }); assert.equal(foreign.status, 200); assert.equal((await foreign.json()).job, null);
  const attempts=await (await request(path+'/attempts', { workspace_key: 'synthetic_other' })).json(); assert.deepEqual(attempts.items, []);
  const list=await request('/v1/local/risk-jobs'); assert.equal(list.headers.get('cache-control'), 'no-store'); assert.ok(list.headers.get('x-request-id'));
  assert.equal((await request('/v1/local/risk-assessments/'+input.job_ref)).status, 403);
  assert.equal((await request('/v1/local/risk-jobs', { method:'POST' })).status, 404);
});
test('bounded job and attempt pages reject extra, duplicated, malformed and workspace override queries with localized errors', async () => {
  for (const suffix of ['?limit=0','?limit=11','?after=bad','?limit=1&limit=2','?workspace_key=synthetic_other','/bad', '/'+input.job_ref+'?limit=1', '/'+input.job_ref+'/attempts?after=9']) {
    const response=await request('/v1/local/risk-jobs'+suffix, { locale:'lo' }); assert.equal(response.status,400,suffix); const body=await response.json(); assert.equal(body.code,'JOB_INVALID_INPUT'); assert.match(body.message,/[\u0e80-\u0eff]/);
  }
  await jobs.enqueue(input);
  assert.equal((await (await request('/v1/local/risk-jobs?limit=1')).json()).items.length,1);
  const unknown=await (await request('/v1/local/risk-jobs/'+randomUUID())).json(); assert.equal(unknown.job,null);
});
test('expired lease status and retries are visible without exposing lease ownership material', async () => {
  await jobs.enqueue(input); const c=(await jobs.claim(input.job_ref)).claim;
  await jobs.advance(c); await owner.pool.query("UPDATE platform.local_risk_jobs SET lease_until=clock_timestamp()-interval '1 second'");
  const path='/v1/local/risk-jobs/'+input.job_ref;
  assert.equal((await (await request(path)).json()).job.effective_status,'interrupted');
  assert.equal((await (await request(path+'/attempts')).json()).items[0].effective_status,'interrupted');
  assert.equal((await runRiskJob(dsn(state,'intake'),input.job_ref)).status,'completed');
  const first=await (await request(path+'/attempts?limit=1')).json(); assert.equal(first.next_cursor,'1');
  const next=await (await request(path+'/attempts?after=1&limit=1')).json(); assert.equal(next.items[0].attempt_number,2); assert.equal(next.next_cursor,null);
});
test('private file permissions and live mode fail without enqueuing or returning input diagnostics', async () => {
  const path=join(base,'v1',input.job_ref,'input.json'); await chmod(path,0o644);
  try { await assert.rejects(enqueueRiskJob(base,input.job_ref,dsn(state,'intake')), /diagnostics withheld/); } finally { await chmod(path,0o600); }
  const prior=process.env.LMPS_EXECUTION_MODE; process.env.LMPS_EXECUTION_MODE='live';
  try { await assert.rejects(enqueueRiskJob(base,input.job_ref,dsn(state,'intake')), /diagnostics withheld/); }
  finally { if (prior===undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE=prior; }
  assert.equal(await readRiskJob(reader.pool,'synthetic_local',input.job_ref),null);
});
test('storage outage is a redacted bilingual503, never an empty-success page', async () => {
  await jobs.enqueue(input); await stopCluster(state);
  try {
    for (const locale of ['lo','en']) {
      const response=await request('/v1/local/risk-jobs',{locale}); assert.equal(response.status,503);
      const body=await response.json(); assert.equal(body.code,'JOB_STORAGE_UNAVAILABLE'); assert.ok(!JSON.stringify(body).includes('postgresql'));
    }
  } finally { await startCluster(state); }
  assert.equal((await request('/v1/local/risk-jobs')).status,200);
});
test('worker records an actual immutable policy conflict as terminal without repeated assessment or alert writes', async () => {
  const risks=createTransactionRisks(dsn(state,'intake')), conflicting=structuredClone(input.risk_request);
  conflicting.run_id=randomUUID();conflicting.policy.minimum_amount='1.00';
  try { await risks.evaluate(conflicting); } finally { await risks.close(); }
  await jobs.enqueue(input);const result=await runRiskJob(dsn(state,'intake'),input.job_ref);
  assert.equal(result.status,'failed');assert.equal(result.error_code,'RISK_POLICY_CONFLICT');
  assert.equal((await jobs.claim(input.job_ref)).status,'idle');
  const saved=await (await request('/v1/local/risk-jobs/'+input.job_ref,{locale:'lo'})).json();assert.equal(saved.job.status,'failed');assert.match(saved.job.error_message,/[\u0e80-\u0eff]/);
});
