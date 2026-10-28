import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, createTransactionRevisions, createRiskJobs, createRiskPolicies, createDetectionHandoff } from '@lmps/database';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { createApp } from '../../dist/app.js';
import { authFixture } from '../../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster } from '../../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../../packages/database/scripts/migrations.mjs';
import { riskJobFixture } from '../../../../packages/database/test/fixtures/risk-job.mjs';

export const DETECTION_SCOPES = 'alerts:read transactions:read risk:read risk-jobs:read policies:read';
export async function detectionFixture({ automatic = false } = {}) {
  let directory, state, owner, writer, jobs, policies, handoff, app;
  const close = async () => {
    await app?.close();
    for (const service of [handoff, policies, jobs, writer, owner]) await service?.close();
    if (state) await stopCluster(state);
    if (directory) await rm(directory, { recursive: true, force: true });
  };
  try {
    directory = await mkdtemp('/tmp/lmps-detection-');
    state = await initializeCluster(join(directory, 'pg'), await availablePort());
    await startCluster(state); await migrations(dsn(state, 'migration'), true);
    owner = createDatabase(dsn(state, 'migration'), 'migration'); writer = createTransactionRevisions(dsn(state, 'intake'));
    jobs = createRiskJobs(dsn(state, 'intake')); policies = createRiskPolicies(dsn(state, 'policy')); handoff = createDetectionHandoff(dsn(state, 'intake'));
    const { f, input } = riskJobFixture(), policy = input.risk_request.policy;
    const selection = { policy_id: policy.policy_id, policy_version: policy.version, namespace: input.risk_request.target.namespace, currency: policy.currency, expected_generation: 1 };
    const command = (action, body) => ({ action, request_id: randomUUID(), note: 'Synthetic detection evidence', ...body });
    async function approve() {
      await policies.command('synthetic_local', 'synthetic_maker', command('create', { policy }));
      await policies.command('synthetic_local', 'synthetic_maker', command('submit', { policy_id: policy.policy_id, policy_version: policy.version, expected_revision: 0 }));
      await policies.command('synthetic_local', 'synthetic_checker', command('approve', { policy_id: policy.policy_id, policy_version: policy.version, expected_revision: 1 }));
      await policies.command('synthetic_local', 'synthetic_checker', command('activate', { ...selection, expected_generation: 0 }));
    }
    async function append(id, revision = 0, normalized = true) {
      const value = structuredClone(f.f.revision);
      value.expected_revision = revision;
      value.publication.binding.expected_revision = revision;
      value.publication.binding.transaction_id = id;
      value.publication.binding.transaction_revision = 'synthetic_revision_' + (revision + 1);
      value.transaction = publicationTransaction(value.publication).transaction;
      if (!normalized) { delete value.publication; value.transaction.transaction_status = 'unknown'; }
      await writer.append(value); return value;
    }
    async function template(id = 'synthetic_template', alertPolicy = input.alert_policy) {
      await append(id);
      const reference = randomUUID(), manifest = structuredClone(input);
      manifest.job_ref = manifest.risk_request.run_id = reference; manifest.risk_request.policy = null; manifest.risk_request.context = null;
      manifest.risk_request.target.transaction_id = id; manifest.alert_policy = alertPolicy;
      await jobs.enqueueApproved(manifest, selection); return reference;
    }
    const auth = await authFixture(directory);
    ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path,
      LMPS_LOCAL_DETECTION_DSN: dsn(state, 'intake'), LMPS_DETECTION_WORKER: automatic ? '1' : '0' }));
    await app.listen(0, '127.0.0.1');
    return { app, origin: await app.getUrl(), owner, writer, jobs, policies, handoff, state, input, selection, approve, append, template, close,
      token: changes => auth.token({ sub: 'synthetic_detection_reader', scope: DETECTION_SCOPES, ...changes }),
      stopDatabase: () => stopCluster(state), startDatabase: () => startCluster(state) };
  } catch (error) { await close(); throw error; }
}
