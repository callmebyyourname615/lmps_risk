import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions } from '@lmps/database';
import { alertFixture } from '../../../packages/database/test/fixtures/alert.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { assessTransactionRisk } from '../../risk-workers/scripts/risk-assess.mjs';
import { generateAlerts } from '../../risk-workers/scripts/alerts.mjs';
import { savePrivateReport } from '../../risk-workers/scripts/private-json.mjs';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, state, writer, reader, auth, app, f, inputs, generated;
const request = async (method, url, scope, payload, workspace_key = 'synthetic_local', language = 'en') => app.inject({ method, url,
  headers: { authorization: 'Bearer ' + await auth.token({ scope, workspace_key, sub: 'synthetic_reviewer' }), 'accept-language': language }, ...(payload ? { payload } : {}) });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-alert-e2e-'); f = alertFixture(); auth = await authFixture(temporary); inputs = join(temporary, 'alert-inputs');
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  writer = createTransactionRevisions(dsn(state, 'intake')); await writer.append(f.f.revision); reader = createDatabase(dsn(state));
  const riskInputs = join(temporary, 'risk-inputs'); await savePrivateReport(riskInputs, 'v1', f.f.request.run_id, 'input.json', f.f.request, 384 * 1024);
  await assessTransactionRisk(riskInputs, f.f.request.run_id, dsn(state, 'intake'));
  await savePrivateReport(inputs, 'v1', f.generation.assessment_run_id, 'input.json', f.generation, 16384);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_REVIEW_DSN: dsn(state, 'reviewer'), LMPS_LOCAL_AUTH_CONFIG: auth.path })); await app.init();
});
after(async () => {
  await app?.close(); await reader?.close(); await writer?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
test('private risk worker→PG assessment→alert worker→scoped Lao/English inbox retains every finding and score', async () => {
  generated = await generateAlerts(inputs, f.generation.assessment_run_id, dsn(state, 'intake')); assert.equal(generated.status, 'inserted');
  assert.equal((await generateAlerts(inputs, f.generation.assessment_run_id, dsn(state, 'intake'))).status, 'duplicate');
  const path = '/v1/local/alerts/' + generated.alert_id, en = await request('GET', path, 'alerts:read'), lo = await request('GET', path, 'alerts:read', null, 'synthetic_local', 'lo');
  assert.equal(en.statusCode, 200); assert.equal(en.json().alert.selected_risk_types.length, 15); assert.equal(en.json().alert.fraud_score.value, 1);
  assert.equal(en.json().alert.core_sha256, lo.json().alert.core_sha256); assert.deepEqual(en.json().alert.assessment.risk_types, lo.json().alert.assessment.risk_types);
  assert.equal((await request('GET', '/v1/local/alerts?state=open&risk_code=FRAUD_HIGH_AMOUNT', 'alerts:read')).json().items.length, 1);
  assert.equal((await request('GET', path, 'alerts:read', null, 'synthetic_other')).json().alert, null);
});
test('real HTTP review uses isolated credential, versions and JWT actor; reviewed unknown and its audit survive retries', async () => {
  const path = '/v1/local/alerts/' + generated.alert_id + '/reviews', scope = 'alerts:read alerts:review';
  assert.equal((await request('POST', path, 'alerts:read', f.ack)).statusCode, 403);
  assert.equal((await request('POST', path, scope, f.ack, 'synthetic_other')).statusCode, 404);
  const ack = await request('POST', path, scope, f.ack); assert.equal(ack.statusCode, 201); assert.equal(ack.json().alert.state, 'acknowledged');
  const review = await request('POST', path, scope, f.review, 'synthetic_local', 'lo'); assert.equal(review.statusCode, 201); assert.equal(review.json().alert.outcome, 'unknown');
  assert.equal(review.json().alert.history.length, 2); assert.equal(review.json().alert.history[1].actor_subject, 'synthetic_reviewer');
  const retry = await request('POST', path, scope, f.ack); assert.equal(retry.json().status, 'duplicate'); assert.equal(retry.json().alert.version, 2);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_alert_reviews')).rows[0].n, 2);
  for (const table of ['source_events', 'local_outbox_intents', 'audit_events']) assert.equal((await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n, 0);
});
