import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createSourceIntake, createSyncJobs, SyncJobError } from '@lmps/database';
import { snapshotIdentity, runSyncJob } from '../dist/sync-job.js';
import { reconcileSnapshot } from '../dist/reconcile.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';

let temporary, state, owner, reader, jobs, intake;
const fixture = JSON.parse(await readFile(new URL('../../../packages/database/fixtures/source-event.json', import.meta.url), 'utf8'));
function snapshot(count = 2) {
  const capture_id = randomUUID(); const generation = randomUUID();
  return { format: 1, capture_id, events: Array.from({ length: count }, (_, i) => ({ ...structuredClone(fixture), source_namespace: 'synthetic_snapshot',
    source_generation: generation, capture_epoch: capture_id, event_key: 'transfer:' + (i + 1), source_key: { ...fixture.source_key, id: String(i + 1) } })) };
}
const run = value => runSyncJob(value, dsn(state, 'intake'), dsn(state));
const rows = async value => (await reader.pool.query(`SELECT j.status,j.total,a.* FROM platform.local_sync_jobs j JOIN platform.local_sync_attempts a USING(workspace_key,job_ref)
  WHERE j.capture_id=$1 ORDER BY a.attempt_number`, [value.capture_id])).rows;
const count = async value => (await reader.pool.query('SELECT count(*)::int AS n FROM platform.source_events WHERE capture_epoch=$1', [value.capture_id])).rows[0].n;
async function claim(value) { const id = snapshotIdentity(value); await jobs.register(id); const result = await jobs.claim(id); assert.equal(result.status, 'claimed'); return result.claim; }
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-sync-job-'); state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state)); jobs = createSyncJobs(dsn(state, 'intake')); intake = createSourceIntake(dsn(state, 'intake'));
});
after(async () => {
  await jobs?.close(); await intake?.close(); await reader?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('canonical identity preserves object-key order independence and rejects changed capture evidence before writes', async () => {
  const value = snapshot(); const reordered = JSON.parse(JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.deepEqual(snapshotIdentity(value), snapshotIdentity(reordered));
  await jobs.register(snapshotIdentity(value)); const changed = structuredClone(value); changed.events[0].fields.amount = '999.00';
  await assert.rejects(run(changed), error => error instanceof SyncJobError && error.code === 'SNAPSHOT_CONFLICT');
  assert.equal(await count(value), 0); assert.equal((await rows(value)).length, 0);
  await assert.rejects(run({ ...value, payload: 'SYNTHETIC_PRIVATE_VALUE' }), error => !error.message.includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('tracked import persists counts, separate imported/reconciled phases and version2 audit; replay is unchanged', async () => {
  const value = snapshot(); const result = await run(value); assert.equal(result.status, 'reconciled');
  const attempts = await rows(value); assert.equal(attempts.length, 1);
  assert.equal(attempts[0].processed, 2); assert.equal(attempts[0].inserted, 2); assert.equal(attempts[0].duplicate, 0);
  assert.equal(attempts[0].import_completed, true); assert.equal(attempts[0].reconciliation_status, 'PASS');
  const audit = (await reader.pool.query('SELECT * FROM platform.audit_events WHERE target_ref=$1 ORDER BY audit_id', [result.job_ref])).rows;
  assert.deepEqual(audit.map(row => row.job_status), ['pending', 'running', 'imported', 'reconciled', 'reconciled']);
  for (const row of audit) { assert.equal(row.schema_version, 2); assert.equal(row.actor_role, 'lmps_intake'); assert.equal(row.actor_type, 'service'); assert.equal(row.target_type, 'local_sync_job'); assert.equal(row.capture_id, value.capture_id); assert.equal(row.correlation_id, result.job_ref); }
  assert.equal((await run(value)).status, 'already_reconciled'); assert.equal((await rows(value)).length, 1); assert.equal(await count(value), 2);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.audit_events WHERE target_ref=$1', [result.job_ref])).rows[0].n, 5);
});

test('concurrent invocations have one active owner and one committed attempt', async () => {
  const value = snapshot(30); const results = await Promise.all(Array.from({ length: 4 }, () => run(value)));
  assert.equal(results.filter(row => row.status === 'reconciled').length, 1);
  assert.ok(results.every(row => ['reconciled', 'busy', 'already_reconciled'].includes(row.status)));
  assert.equal((await rows(value)).length, 1); assert.equal(await count(value), 30);
});

test('SIGKILL after an event commit preserves its atomic checkpoint; reclaim replays safely and fences the old owner', async () => {
  const value = snapshot(); let child, timer;
  const script = `import {createSyncJobs} from ${JSON.stringify(new URL('../../../packages/database/dist/index.js', import.meta.url).href)};
    process.once('message',async data=>{try{const jobs=createSyncJobs(data.dsn);await jobs.register(data.identity);const result=await jobs.claim(data.identity);await jobs.append(result.claim,data.event,0);process.send({ready:true,claim:result.claim});}catch{process.send({ready:false});}});`;
  let oldClaim;
  try {
    child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const ready = once(child, 'message'); const exit = once(child, 'exit');
    child.send({ dsn: dsn(state, 'intake'), identity: snapshotIdentity(value), event: value.events[0] });
    const [message] = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Child checkpoint timeout.')), 5000); })]);
    assert.equal(message.ready, true); oldClaim = message.claim; child.kill('SIGKILL'); await exit;
  } finally { clearTimeout(timer); if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } }
  assert.equal(await count(value), 1); assert.equal((await rows(value))[0].processed, 1);
  await owner.pool.query("UPDATE platform.local_sync_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE capture_id=$1", [value.capture_id]);
  assert.equal((await run(value)).status, 'reconciled');
  const attempts = await rows(value); assert.equal(attempts.length, 2); assert.equal(attempts[0].status, 'interrupted'); assert.equal(attempts[0].error_code, 'LEASE_EXPIRED');
  assert.equal(attempts[0].processed, 1); assert.equal(attempts[1].processed, 2); assert.equal(attempts[1].duplicate, 1); assert.equal(attempts[1].inserted, 1);
  await assert.rejects(jobs.append(oldClaim, value.events[1], 1), error => error.code === 'STALE_LEASE');
  await assert.rejects(jobs.finish(oldClaim, 'PASS'), error => error.code === 'STALE_LEASE'); assert.equal(await count(value), 2);
});

test('a blocked event write rolls back new source identity and progress together; subsequent retry succeeds', async () => {
  const value = snapshot(1); const held = await claim(value); const client = await owner.pool.connect();
  try {
    await client.query('BEGIN'); await client.query('LOCK TABLE platform.source_events IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(jobs.append(held, value.events[0], 0), error => error.code === 'STORAGE_FAILED');
  } finally { await client.query('ROLLBACK'); client.release(); }
  assert.equal(await count(value), 0); assert.equal((await rows(value))[0].processed, 0);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.source_records WHERE source_generation=$1', [value.events[0].source_generation])).rows[0].n, 0);
  await jobs.append(held, value.events[0], 0); await jobs.imported(held);
  assert.equal((await reconcileSnapshot(value, dsn(state))).status, 'PASS'); await jobs.finish(held, 'PASS');
});

test('audit failure prevents unaudited phase completion; progress alone cannot imply reconciliation', async () => {
  const value = snapshot(1); const held = await claim(value); await jobs.append(held, value.events[0], 0);
  await assert.rejects(jobs.finish(held, 'PASS'), error => error.code === 'INVALID_JOB');
  const client = await owner.pool.connect();
  try {
    await client.query('BEGIN'); await client.query('LOCK TABLE platform.audit_events IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(jobs.imported(held), error => error.code === 'STORAGE_FAILED');
  } finally { await client.query('ROLLBACK'); client.release(); }
  assert.equal((await rows(value))[0].import_completed, false);
  assert.equal((await reader.pool.query('SELECT status FROM platform.local_sync_jobs WHERE capture_id=$1', [value.capture_id])).rows[0].status, 'running');
  await jobs.imported(held); assert.equal((await reconcileSnapshot(value, dsn(state))).status, 'PASS'); await jobs.finish(held, 'PASS');
});

test('source evidence conflict is preserved as needs_review and never overwritten', async () => {
  const value = snapshot(); await intake.append({ ...value.events[0], fields: { ...value.events[0].fields, amount: '999.00' } });
  const result = await run(value); assert.equal(result.status, 'needs_review');
  const attempt = (await rows(value))[0]; assert.equal(attempt.error_code, 'EVENT_CONFLICT'); assert.equal(attempt.processed, 0); assert.equal(attempt.import_completed, false);
  assert.equal((await reader.pool.query('SELECT fields FROM platform.source_events WHERE capture_epoch=$1', [value.capture_id])).rows[0].fields.amount, '999.00');
});

test('reconciliation FAIL and UNAVAILABLE stay separate from success and retained attempts survive a later retry', async () => {
  const value = snapshot(); await intake.append({ ...value.events[0], event_key: 'extra' });
  assert.equal((await run(value)).status, 'needs_review'); assert.equal((await rows(value))[0].reconciliation_status, 'FAIL');
  await owner.pool.query("DELETE FROM platform.source_events WHERE capture_epoch=$1 AND event_key='extra'", [value.capture_id]);
  assert.equal((await run(value)).status, 'reconciled'); assert.equal((await rows(value))[0].status, 'needs_review');
  const unavailable = snapshot(); const port = await availablePort();
  const result = await runSyncJob(unavailable, dsn(state, 'intake'), dsn(state).replace(':' + state.port + '/', ':' + port + '/'));
  assert.equal(result.status, 'failed'); const prior = (await rows(unavailable))[0];
  assert.equal(prior.import_completed, true); assert.equal(prior.reconciliation_status, 'UNAVAILABLE'); assert.equal(prior.error_code, 'RECONCILE_UNAVAILABLE');
  assert.equal((await run(unavailable)).status, 'reconciled'); assert.equal((await rows(unavailable))[1].duplicate, 2);
});

test('job boundaries and database grants protect frozen metadata, audit and generated fields', async () => {
  const writer = createDatabase(dsn(state, 'intake'), 'intake');
  try {
    for (const sql of ["UPDATE platform.local_sync_jobs SET snapshot_sha256=repeat('a',64)", 'UPDATE platform.local_sync_jobs SET total=0', 'UPDATE platform.local_sync_jobs SET capture_id=gen_random_uuid()', 'DELETE FROM platform.local_sync_jobs', 'TRUNCATE platform.local_sync_attempts', 'INSERT INTO platform.local_sync_jobs(job_id) OVERRIDING SYSTEM VALUE VALUES (1)', 'INSERT INTO platform.audit_events DEFAULT VALUES', 'SELECT platform.record_local_sync_audit()']) await assert.rejects(writer.pool.query(sql), error => error.code === '42501');
    await assert.rejects(reader.pool.query("UPDATE platform.local_sync_jobs SET status='failed'"), error => error.code === '42501');
    const value = snapshotIdentity(snapshot());
    for (const change of [{ total: 401 }, { workspace_key: 'real_bank' }, { snapshot_sha256: 'SYNTHETIC_PRIVATE_VALUE' }, { payload: 'SYNTHETIC_PRIVATE_VALUE' }]) await assert.rejects(jobs.register({ ...value, ...change }), error => error.code === 'INVALID_JOB' && !error.message.includes('SYNTHETIC_PRIVATE_VALUE'));
    const limited = snapshot(); const ref = await jobs.register(snapshotIdentity(limited)); await owner.pool.query('UPDATE platform.local_sync_jobs SET attempt_number=32 WHERE job_ref=$1', [ref]);
    await assert.rejects(jobs.claim(snapshotIdentity(limited)), error => error.code === 'ATTEMPT_LIMIT');
  } finally { await writer.close(); }
});

test('target outage reports unknown rather than success and rejects production before opening a pool', async () => {
  const value = snapshot(); await stopCluster(state);
  try { const report = await run(value); assert.equal(report.status, 'unavailable'); assert.equal(report.job_ref, null); }
  finally { await startCluster(state); }
  assert.equal((await run(value)).status, 'reconciled');
  const previous = process.env.LMPS_EXECUTION_MODE;
  try { process.env.LMPS_EXECUTION_MODE = 'live'; assert.throws(() => createSyncJobs(dsn(state, 'intake')), error => error.code === 'INVALID_JOB'); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
});


test('lease loss after an event is staged rolls back both its source write and checkpoint before commit', async () => {
  const value = snapshot(1); const held = await claim(value);
  await owner.pool.query(`CREATE FUNCTION platform.synthetic_expire_job() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE platform.local_sync_jobs SET lease_until=clock_timestamp()-interval '1 second'
      WHERE workspace_key=NEW.workspace_key AND capture_id::text=NEW.capture_epoch;
      RETURN NEW;
    END; $$`);
  await owner.pool.query('CREATE TRIGGER synthetic_expire_job BEFORE INSERT ON platform.source_events FOR EACH ROW EXECUTE FUNCTION platform.synthetic_expire_job()');
  try { await assert.rejects(jobs.append(held, value.events[0], 0), error => error.code === 'STALE_LEASE'); }
  finally { await owner.pool.query('DROP TRIGGER synthetic_expire_job ON platform.source_events'); await owner.pool.query('DROP FUNCTION platform.synthetic_expire_job()'); }
  assert.equal(await count(value), 0); assert.equal((await rows(value))[0].processed, 0);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.source_records WHERE source_generation=$1', [value.events[0].source_generation])).rows[0].n, 0);
  await jobs.append(held, value.events[0], 0); await jobs.imported(held); await jobs.finish(held, (await reconcileSnapshot(value, dsn(state))).status);
});
