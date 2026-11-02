import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createOfflineDatasets, datasetRowsHash } from '@lmps/database';
import { initializeCluster, availablePort, startCluster, stopCluster, dsn, loadState } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { datasetFixture } from '../../../packages/database/test/fixtures/offline-dataset.mjs';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { loadOfflineMonitoringConfig } from '../dist/offline-monitoring.js';
import { readConfig } from '../dist/config.js';

let temporary, state, owner, repo, app, auth, fixture, grant, config, configPath;
const principal = { subject: 'synthetic_offline_reader', workspace: 'synthetic_local' };
const scopes = 'source:read transactions:read risk:read';
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-offline-monitoring-');
  state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); repo = createOfflineDatasets(dsn(state, 'intake'));
  fixture = datasetFixture(7);
  const amounts = ['4999999.99','5000000.00','5000000.01','9999999999999999999999.99','-0.01','0.00','13.00'];
  fixture.rows.forEach((row, index) => { row[2] = amounts[index]; row[3] = index === 6 ? 'THB' : 'LAK'; row[4] = index === 0 ? '' : null; });
  const content = JSON.stringify(fixture.rows);
  Object.assign(fixture.manifest, { rows_sha256: datasetRowsHash(fixture.rows), dataset_sha256: createHash('sha256').update(content).digest('hex'), input_bytes: Buffer.byteLength(content) });
  await repo.register(fixture.manifest); await repo.append(fixture.manifest, 1, fixture.rows); await repo.reconcile(fixture);
  grant = { subject: principal.subject, owner_workspace_key: principal.workspace, dataset_workspace_key: fixture.manifest.workspace_key,
    batch_ref: fixture.manifest.batch_ref, dataset_sha256: fixture.manifest.dataset_sha256, expected_rows: 7,
    label: 'Invented CSV validation fixture', thresholds: [{ source_ccy: 'LAK', amount_gte: '5000000.00' }] };
  config = { format: 1, default_batch_ref: grant.batch_ref, grants: [grant] }; configPath = join(temporary, 'offline.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 }); auth = await authFixture(temporary);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path,
    LMPS_LOCAL_OFFLINE_CONFIG: configPath, LMPS_LOCAL_OFFLINE_DSN: dsn(state, 'intake') }));
  await app.listen(0, '127.0.0.1');
});
after(async () => {
  await app?.close(); await repo?.close(); await owner?.close();
  if (temporary && !state) try { state = await loadState(join(temporary, 'pg')); } catch { return; }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});
async function get(suffix = '', claims = {}) {
  return app.inject({ method: 'GET', url: '/v1/local/monitoring/offline/datasets' + suffix,
    headers: { authorization: 'Bearer ' + await auth.token({ sub: principal.subject, scope: scopes, ...claims }) } });
}
const path = () => '/' + grant.batch_ref + '/trends';

test('an explicit principal/batch grant exposes exact amount decisions without changing source provenance or creating Risk results', async () => {
  const catalog = await get(); assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().default_batch_ref, grant.batch_ref); assert.equal(catalog.json().datasets[0].expected_rows, 7);
  const response = await get(path()); assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  const value = response.json(); assert.deepEqual(value.counts, { rows: 7, matched: 3, not_matched: 3, unavailable: 1 });
  assert.equal(value.source_kind, 'user_supplied_file'); assert.equal(value.execution_mode, 'offline_analysis');
  assert.equal(value.source_semantics, 'unverified'); assert.equal(value.risk_assessment, 'not_performed');
  assert.equal(value.operational_alerts, false); assert.equal(value.enforcement, false);
  assert.equal(value.source_timezone, 'unconfirmed_no_conversion'); assert.equal(value.rows[3].amount, amountsMaximum());
  assert.equal(value.rows[0].result, ''); assert.equal(value.rows[1].result, null);
  assert.equal(value.rows[1].outcome, 'matched'); assert.equal(value.rows[6].outcome, 'unavailable'); assert.equal(value.rows[6].threshold, null);
  assert.equal(value.dataset.workspace_key, 'offline_local'); assert.equal(value.owner_workspace_key, 'synthetic_local');
  assert.ok(!response.body.includes('dataset_sha256')); assert.ok(!response.body.includes('fromaccount'));
});
function amountsMaximum() { return '9999999999999999999999.99'; }

test('authentication, each required scope, explicit ownership and unknown batches reject before exposing staging rows', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/v1/local/monitoring/offline/datasets' })).statusCode, 401);
  for (const missing of scopes.split(' ')) assert.equal((await get(path(), { scope: scopes.split(' ').filter(s => s !== missing).join(' ') })).statusCode, 403);
  for (const claims of [{ sub: 'synthetic_other_reader' }, { workspace_key: 'synthetic_other' }]) {
    assert.deepEqual((await get('', claims)).json().datasets, []);
    const response = await get(path(), claims); assert.equal(response.statusCode, 404); assert.equal(response.json().rows, undefined);
  }
  assert.equal((await get('/' + randomUUID() + '/trends')).statusCode, 404);
  for (const suffix of ['/bad/trends', path() + '?workspace_key=offline_other', path() + '?amount_gte=0.01', '?batch=x', path() + '?a=1&a=2']) {
    const response = await get(suffix); assert.equal(response.statusCode, 400, suffix); assert.equal(response.json().rows, undefined);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/v1/local/monitoring/offline/datasets' })).statusCode, 404);
});

test('shared sidebar Monitoring snapshot has identical verified rows, grant isolation and strict query bounds', async () => {
  const monitoringPath = path().replace('/trends','/monitoring');
  const trends = await get(path()), monitoring = await get(monitoringPath);
  assert.equal(monitoring.statusCode,200);
  const a=trends.json(), b=monitoring.json();delete a.as_of;delete b.as_of;assert.deepEqual(b,a);
  for (const missing of scopes.split(' ')) assert.equal((await get(monitoringPath,{scope:scopes.split(' ').filter(scope=>scope!==missing).join(' ')})).statusCode,403);
  assert.equal((await get(monitoringPath,{sub:'synthetic_other_reader'})).statusCode,404);
  assert.equal((await get(monitoringPath+'?workspace_key=offline_other')).statusCode,400);
  assert.equal((await get('/bad/monitoring')).statusCode,400);
});

test('a corrupt row is unavailable with no partial values and the original complete batch remains unchanged by reads', async () => {
  const before = (await owner.pool.query('SELECT row_to_json(t) AS value FROM platform.offline_dataset_batches t ORDER BY batch_ref')).rows;
  await get(path()); await get(path());
  assert.deepEqual((await owner.pool.query('SELECT row_to_json(t) AS value FROM platform.offline_dataset_batches t ORDER BY batch_ref')).rows, before);
  await owner.pool.query("UPDATE platform.offline_dataset_rows SET fields=jsonb_set(fields,'{amount}','\"1.00\"') WHERE batch_ref=$1 AND row_number=1", [grant.batch_ref]);
  try { const response = await get(path()); assert.equal(response.statusCode, 503); assert.equal(response.json().rows, undefined); assert.equal(response.json().code, 'OFFLINE_MONITORING_UNAVAILABLE'); }
  finally { await owner.pool.query('UPDATE platform.offline_dataset_rows SET fields=$1 WHERE batch_ref=$2 AND row_number=1', [JSON.stringify({ amount: fixture.rows[0][2], ccy: fixture.rows[0][3], result: fixture.rows[0][4], txtime: fixture.rows[0][5] }), grant.batch_ref]); }
  assert.equal((await get(path())).statusCode, 200);
});

test('the bounded complete reader rejects excessive rows before loading and leaves legacy reads working', async () => {
  await assert.rejects(repo.readComplete(grant.dataset_workspace_key, grant.batch_ref, grant.dataset_sha256, 6), e => e.code === 'DATASET_BLOCKED');
  await assert.rejects(repo.readComplete(grant.dataset_workspace_key, grant.batch_ref, grant.dataset_sha256, 0), e => e.code === 'DATASET_INVALID_INPUT');
  assert.equal((await repo.readComplete(grant.dataset_workspace_key, grant.batch_ref, grant.dataset_sha256)).rows.length, 7);
  const denied = createDatabase(dsn(state), 'app');
  try { await assert.rejects(denied.pool.query('SELECT * FROM platform.offline_dataset_rows'), e => e.code === '42501'); }
  finally { await denied.close(); }
});

test('private configuration rejects broad/foreign/unsafe grants and cross-instance or app-role offline credentials', async () => {
  assert.equal(await loadOfflineMonitoringConfig(), null);
  const file = join(temporary, 'invalid-offline.json');
  for (const value of [{ ...config, grants: [grant,grant] }, { ...config, grants: [{ ...grant, expected_rows: 501 }] },
    { ...config, grants: [{ ...grant, subject: '*' }] }, { ...config, grants: [{ ...grant, extra: true }] },
    { ...config, default_batch_ref: randomUUID() }, { ...config, grants: [{ ...grant, thresholds: [{source_ccy:'LAK',amount_gte:'0.00'}] }] }]) {
    await writeFile(file, JSON.stringify(value), { mode: 0o600 }); await assert.rejects(loadOfflineMonitoringConfig(file));
  }
  await writeFile(file, JSON.stringify(config)); await chmod(file, 0o644); await assert.rejects(loadOfflineMonitoringConfig(file));
  await symlink(configPath, join(temporary,'linked-offline.json')); await assert.rejects(loadOfflineMonitoringConfig(join(temporary,'linked-offline.json')));
  const env = { LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path };
  for (const extra of [{ LMPS_LOCAL_OFFLINE_CONFIG: configPath }, { LMPS_LOCAL_OFFLINE_DSN: dsn(state,'intake') },
    { LMPS_LOCAL_OFFLINE_CONFIG: configPath, LMPS_LOCAL_OFFLINE_DSN: dsn(state) },
    { LMPS_LOCAL_OFFLINE_CONFIG: configPath, LMPS_LOCAL_OFFLINE_DSN: dsn({...state,port:state.port+1},'intake') }]) assert.throws(() => readConfig({...env,...extra}));
});
