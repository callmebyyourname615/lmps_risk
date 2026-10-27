import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createRiskPolicies, createTransactionRevisions } from '@lmps/database';
import {
  availablePort,
  dsn,
  initializeCluster,
  startCluster,
  stopCluster,
  loadState,
} from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { riskJobFixture } from '../../../packages/database/test/fixtures/risk-job.mjs';
import { enqueueRiskJob } from '../scripts/risk-jobs.mjs';
import { savePrivateReport } from '../scripts/private-json.mjs';
import { runRiskJob } from '../dist/risk-job.js';

let temp, state, policies, writer, reader, input, selection, base;
before(async () => {
  temp = await mkdtemp('/tmp/lmps-policy-worker-');
  state = await initializeCluster(join(temp, 'pg'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  policies = createRiskPolicies(dsn(state, 'policy'));
  writer = createTransactionRevisions(dsn(state, 'intake'));
  reader = createDatabase(dsn(state));
  const f = riskJobFixture();
  input = f.input;
  await writer.append(f.f.f.revision);
  const policy = input.risk_request.policy,
    ref = { policy_id: policy.policy_id, policy_version: policy.version };
  const cmd = (action, more = {}) => ({ action, request_id: randomUUID(), note: 'Synthetic worker policy', ...more });
  await policies.command('synthetic_local', 'synthetic_maker', cmd('create', { policy }));
  await policies.command('synthetic_local', 'synthetic_maker', cmd('submit', { ...ref, expected_revision: 0 }));
  await policies.command('synthetic_local', 'synthetic_checker', cmd('approve', { ...ref, expected_revision: 1 }));
  await policies.command(
    'synthetic_local',
    'synthetic_checker',
    cmd('activate', {
      ...ref,
      namespace: input.risk_request.target.namespace,
      currency: policy.currency,
      expected_generation: 0,
    }),
  );
  selection = {
    ...ref,
    namespace: input.risk_request.target.namespace,
    currency: policy.currency,
    expected_generation: 1,
  };
  input.risk_request.policy = null;
  base = join(temp, 'inputs');
});
after(async () => {
  for (const r of [policies, writer, reader]) await r?.close();
  if (temp && !state) {
    try {
      state = await loadState(join(temp, 'pg'));
    } catch {}
  }
  if (state) await stopCluster(state);
  if (temp) await rm(temp, { recursive: true, force: true });
});
test('private approved-policy manifest enqueues, retries, and executes the existing frozen assessment→alert worker', async () => {
  await savePrivateReport(base, 'v1', input.job_ref, 'input.json', { job: input, selection }, 512 * 1024);
  const saved = await enqueueRiskJob(base, input.job_ref, dsn(state, 'intake'), true);
  assert.equal(saved.status, 'inserted');
  assert.equal((await enqueueRiskJob(base, input.job_ref, dsn(state, 'intake'), true)).status, 'duplicate');
  assert.equal((await runRiskJob(dsn(state, 'intake'), saved.job_ref)).status, 'completed');
  const snapshot = (
    await reader.pool.query('SELECT snapshot FROM platform.local_transaction_risks WHERE run_id=$1', [saved.job_ref])
  ).rows[0].snapshot;
  assert.equal(snapshot.request.policy.version, selection.policy_version);
  assert.equal(snapshot.result.enforcement, false);
});
test('approved enqueue rejects inline policies, unapproved selection and unsafe files without adding jobs', async () => {
  const count = async () =>
    (await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_risk_jobs')).rows[0].n;
  const before = await count();
  for (const invalid of ['inline', 'selection', 'fields']) {
    const id = randomUUID(),
      job = structuredClone(input),
      pick = structuredClone(selection);
    job.job_ref = job.risk_request.run_id = id;
    if (invalid === 'inline') job.risk_request.policy = riskJobFixture().input.risk_request.policy;
    if (invalid === 'selection') pick.expected_generation = 999;
    const envelope = { job, selection: pick, ...(invalid === 'fields' ? { actor: 'synthetic_forged' } : {}) };
    await savePrivateReport(base, 'v1', id, 'input.json', envelope, 512 * 1024);
    await assert.rejects(enqueueRiskJob(base, id, dsn(state, 'intake'), true), /diagnostics withheld/);
  }
  const path = join(base, 'v1', input.job_ref, 'input.json');
  await chmod(path, 0o644);
  try {
    await assert.rejects(enqueueRiskJob(base, input.job_ref, dsn(state, 'intake'), true));
  } finally {
    await chmod(path, 0o600);
  }
  assert.equal(await count(), before);
});
