import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { riskFixture } from '../../../../packages/risk/fixtures/request.mjs';
import { createRiskPolicies, createRiskJobs } from '../../../../packages/database/dist/index.js';
import { dsn } from '../../../../packages/database/scripts/local.mjs';

export async function automatedFixture(directory, { amount = '1000000.00', generation = randomUUID(), observedAt = '2026-10-02T00:00:00.000Z', fourthCurrency = 'THB' } = {}) {
  await mkdir(directory, { mode: 0o700 });
  const rows = [['1', amount, 'LAK', 'OK'], ['2', '10.00', 'LAK', 'TRANSACTION_FAILED'], ['3', '20.00', 'LAK', 'ERROR'], ['4', '30.00', fourthCurrency, 'OK']];
  const content = 'id,requesttime,amount,ccy,result,txtime\n' + rows.map(([id, value, currency, result]) =>
    [id, '2026-10-01 12:00:00', value, currency, result, '2026-10-01 12:00:01'].join(',')).join('\n') + '\n';
  const manifest = { format: 1, execution_mode: 'offline_analysis', batch_ref: randomUUID(), workspace_key: 'offline_automated',
    source_namespace: 'offline_automated_transfer', source_table: 'transfer', profile_version: 'offline-dataset-profile-1',
    dataset_sha256: createHash('sha256').update(content).digest('hex'), input_bytes: Buffer.byteLength(content), expected_rows: 4 };
  const manifestPath = join(directory, 'manifest.json'), inputPath = join(directory, 'transfer.csv');
  await writeFile(inputPath, content, { mode: 0o600, flag: 'wx' });
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
  return { manifestPath, inputPath, generation, observedAt };
}

export async function seedAutomatedPolicy(state, templateTarget = 'synthetic_automated_template') {
  const policies = createRiskPolicies(dsn(state, 'policy')), jobs = createRiskJobs(dsn(state, 'intake'));
  try {
    const policy = riskFixture().request.policy;
    policy.policy_id = 'synthetic_automated_policy'; policy.version = 'synthetic_v1'; policy.currency = 'LAK';
    policy.minimum_amount = '200000.00'; policy.rules.find(rule => rule.code === 'FRAUD_HIGH_AMOUNT').threshold = '1000000.00';
    const reference = { policy_id: policy.policy_id, policy_version: policy.version };
    for (const [action, actor, extra] of [['create', 'synthetic_author', { policy }], ['submit', 'synthetic_author', { ...reference, expected_revision: 0 }],
      ['approve', 'synthetic_checker', { ...reference, expected_revision: 1 }], ['activate', 'synthetic_checker', { ...reference, namespace: 'synthetic_automated', currency: 'LAK', expected_generation: 0 }]])
      await policies.command('synthetic_local', actor, { action, request_id: randomUUID(), note: 'Isolated invented automated Intake acceptance', ...extra });
    const job = randomUUID();
    await jobs.enqueueApproved({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', job_ref: job,
      risk_request: { format: 1, provenance: 'user_supplied_file', execution_mode: 'test', workspace_key: 'synthetic_local', run_id: job,
        target: { namespace: 'synthetic_automated', transaction_id: templateTarget, revision_number: 1 }, policy: null, context: null },
      alert_policy: { policy_id: 'synthetic_automated_alerts', version: 'synthetic_v1', minimum_severity: 'high', included_codes: ['FRAUD_HIGH_AMOUNT'], include_partial: true } },
    { ...reference, namespace: 'synthetic_automated', currency: 'LAK', expected_generation: 1 });
  } finally { await jobs.close(); await policies.close(); }
}
