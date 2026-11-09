import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, createTransactionRevisions, createRiskPolicies } from '@lmps/database';
import { createApp } from '../../dist/app.js';
import { authFixture } from '../../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster } from '../../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../../packages/database/scripts/migrations.mjs';
import { auditFixture } from '../../../../packages/contracts/fixtures/intake-audit.mjs';
import { riskJobFixture } from '../../../../packages/database/test/fixtures/risk-job.mjs';
import { makeSourcePublication } from '@lmps/contracts/source-publication';

export const INTAKE_HEALTH_SCOPES = 'alerts:read source:read transactions:read policies:read';
export async function intakeHealthFixture() {
  let directory, state, owner, writer, policies, app;
  const close = async () => {
    await app?.close();
    for (const service of [policies, writer, owner]) await service?.close();
    if (state) await stopCluster(state);
    if (directory) await rm(directory, { recursive: true, force: true });
  };
  try {
    directory = await mkdtemp('/tmp/lmps-intake-health-');
    state = await initializeCluster(join(directory, 'pg'), await availablePort());
    await startCluster(state); await migrations(dsn(state, 'migration'), true);
    owner = createDatabase(dsn(state, 'migration'), 'migration'); writer = createTransactionRevisions(dsn(state, 'intake')); policies = createRiskPolicies(dsn(state, 'policy'));
    const rows = auditFixture();
    const append = row => writer.append({ format: 1, execution_mode: 'test', provenance: row.provenance, workspace_key: row.workspace_key,
      expected_revision: row.revision_number - 1, transaction: row.payload, publication: row.publication });
    for (const row of rows) await append(row);
    const demo = riskJobFixture().f.f.revision;
    await writer.append(demo);
    delete demo.publication; demo.transaction.source_reference.namespace = 'synthetic_csv'; demo.transaction.transaction_status = 'unknown';
    await writer.append(demo);
    const source = rows[0].publication;
    const other = makeSourcePublication({ workspace: 'synthetic_local', namespace: 'synthetic_automated', generation: source.source.source_generation,
      batch: source.capture_id, dataset_sha256: source.snapshot_sha256, rows_sha256: source.evidence_sha256,
      source_namespace: source.origin.source_namespace, row_number: source.origin.row_number, values: source.origin.values,
      observed_at: source.source.observed_at, expected_revision: 0 });
    await writer.append({ format: 1, execution_mode: 'test', provenance: 'user_supplied_file', workspace_key: 'synthetic_local', expected_revision: 0, ...other });
    const policy = riskJobFixture().input.risk_request.policy;
    policy.currency = 'LAK';
    const command = (action, body) => ({ action, request_id: randomUUID(), note: 'Synthetic intake health fixture', ...body });
    await policies.command('synthetic_local', 'synthetic_maker', command('create', { policy }));
    await policies.command('synthetic_local', 'synthetic_maker', command('submit', { policy_id: policy.policy_id, policy_version: policy.version, expected_revision: 0 }));
    await policies.command('synthetic_local', 'synthetic_checker', command('approve', { policy_id: policy.policy_id, policy_version: policy.version, expected_revision: 1 }));
    await policies.command('synthetic_local', 'synthetic_checker', command('activate', { policy_id: policy.policy_id, policy_version: policy.version, namespace: 'synthetic_csv', currency: policy.currency, expected_generation: 0 }));
    const auth = await authFixture(directory);
    ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_READ_NAMESPACE: 'synthetic_csv',
      LMPS_LOCAL_AUTH_CONFIG: auth.path, LMPS_WEB_PUSH_WORKER: '0', LMPS_DETECTION_WORKER: '0' }));
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    return { app, origin, owner, writer, policies, rows, append, state, close, authPath: auth.path,
      token: changes => auth.token({ sub: 'synthetic_intake_health_reader', scope: INTAKE_HEALTH_SCOPES, ...changes }),
      transport: async (path, options) => {
        const response = await app.inject({ method: options.method ?? 'GET', url: path, headers: { authorization: options.headers.Authorization, 'accept-language': options.headers['Accept-Language'] ?? 'en' } });
        return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
      },
      stopDatabase: () => stopCluster(state), startDatabase: () => startCluster(state),
    };
  } catch (error) { await close(); throw error; }
}
