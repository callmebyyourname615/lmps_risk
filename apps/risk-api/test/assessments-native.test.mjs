import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions, evaluateBacktest } from '@lmps/database';
import { assessmentFixture } from '../../../packages/database/test/fixtures/rule-assessment.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { assessRun } from '../../risk-workers/scripts/assess.mjs';
import { savePrivateReport } from '../../risk-workers/scripts/private-json.mjs';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, state, owner, writer, auth, app, inputs, f;
const get = async (path, scope, changes = {}) => app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer ' + await auth.token({ scope, ...changes }) } });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-assessments-http-'); inputs = join(temporary, 'inputs'); auth = await authFixture(temporary); f = assessmentFixture();
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); writer = createTransactionRevisions(dsn(state, 'intake')); await writer.append(f.revision);
  await savePrivateReport(inputs, 'v1', f.manifest.run_id, 'input.json', f.manifest, 128 * 1024);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path })); await app.init();
});
after(async () => {
  await app?.close(); await writer?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('private worker manifest → transactional PG assessment → scoped HTTP details, summaries and rule versions', async () => {
  const result = await assessRun(inputs, f.manifest.run_id, dsn(state, 'intake')); assert.equal(result.status, 'inserted');
  assert.deepEqual(Object.keys(result).sort(), ['counts', 'report_status', 'run_id', 'status']);
  assert.equal((await assessRun(inputs, f.manifest.run_id, dsn(state, 'intake'))).status, 'duplicate');
  const detail = await get('/v1/local/assessments/' + f.manifest.run_id, 'assessments:read'); assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json().report, evaluateBacktest(f.manifest, f.observations));
  const summary = await get('/v1/local/assessments?limit=1', 'assessments:read'); assert.equal(summary.json().items[0].run_id, f.manifest.run_id);
  for (const rule of f.manifest.rules) {
    const versions = await get('/v1/local/rules/' + rule.rule_id + '/versions', 'rules:read'); assert.equal(versions.statusCode, 200);
    assert.deepEqual(versions.json().items[0].definition, rule);
  }
  assert.deepEqual((await get('/v1/local/assessments/' + f.manifest.run_id, 'assessments:read', { workspace_key: 'synthetic_other' })).json(), { report: null, report_sha256: null });
});

test('worker private-file boundary and corrupt stored report fail closed without changing saved evidence', async () => {
  const path = join(inputs, 'v1', f.manifest.run_id, 'input.json'); await chmod(path, 0o644);
  try { await assert.rejects(assessRun(inputs, f.manifest.run_id, dsn(state, 'intake')), /diagnostics withheld/); }
  finally { await chmod(path, 0o600); }
  const saved = (await owner.pool.query('SELECT report FROM platform.local_assessment_runs')).rows[0].report;
  try {
    await owner.pool.query("UPDATE platform.local_assessment_runs SET report=jsonb_set(report,'{rows,0,source,extra}',to_jsonb('SYNTHETIC_PRIVATE_VALUE'::text))");
    const response = await get('/v1/local/assessments/' + f.manifest.run_id, 'assessments:read'); assert.equal(response.statusCode, 503);
    assert.ok(!response.body.includes('PRIVATE'));
    await assert.rejects(assessRun(inputs, f.manifest.run_id, dsn(state, 'intake')), /diagnostics withheld/);
  } finally { await owner.pool.query('UPDATE platform.local_assessment_runs SET report=$1', [saved]); }
});
