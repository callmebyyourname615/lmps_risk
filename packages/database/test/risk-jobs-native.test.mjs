import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { before, beforeEach, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRiskJobs, createDatabase, createTransactionRevisions, readRiskJob, readRiskJobAttempts, validateRiskJobInput } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { riskJobFixture } from './fixtures/risk-job.mjs';

let temporary, state, owner, reader, writer, jobs, f, input;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-risk-jobs-'); state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state));
  writer = createTransactionRevisions(dsn(state, 'intake')); jobs = createRiskJobs(dsn(state, 'intake'));
});
beforeEach(async () => {
  await owner.pool.query('TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies,platform.local_transaction_revisions');
  ({ f, input } = riskJobFixture()); await writer.append(f.f.revision);
});
after(async () => {
  for (const repo of [jobs, writer, reader, owner]) await repo?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
const count = async table => (await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;
const claim = async () => { const r = await jobs.claim(input.job_ref); assert.equal(r.status, 'claimed'); return r.claim; };
const due = async () => owner.pool.query("UPDATE platform.local_risk_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE status='retry_wait'");
const expire = async () => owner.pool.query("UPDATE platform.local_risk_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE status='running'");

test('concurrent enqueue deduplicates semantic input across job UUID aliases and refuses changed intent', async () => {
  const other = randomUUID(), alias = { ...input, job_ref: other, risk_request: { ...input.risk_request, run_id: other } };
  const results = await Promise.all([jobs.enqueue(input), jobs.enqueue(alias)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['duplicate', 'inserted']); assert.equal(results[0].job_ref, results[1].job_ref);
  assert.equal(await count('local_risk_jobs'), 1);
  const changed = structuredClone(input); changed.job_ref = results[0].job_ref; changed.risk_request.run_id = changed.job_ref; changed.alert_policy.minimum_severity = 'critical';
  await assert.rejects(jobs.enqueue(changed), e => e.code === 'JOB_INPUT_CONFLICT');
});
test('two workers claim at most once and the two stage commits produce one frozen result and one alert', async () => {
  await jobs.enqueue(input); const attempts = await Promise.all([jobs.claim(input.job_ref), jobs.claim(input.job_ref)]);
  assert.equal(attempts.filter(r => r.status === 'claimed').length, 1); const c = attempts.find(r => r.status === 'claimed').claim;
  assert.equal((await jobs.advance(c)).stage, 'alert');
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).stage, 'alert'); assert.equal(await count('local_transaction_risks'), 1);
  const done = await jobs.advance(c); assert.equal(done.stage, 'done'); assert.equal(done.result_code, 'ALERT_CREATED');
  assert.equal(await count('local_alerts'), 1); assert.equal((await jobs.claim(input.job_ref)).status, 'idle');
  await assert.rejects(jobs.advance(c), e => e.code === 'JOB_STALE_LEASE');
  const history = await readRiskJobAttempts(reader.pool, 'synthetic_local', input.job_ref); assert.equal(history.items[0].status, 'completed');
});
test('enqueue freezes a missing observation even if that explicit revision appears before execution', async () => {
  await owner.pool.query('TRUNCATE platform.local_transaction_revisions'); await jobs.enqueue(input); await writer.append(f.f.revision);
  const c = await claim(), assessed = await jobs.advance(c); assert.equal(assessed.assessment_status, 'unavailable');
  const done = await jobs.advance(c); assert.equal(done.result_code, 'ALERT_ASSESSMENT_INELIGIBLE'); assert.equal(done.alert_id, null);
  const row = (await reader.pool.query('SELECT snapshot FROM platform.local_transaction_risks')).rows[0]; assert.equal(row.snapshot.result.fraud_score.value, null);
});
test('policy no-match is a completed job, not a failed or safe transaction', async () => {
  input.alert_policy.minimum_severity = 'critical'; await jobs.enqueue(input); const c = await claim(); await jobs.advance(c);
  assert.equal((await jobs.advance(c)).result_code, 'ALERT_NO_MATCH'); assert.equal(await count('local_alerts'), 0);
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).status, 'completed');
});
test('transient alert failure rolls back the alert checkpoint then retries from the saved assessment', async () => {
  await jobs.enqueue(input); const c = await claim(); await jobs.advance(c);
  const snapshot = (await reader.pool.query('SELECT snapshot FROM platform.local_transaction_risks')).rows[0].snapshot;
  await owner.pool.query("CREATE FUNCTION platform.synthetic_job_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_VALUE'; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_job_fail BEFORE INSERT ON platform.local_alerts FOR EACH ROW EXECUTE FUNCTION platform.synthetic_job_fail()');
  try { await assert.rejects(jobs.advance(c), e => e.code === 'JOB_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE')); }
  finally { await owner.pool.query('DROP TRIGGER synthetic_job_fail ON platform.local_alerts'); await owner.pool.query('DROP FUNCTION platform.synthetic_job_fail()'); }
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).stage, 'alert'); assert.equal(await count('local_alert_policies'), 0);
  assert.equal((await jobs.fail(c, 'JOB_STORAGE_UNAVAILABLE')).status, 'retry_wait'); assert.equal((await jobs.claim(input.job_ref)).status, 'idle');
  await due(); const retry = await claim(); assert.equal(retry.attempt_number, 2); assert.equal((await jobs.advance(retry)).stage, 'done');
  assert.deepEqual((await reader.pool.query('SELECT snapshot FROM platform.local_transaction_risks')).rows[0].snapshot, snapshot);
  assert.equal(await count('local_transaction_risks'), 1); assert.equal(await count('local_alerts'), 1);
});
test('a checkpoint write failure rolls back its assessment, and expiry during a stage rolls back its financial evidence', async () => {
  await jobs.enqueue(input); const c = await claim();
  await owner.pool.query("CREATE FUNCTION platform.synthetic_checkpoint_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage<>OLD.stage THEN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_VALUE'; END IF; RETURN NEW; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_checkpoint_fail BEFORE UPDATE ON platform.local_risk_jobs FOR EACH ROW EXECUTE FUNCTION platform.synthetic_checkpoint_fail()');
  try { await assert.rejects(jobs.advance(c), e => e.code === 'JOB_STORAGE_UNAVAILABLE'); }
  finally { await owner.pool.query('DROP TRIGGER synthetic_checkpoint_fail ON platform.local_risk_jobs'); await owner.pool.query('DROP FUNCTION platform.synthetic_checkpoint_fail()'); }
  assert.equal(await count('local_transaction_risks'), 0); assert.equal(await count('local_risk_policies'), 0);
  await owner.pool.query("UPDATE platform.local_risk_jobs SET lease_until=clock_timestamp()+interval '250 milliseconds'");
  await owner.pool.query("CREATE FUNCTION platform.synthetic_job_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_job_delay BEFORE INSERT ON platform.local_transaction_risks FOR EACH ROW EXECUTE FUNCTION platform.synthetic_job_delay()');
  try { await assert.rejects(jobs.advance(c), e => e.code === 'JOB_STALE_LEASE'); }
  finally { await owner.pool.query('DROP TRIGGER synthetic_job_delay ON platform.local_transaction_risks'); await owner.pool.query('DROP FUNCTION platform.synthetic_job_delay()'); }
  assert.equal(await count('local_transaction_risks'), 0);
});
test('expired attempts cannot write or finish after a replacement takes the lease', async () => {
  await jobs.enqueue(input); const old = await claim(); await expire();
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).effective_status, 'interrupted');
  const current = await claim(); assert.equal(current.attempt_number, 2);
  await assert.rejects(jobs.advance(old), e => e.code === 'JOB_STALE_LEASE'); await assert.rejects(jobs.fail(old, 'JOB_STORAGE_UNAVAILABLE'), e => e.code === 'JOB_STALE_LEASE');
  await jobs.advance(current); await jobs.advance(current);
  const history = await readRiskJobAttempts(reader.pool, 'synthetic_local', input.job_ref); assert.deepEqual(history.items.map(r => r.status), ['interrupted', 'completed']);
});
test('actual process kill after assessment commit recovers at alert stage and cannot duplicate effects', async () => {
  await jobs.enqueue(input);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { createRiskJobs } from './packages/database/dist/index.js'; const j=createRiskJobs(process.env.LMPS_TEST_JOB_DSN); const c=await j.claim(process.env.LMPS_TEST_JOB_REF); await j.advance(c.claim); process.send('checkpoint'); setInterval(()=>{},1000);`],
    { cwd: new URL('../../../', import.meta.url), env: { ...process.env, LMPS_TEST_JOB_DSN: dsn(state, 'intake'), LMPS_TEST_JOB_REF: input.job_ref }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(child, 'exit');
  try {
    await Promise.race([once(child, 'message'), exited.then(() => { throw new Error('Synthetic child exited before checkpoint'); }), new Promise((_, reject) => { const t=setTimeout(() => reject(new Error('Synthetic child checkpoint timeout')), 10000); t.unref(); })]);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).stage, 'alert'); await expire();
  const retry = await claim(); assert.equal((await jobs.advance(retry)).stage, 'done'); assert.equal(await count('local_transaction_risks'), 1); assert.equal(await count('local_alerts'), 1);
});
test('retry cap cannot be bypassed by a normal claim', async () => {
  await jobs.enqueue(input);
  for (let n = 1; n <= 8; n++) {
    const c = await claim(); const r = await jobs.fail(c, 'JOB_STORAGE_UNAVAILABLE'); assert.equal(r.status, n < 8 ? 'retry_wait' : 'failed'); if (n < 8) await due();
  }
  assert.equal((await jobs.claim(input.job_ref)).status, 'idle'); assert.equal(await count('local_risk_job_attempts'), 8);
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).status, 'failed');
});
test('the eighth expired lease is finalized without blocking another queued job', async () => {
  await jobs.enqueue(input);
  for (let n=1;n<=8;n++) { assert.equal((await claim()).attempt_number,n); await expire(); }
  const result=await jobs.claim(input.job_ref); assert.equal(result.status,'exhausted');
  assert.equal((await readRiskJob(reader.pool,'synthetic_local',input.job_ref)).status,'failed');
  const other=riskJobFixture().input; other.risk_request.target.transaction_id='synthetic_other_job'; other.risk_request.context=null; await jobs.enqueue(other);
  assert.equal((await jobs.claim()).status,'claimed');
});
test('corrupt frozen job evidence fails closed; database outage preserves a recoverable lease', async () => {
  await jobs.enqueue(input); const c = await claim(); await owner.pool.query("UPDATE platform.local_risk_jobs SET observation_sha256=$1", ['0'.repeat(64)]);
  await assert.rejects(jobs.advance(c), e => e.code === 'JOB_STORAGE_UNAVAILABLE'); assert.equal(await count('local_transaction_risks'), 0);
  await stopCluster(state); try { await assert.rejects(jobs.claim(), e => e.code === 'JOB_STORAGE_UNAVAILABLE'); } finally { await startCluster(state); }
  assert.equal((await readRiskJob(reader.pool, 'synthetic_local', input.job_ref)).status, 'running');
});
test('reader/reviewer/outbox cannot mutate jobs and intake cannot rewrite frozen input or recording identity', async () => {
  await jobs.enqueue(input);
  for (const role of ['app', 'reviewer', 'outbox']) {
    const db = createDatabase(dsn(state, role), role);
    try { for (const table of ['local_risk_jobs', 'local_risk_job_attempts']) for (const sql of [`DELETE FROM platform.${table}`, `TRUNCATE platform.${table}`, `UPDATE platform.${table} SET status='failed'`]) await assert.rejects(db.pool.query(sql), e => e.code === '42501'); }
    finally { await db.close(); }
  }
  const intake = createDatabase(dsn(state, 'intake'), 'intake');
  try { await assert.rejects(intake.pool.query("UPDATE platform.local_risk_jobs SET manifest='{}'"), e => e.code === '42501'); await assert.rejects(intake.pool.query('DELETE FROM platform.local_risk_job_attempts'), e => e.code === '42501'); }
  finally { await intake.close(); }
});
test('malformed/live manifests, mismatched run IDs and private input fields are rejected before work', async () => {
  for (const change of [x=>x.execution_mode='live', x=>x.workspace_key='synthetic_other', x=>x.job_ref='bad', x=>x.risk_request.run_id=randomUUID(), x=>x.extra=true]) {
    const bad=structuredClone(input); change(bad); assert.throws(()=>validateRiskJobInput(bad), e=>e.code==='JOB_INVALID_INPUT');
  }
  assert.equal(await count('local_risk_jobs'), 0);
});
