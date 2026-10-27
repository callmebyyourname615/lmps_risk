import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDatabase,
  createRiskPolicies,
  readRiskPolicy,
  compareStoredRiskPolicies,
  createTransactionRevisions,
  createTransactionRisks,
  createRiskJobs,
} from '../dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { createBackup, restoreDrill } from '../scripts/backup.mjs';
import { riskJobFixture } from './fixtures/risk-job.mjs';
import { riskHash } from '@lmps/risk';

let temp, state, owner, reader, policies, jobs, writer, risks, f, input;
const maker = 'synthetic_maker',
  checker = 'synthetic_checker',
  ws = 'synthetic_local';
const command = (action, extra = {}) => ({
  action,
  request_id: randomUUID(),
  note: 'Synthetic evidence for policy test',
  ...extra,
});
const ref = (policy) => ({ policy_id: policy.policy_id, policy_version: policy.version });
const apply = (actor, body) => policies.command(ws, actor, body);
async function approve(policy) {
  await apply(maker, command('create', { policy }));
  await apply(maker, command('submit', { ...ref(policy), expected_revision: 0 }));
  await apply(checker, command('approve', { ...ref(policy), expected_revision: 1 }));
}
const binding = (policy, generation, action = 'activate') =>
  command(action, {
    ...ref(policy),
    expected_generation: generation,
    namespace: input.risk_request.target.namespace,
    currency: policy.currency,
  });
const count = async (table) => (await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;
before(async () => {
  temp = await mkdtemp('/tmp/lmps-policy-native-');
  state = await initializeCluster(join(temp, 'pg'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration');
  reader = createDatabase(dsn(state));
  policies = createRiskPolicies(dsn(state, 'policy'));
  jobs = createRiskJobs(dsn(state, 'intake'));
  writer = createTransactionRevisions(dsn(state, 'intake'));
  risks = createTransactionRisks(dsn(state, 'intake'));
});
beforeEach(async () => {
  await owner.pool.query(
    'TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_policy_events,platform.local_risk_policy_bindings,platform.local_risk_policy_versions,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies,platform.local_transaction_revisions',
  );
  ({ f, input } = riskJobFixture());
  await writer.append(f.f.revision);
});
after(async () => {
  for (const r of [jobs, policies, risks, writer, reader, owner]) await r?.close();
  if (temp && !state) {
    try {
      state = await loadState(join(temp, 'pg'));
    } catch {}
  }
  if (state) await stopCluster(state);
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('native lifecycle stores immutable policy, denies self-approval and terminal edits, and records each exact retry once', async () => {
  const policy = input.risk_request.policy,
    create = command('create', { policy });
  const made = await apply(maker, create);
  assert.equal(made.result.revision, 0);
  assert.equal((await apply(maker, create)).status, 'duplicate');
  await assert.rejects(apply(checker, create), (e) => e.code === 'POLICY_CONFLICT');
  const submission = command('submit', { ...ref(policy), expected_revision: 0 });
  await apply(maker, submission);
  await assert.rejects(
    apply(maker, command('approve', { ...ref(policy), expected_revision: 1 })),
    (e) => e.code === 'POLICY_SELF_APPROVAL',
  );
  await apply(checker, command('approve', { ...ref(policy), expected_revision: 1 }));
  const stored = await readRiskPolicy(reader.pool, ws, ref(policy));
  assert.equal(stored.state, 'approved');
  assert.equal(stored.approved_by, checker);
  assert.equal(await count('local_risk_policy_events'), 3);
  assert.deepEqual((await apply(maker, create)).result, made.result);
  assert.equal(await readRiskPolicy(reader.pool, 'synthetic_other', ref(policy)), null);
  await assert.rejects(
    apply(maker, command('submit', { ...ref(policy), expected_revision: 2 })),
    (e) => e.code === 'POLICY_INVALID_TRANSITION',
  );
});
test('concurrent approvals and activation CAS allow one winner; rejected versions cannot activate', async () => {
  const policy = input.risk_request.policy;
  await apply(maker, command('create', { policy }));
  await apply(maker, command('submit', { ...ref(policy), expected_revision: 0 }));
  const outcomes = await Promise.allSettled([
    apply(checker, command('approve', { ...ref(policy), expected_revision: 1 })),
    apply('synthetic_checker2', command('approve', { ...ref(policy), expected_revision: 1 })),
  ]);
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((x) => x.status === 'rejected').reason.code, 'POLICY_CONFLICT');
  const active = await Promise.allSettled([apply(checker, binding(policy, 0)), apply(checker, binding(policy, 0))]);
  assert.equal(active.filter((x) => x.status === 'fulfilled').length, 1);
  const second = { ...policy, version: 'synthetic_rejected' };
  await apply(maker, command('create', { policy: second }));
  await apply(maker, command('submit', { ...ref(second), expected_revision: 0 }));
  await apply(checker, command('reject', { ...ref(second), expected_revision: 1 }));
  await assert.rejects(apply(checker, binding(second, 1)), (e) => e.code === 'POLICY_NOT_APPROVED');
});
test('approved enqueue pins first binding across activation/rollback, restarts and exact retries', async () => {
  const first = input.risk_request.policy,
    second = structuredClone(first);
  second.version = 'synthetic_v2';
  second.rules.forEach((r) => (r.enabled = false));
  await approve(first);
  await approve(second);
  await apply(checker, binding(first, 0));
  const manifest = structuredClone(input);
  manifest.risk_request.policy = null;
  const selection = {
    ...ref(first),
    namespace: manifest.risk_request.target.namespace,
    currency: first.currency,
    expected_generation: 1,
  };
  const saved = await jobs.enqueueApproved(manifest, selection);
  assert.equal(saved.status, 'inserted');
  assert.equal(
    saved.policy_binding.policy_sha256,
    riskHash((await readRiskPolicy(reader.pool, ws, ref(first))).policy),
  );
  await apply(checker, binding(second, 1));
  assert.equal((await jobs.enqueueApproved(manifest, selection)).status, 'duplicate');
  const other = structuredClone(manifest);
  other.job_ref = other.risk_request.run_id = randomUUID();
  await assert.rejects(jobs.enqueueApproved(other, selection), (e) => e.code === 'POLICY_CONFLICT');
  const c = await jobs.claim(input.job_ref);
  await jobs.advance(c.claim);
  await jobs.advance(c.claim);
  const snapshot = (
    await reader.pool.query('SELECT snapshot FROM platform.local_transaction_risks WHERE run_id=$1', [input.job_ref])
  ).rows[0].snapshot;
  assert.equal(snapshot.result.policy.version, first.version);
  const rolled = await apply(checker, binding(first, 2, 'rollback'));
  assert.equal(rolled.result.generation, 3);
  const restarted = createRiskJobs(dsn(state, 'intake'));
  try {
    assert.equal((await restarted.enqueueApproved(manifest, selection)).status, 'duplicate');
  } finally {
    await restarted.close();
  }
  assert.equal(await count('local_risk_job_policy_bindings'), 1);
});
test('rollback requires previous binding and approval; explicit raw jobs keep legacy behavior', async () => {
  const policy = input.risk_request.policy;
  await approve(policy);
  await assert.rejects(apply(checker, binding(policy, 0, 'rollback')), (e) => e.code === 'POLICY_INVALID_TRANSITION');
  await jobs.enqueue(input);
  const job = (await reader.pool.query('SELECT manifest FROM platform.local_risk_jobs')).rows[0];
  assert.equal(job.manifest.risk_request.policy.version, policy.version);
  assert.equal(await count('local_risk_job_policy_bindings'), 0);
});
test('comparison replays stored frozen inputs without any database writes or Alert effects, and rejects corruption', async () => {
  const policy = input.risk_request.policy,
    other = structuredClone(policy);
  other.version = 'synthetic_v2';
  other.rules.forEach((r) => (r.enabled = false));
  await approve(policy);
  await apply(maker, command('create', { policy: other }));
  await risks.evaluate(input.risk_request);
  const before = await count('local_risk_policy_events'),
    report = await compareStoredRiskPolicies(reader.pool, ws, ref(policy), ref(other), [input.job_ref]);
  assert.equal(report.summary.changed_runs, 1);
  assert.equal(report.rows[0].after.fraud_score.value, null);
  assert.deepEqual(report, await compareStoredRiskPolicies(reader.pool, ws, ref(policy), ref(other), [input.job_ref]));
  assert.equal(await count('local_transaction_risks'), 1);
  assert.equal(await count('local_alerts'), 0);
  assert.equal(await count('local_risk_policy_events'), before);
  await assert.rejects(
    compareStoredRiskPolicies(reader.pool, 'synthetic_other', ref(policy), ref(other), [input.job_ref]),
    (e) => e.code === 'POLICY_NOT_FOUND',
  );
  await owner.pool.query('UPDATE platform.local_transaction_risks SET snapshot_sha256=$1', ['0'.repeat(64)]);
  await assert.rejects(
    compareStoredRiskPolicies(reader.pool, ws, ref(policy), ref(other), [input.job_ref]),
    (e) => e.code === 'POLICY_STORAGE_UNAVAILABLE',
  );
});
test('policy and receipt rows are read-only to app/intake/reviewer; only isolated policy credential executes governance', async () => {
  for (const role of ['app', 'intake', 'reviewer', 'outbox', 'policy']) {
    const db = createDatabase(dsn(state, role), role);
    try {
      for (const table of [
        'local_risk_policy_versions',
        'local_risk_policy_bindings',
        'local_risk_policy_events',
        'local_risk_job_policy_bindings',
      ])
        for (const action of ['DELETE FROM', 'TRUNCATE'])
          await assert.rejects(db.pool.query(`${action} platform.${table}`), (e) => e.code === '42501');
      if (role !== 'policy')
        await assert.rejects(
          db.pool.query("SELECT platform.command_local_risk_policy('synthetic_local','synthetic_maker','{}',NULL)"),
          (e) => e.code === '42501',
        );
      await assert.rejects(
        db.pool.query("UPDATE platform.local_risk_policy_versions SET state='approved'"),
        (e) => e.code === '42501',
      );
    } finally {
      await db.close();
    }
  }
});
test('audit insertion failure rolls back lifecycle and duplicate request bodies cannot change intent', async () => {
  const policy = input.risk_request.policy,
    create = command('create', { policy });
  await owner.pool.query(
    "CREATE FUNCTION platform.synthetic_policy_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_DIAGNOSTIC'; END $$",
  );
  await owner.pool.query(
    'CREATE TRIGGER synthetic_policy_fail BEFORE INSERT ON platform.local_risk_policy_events FOR EACH ROW EXECUTE FUNCTION platform.synthetic_policy_fail()',
  );
  try {
    await assert.rejects(
      apply(maker, create),
      (e) => e.code === 'POLICY_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE'),
    );
  } finally {
    await owner.pool.query('DROP TRIGGER synthetic_policy_fail ON platform.local_risk_policy_events');
    await owner.pool.query('DROP FUNCTION platform.synthetic_policy_fail()');
  }
  assert.equal(await count('local_risk_policy_versions'), 0);
  await apply(maker, create);
  await assert.rejects(apply(maker, { ...create, note: 'Changed intent' }), (e) => e.code === 'POLICY_CONFLICT');
});
test('new governance evidence and pending approved job survive isolated backup/restore with permissions intact', async () => {
  const policy = input.risk_request.policy;
  await approve(policy);
  await apply(checker, binding(policy, 0));
  const manifest = structuredClone(input);
  manifest.risk_request.policy = null;
  await jobs.enqueueApproved(manifest, {
    ...ref(policy),
    namespace: manifest.risk_request.target.namespace,
    currency: policy.currency,
    expected_generation: 1,
  });
  const backup = await createBackup(state, join(temp, 'policy-backups'));
  const restored = await restoreDrill(backup.directory);
  assert.equal(restored.status, 'PASS');
  assert.equal(restored.table_counts['platform.local_risk_policy_versions'], 1);
  assert.equal(restored.table_counts['platform.local_risk_policy_events'], 4);
  assert.equal(restored.table_counts['platform.local_risk_job_policy_bindings'], 1);
  assert.equal(restored.workers_started, false);
});
