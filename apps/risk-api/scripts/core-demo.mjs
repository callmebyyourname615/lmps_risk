import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRiskJobs, createTransactionRevisions } from '@lmps/database';
import { riskHash, validateRiskRequest } from '@lmps/risk';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';
import { publicationFixture } from '../../../packages/contracts/fixtures/synthetic-publication.mjs';
import { publicationTransaction } from '../../../packages/contracts/dist/synthetic-publication.js';
import { availablePort, dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { runRiskJob } from '../../risk-workers/dist/risk-job.js';
import { openCoreApi, CORE_ROLES } from './local-core.mjs';

export const CORE_DEMO = Object.freeze({ namespace: 'synthetic_snapshot', transaction_id: 'synthetic_core_payment',
  job_ref: '38000000-0000-4000-8000-000000000001', case_id: '38000000-0000-4000-8000-000000000002' });
const requestId = n => '38000000-0000-4000-8000-' + String(n).padStart(12, '0');

function inputs() {
  const { request } = riskFixture(), revision = publicationFixture(), p = revision.publication;
  request.run_id = CORE_DEMO.job_ref;
  request.target.namespace = CORE_DEMO.namespace; request.target.transaction_id = CORE_DEMO.transaction_id;
  request.policy.policy_id = 'synthetic_core_demo';
  Object.assign(p.source, { source_namespace: CORE_DEMO.namespace, observed_at: '2026-01-01T12:00:00.000Z',
    source_generation: requestId(3), capture_epoch: requestId(4) });
  p.capture_id = requestId(4);
  p.binding.transaction_id = CORE_DEMO.transaction_id;
  p.normalization_input.source_reference.namespace = CORE_DEMO.namespace;
  p.normalization_input.observed_at = p.source.observed_at; p.normalization_input.amount = '900.00';
  revision.transaction = publicationTransaction(p).transaction;
  request.context.binding = { ...request.target, revision_sha256: riskHash(revision) };
  for (const event of request.context.events) {
    event.namespace = CORE_DEMO.namespace;
    if (event.transaction_id === 'synthetic_target') event.transaction_id = CORE_DEMO.transaction_id;
  }
  return { revision, request: validateRiskRequest(request) };
}

// Fixed invented inputs/commands make restarts resume through existing idempotency checks.
export async function runCoreDemo(state) {
  localMode();
  let runtime, revisions, jobs, stage = 'startup';
  try {
    runtime = await openCoreApi(state, await availablePort());
    const api = runtime.request;
    stage = 'revision';
    const { revision, request } = inputs(), policy = request.policy;
    const ref = { policy_id: policy.policy_id, policy_version: policy.version };
    revisions = createTransactionRevisions(dsn(state, 'intake'));
    const appended = await revisions.append(revision);
    stage = 'policy';
    const policyCommand = (action, n, more) => ({ action, request_id: requestId(n), note: 'Invented local core demo policy; no production authority.', ...more });
    await api('author', 'POST', '/v1/local/risk-policies/drafts', policyCommand('create', 10, { policy }), 201);
    await api('author', 'POST', '/v1/local/risk-policies/submissions', policyCommand('submit', 11, { ...ref, expected_revision: 0 }), 201);
    await api('checker', 'POST', '/v1/local/risk-policies/approvals', policyCommand('approve', 12, { ...ref, expected_revision: 1 }), 201);
    await api('checker', 'POST', '/v1/local/risk-policies/activations', policyCommand('activate', 13, { ...ref, namespace: CORE_DEMO.namespace, currency: policy.currency, expected_generation: 0 }), 201);
    stage = 'risk_job';
    jobs = createRiskJobs(dsn(state, 'intake'));
    const manifest = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local',
      job_ref: CORE_DEMO.job_ref, risk_request: { ...request, policy: null },
      alert_policy: { policy_id: 'synthetic_core_demo_alerts', version: 'synthetic_v1', minimum_severity: 'high', included_codes: policy.rules.map(rule => rule.code), include_partial: true } };
    const enqueued = await jobs.enqueueApproved(manifest, { ...ref, namespace: CORE_DEMO.namespace, currency: policy.currency, expected_generation: 1 });
    const worked = await runRiskJob(dsn(state, 'intake'), CORE_DEMO.job_ref);
    assert.ok(['completed', 'idle'].includes(worked.status));
    const { job } = await api('reader', 'GET', '/v1/local/risk-jobs/' + CORE_DEMO.job_ref);
    assert.equal(job.status, 'completed'); assert.equal(job.result_code, 'ALERT_CREATED');
    const alertId = job.alert_id;
    stage = 'case';
    const base = '/v1/local/cases/' + CORE_DEMO.case_id;
    const command = (action, version, more = {}) => ({ action, expected_version: version, request_id: requestId(100 + version), note: 'Invented local core demo; evidence remains unverified.', ...more });
    await api('author', 'POST', base + '/create', command('create', 0, { title: 'Synthetic core integration demo', alert_id: alertId }), 201);
    await api('author', 'POST', base + '/assignment', command('assign', 1, { assignee_subject: CORE_ROLES.analyst.sub }), 201);
    await api('analyst', 'POST', base + '/start', command('start', 2), 201);
    await api('analyst', 'POST', base + '/notes', command('add_note', 3, { note: 'ຂໍ້ມູນຈຳລອງ — synthetic evidence only.' }), 201);
    const dimensions = Object.fromEntries(['fraud', 'mule_network', 'aml'].map(key => [key, { outcome: 'unknown', rationale: 'Invented scenario is not a verified criminal or legitimate label.' }]));
    await api('analyst', 'POST', base + '/outcomes', command('record_outcome', 4, { dimensions }), 201);
    await api('analyst', 'POST', base + '/close', command('close', 5), 201);
    stage = 'verification';
    const { case: record } = await api('reader', 'GET', base);
    assert.equal(record.state, 'closed'); assert.equal(record.version, 6);
    assert.deepEqual(record.current_outcome.dimensions, dimensions);
    assert.equal(record.current_outcome.training_eligible, false);
    const evidence = await api('reader', 'GET', base + '/evidence');
    assert.equal(evidence.items[0].alert_id, alertId);
    assert.equal(evidence.items[0].risk_policy.sha256, riskHash(policy));
    assert.equal((await api('reader', 'GET', base + '/events?limit=10')).items.length, 6);
    await api('reader', 'POST', base + '/close', command('close', 5), 403);
    return { format: 1, provenance: 'local_synthetic', execution_mode: 'test', ...CORE_DEMO, alert_id: alertId,
      revision: appended.status, job: enqueued.status, case_state: record.state, case_version: record.version, training_eligible: false };
  } catch { throw new Error(`Local core demo failed at ${stage}; committed steps are retained for exact retry; diagnostics withheld.`); }
  finally { try { await revisions?.close(); await jobs?.close(); } finally { await runtime?.close(); } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error();
    console.info(JSON.stringify(await runCoreDemo(await loadState())));
  } catch { console.error('Local core demo failed; committed steps are retained for exact retry; credentials and diagnostics withheld.'); process.exitCode = 1; }
}
