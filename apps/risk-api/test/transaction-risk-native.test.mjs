import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransactionRevisions } from '@lmps/database';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { assessTransactionRisk } from '../../risk-workers/scripts/risk-assess.mjs';
import { savePrivateReport } from '../../risk-workers/scripts/private-json.mjs';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, state, writer, auth, app, inputs, f;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-risk-e2e-'); inputs = join(temporary, 'inputs'); f = transactionRiskFixture(); auth = await authFixture(temporary);
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  writer = createTransactionRevisions(dsn(state, 'intake')); await writer.append(f.revision);
  await savePrivateReport(inputs, 'v1', f.request.run_id, 'input.json', f.request, 384 * 1024);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path })); await app.init();
});
after(async () => {
  await app?.close(); await writer?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
test('private risk manifest → worker → real PostgreSQL → Lao/English HTTP preserves scores and immutable replay', async () => {
  const first = await assessTransactionRisk(inputs, f.request.run_id, dsn(state, 'intake')); assert.equal(first.status, 'inserted'); assert.equal(first.triggered_types, 15);
  assert.equal((await assessTransactionRisk(inputs, f.request.run_id, dsn(state, 'intake'))).status, 'duplicate');
  const token = await auth.token({ scope: 'risk:read' });
  const get = lang => app.inject({ method: 'GET', url: '/v1/local/risk-assessments/' + f.request.run_id, headers: { authorization: 'Bearer ' + token, 'accept-language': lang } });
  const lo = await get('lo'), en = await get('en'); assert.equal(lo.statusCode, 200); assert.equal(en.statusCode, 200);
  assert.equal(lo.json().assessment.fraud_score.value, 1); assert.equal(lo.json().core_sha256, en.json().core_sha256); assert.notEqual(lo.json().assessment.response_message, en.json().assessment.response_message);
});
test('unsafe private manifest permissions and live execution reject without publishing extra assessments', async () => {
  const path = join(inputs, 'v1', f.request.run_id, 'input.json'); await chmod(path, 0o644);
  try { await assert.rejects(assessTransactionRisk(inputs, f.request.run_id, dsn(state, 'intake')), /diagnostics withheld/); } finally { await chmod(path, 0o600); }
  const previous = process.env.LMPS_EXECUTION_MODE; process.env.LMPS_EXECUTION_MODE = 'live';
  try { await assert.rejects(assessTransactionRisk(inputs, f.request.run_id, dsn(state, 'intake')), /diagnostics withheld/); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
});
