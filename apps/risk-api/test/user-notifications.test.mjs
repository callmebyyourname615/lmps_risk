import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions } from '@lmps/database';
import { riskHash } from '@lmps/risk';
import { alertFixture } from '../../../packages/database/test/fixtures/alert.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { assessTransactionRisk } from '../../risk-workers/scripts/risk-assess.mjs';
import { generateAlerts } from '../../risk-workers/scripts/alerts.mjs';
import { savePrivateReport } from '../../risk-workers/scripts/private-json.mjs';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, state, owner, writer, reader, auth, app, f, id, baseline;
const root = '/v1/local/user-notifications';
const env = () => ({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path });
const get = (changes = {}, path = root) => request('GET', path, changes);
async function request(method, url, changes = {}, payload) {
  return app.inject({ method, url, headers: { authorization: 'Bearer ' + await auth.token({ sub: 'synthetic_inbox_a', scope: 'alerts:read', ...changes }), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
}
const mark = (changes = {}, notification = id, payload = {}) => request('POST', root + '/' + notification + '/read', changes, payload);
async function fingerprint() {
  const result = {};
  for (const table of ['local_alerts', 'local_alert_reviews', 'local_transaction_risks', 'local_outbox_intents', 'local_outbox_attempts', 'audit_events']) {
    result[table] = (await owner.pool.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS hash FROM platform.${table} t`)).rows[0].hash;
  }
  return result;
}
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-user-inbox-'); f = alertFixture(); auth = await authFixture(temporary);
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); reader = createDatabase(dsn(state)); writer = createTransactionRevisions(dsn(state, 'intake'));
  await writer.append(f.f.revision);
  const riskInputs = join(temporary, 'risk-inputs'), inputs = join(temporary, 'alerts');
  await savePrivateReport(riskInputs, 'v1', f.f.request.run_id, 'input.json', f.f.request, 384 * 1024);
  await assessTransactionRisk(riskInputs, f.f.request.run_id, dsn(state, 'intake'));
  await savePrivateReport(inputs, 'v1', f.generation.assessment_run_id, 'input.json', f.generation, 16384);
  ({ alert_id: id } = await generateAlerts(inputs, f.generation.assessment_run_id, dsn(state, 'intake')));
  ({ app } = await createApp(env())); await app.init(); baseline = await fingerprint();
});
after(async () => {
  await app?.close(); await reader?.close(); await writer?.close(); await owner?.close();
  if (temporary && !state) try { state = await loadState(join(temporary, 'pg')); } catch {}
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('actual Alert creation projects bilingual user notifications without outbox/private fields; GET has no writes', async () => {
  const response = await get(); assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers['cache-control'], 'no-store');
  const value = response.json(); assert.equal(value.subject, 'synthetic_inbox_a'); assert.equal(value.workspace_key, 'synthetic_local');
  assert.equal(value.items.length, 1); const item = value.items[0];
  assert.equal(item.id, id); assert.equal(item.reference, id); assert.equal(item.severity, 'high');
  assert.equal(item.read, false); assert.equal(item.read_at, null); assert.deepEqual(item.link, { kind: 'alert', alert_id: id });
  assert.match(item.title.lo, /[\u0e80-\u0eff]/); assert.match(item.preview.lo, /[\u0e80-\u0eff]/); assert.ok(item.observed_at <= value.as_of);
  for (const field of ['lease_token', 'provider', 'recipient', 'recorded_by', 'snapshot', 'policy', 'delivery_semantics']) assert.ok(!response.body.includes('"' + field + '"'));
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_user_notification_reads')).rows[0].n, 0);
  assert.deepEqual(await fingerprint(), baseline);
});
test('first read is idempotent under concurrent requests, persists across API restart and remains personal', async () => {
  const responses = await Promise.all([mark(), mark(), mark()]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  const receipt = responses[0].json(); assert.equal(receipt.id, id); assert.equal(receipt.read, true);
  for (const response of responses) assert.deepEqual(response.json(), receipt);
  assert.equal((await get()).json().items[0].read_at, receipt.read_at);
  assert.equal((await get({ sub: 'synthetic_inbox_b' })).json().items[0].read, false);
  await app.close(); ({ app } = await createApp(env())); await app.init();
  assert.equal((await get()).json().items[0].read_at, receipt.read_at);
  assert.deepEqual((await mark()).json(), receipt);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_user_notification_reads')).rows[0].n, 1);
  assert.deepEqual(await fingerprint(), baseline);
});
test('foreign and unknown notifications are indistinguishable; identity overrides never reach storage', async () => {
  assert.deepEqual((await get({ workspace_key: 'synthetic_other' })).json().items, []);
  const foreign = await mark({ workspace_key: 'synthetic_other' }); const unknown = await mark({}, randomUUID());
  assert.equal(foreign.statusCode, 404); assert.deepEqual(foreign.json(), unknown.json());
  for (const payload of [{ subject: 'synthetic_inbox_b' }, { workspace_key: 'synthetic_other' }, { read: true }, [], 'bad', null]) {
    assert.equal((await mark({}, id, payload)).statusCode, 400);
  }
  for (const suffix of ['?subject=synthetic_inbox_b', '?workspace_key=synthetic_other', '?limit=1', '?after=a', '?read=unread&read=all']) assert.equal((await get({}, root + suffix)).statusCode, 400);
  assert.equal((await mark({}, 'bad')).statusCode, 400);
  assert.equal((await request('POST', root + '/' + id + '/read?subject=synthetic_inbox_b', {}, {})).statusCode, 400);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_user_notification_reads')).rows[0].n, 1);
});
test('verified Alert read permission is required; missing/expired tokens and operations-only access cannot read or mark', async () => {
  for (const [method, path] of [['GET', root], ['POST', root + '/' + id + '/read']]) {
    assert.equal((await app.inject({ method, url: path, ...(method === 'POST' ? { payload: {} } : {}) })).statusCode, 401);
    assert.equal((await request(method, path, { exp: Math.floor(Date.now() / 1000) - 1 }, {})).statusCode, 401);
    for (const scope of ['operations:read', 'alerts:review', 'risk:read']) assert.equal((await request(method, path, { scope }, {})).statusCode, 403);
  }
  assert.equal((await mark({ sub: 'synthetic_inbox_b' })).statusCode, 200);
  assert.equal((await get({ sub: 'synthetic_inbox_b' })).json().items[0].read, true);
  const rights = (await reader.pool.query(`SELECT has_table_privilege(current_user,'platform.local_user_notification_reads','INSERT,UPDATE,DELETE') AS direct_write,
    has_function_privilege(current_user,'platform.read_local_user_notification(text,text,uuid)','EXECUTE') AS own_receipt`)).rows[0];
  assert.equal(rights.direct_write, false); assert.equal(rights.own_receipt, true);
  const doc = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
  assert.ok(doc.paths[root].get.responses['422']); assert.ok(doc.paths[root + '/{id}/read'].post.responses['404']);
});
test('complete inbox is unread-first, stable at equal timestamps and fails closed at 201 without truncated counts', async () => {
  const ids = [];
  const source = (await owner.pool.query('SELECT * FROM platform.local_alerts WHERE alert_id=$1', [id])).rows[0];
  for (let i = 0; i < 200; i++) {
    const policy = { ...f.policy, version: 'synthetic_inbox_' + i }; const snapshot = { ...source.snapshot, policy }; const nextId = randomUUID(); ids.push(nextId);
    await owner.pool.query(`INSERT INTO platform.local_alert_policies(workspace_key,policy_id,policy_version,policy,policy_sha256) VALUES('synthetic_local',$1,$2,$3::jsonb,$4)`, [policy.policy_id, policy.version, JSON.stringify(policy), riskHash(policy)]);
    await owner.pool.query(`INSERT INTO platform.local_alerts(workspace_key,alert_id,assessment_run_id,policy_id,policy_version,policy_sha256,snapshot,snapshot_sha256,created_at)
      VALUES('synthetic_local',$1,$2,$3,$4,$5,$6::jsonb,$7,'2026-01-01T00:00:00.000001Z')`, [nextId, source.assessment_run_id, policy.policy_id, policy.version, riskHash(policy), JSON.stringify(snapshot), riskHash(snapshot)]);
    if (i === 198) {
      const value = (await get()).json(); assert.equal(value.items.length, 200); assert.equal(value.items.at(-1).id, id);
      assert.deepEqual(value.items.slice(0, -1).map(item => item.id), [...ids].sort());
    }
  }
  const tooLarge = await get(); assert.equal(tooLarge.statusCode, 422); assert.equal(tooLarge.json().code, 'MONITORING_SCOPE_TOO_LARGE'); assert.equal(tooLarge.json().items, undefined);
  await owner.pool.query('DELETE FROM platform.local_alerts WHERE alert_id=ANY($1::uuid[])', [ids]);
  await owner.pool.query("DELETE FROM platform.local_alert_policies WHERE policy_version LIKE 'synthetic_inbox_%'");
  assert.deepEqual(await fingerprint(), baseline);
});
test('storage outage returns fixed errors for both routes and recovers without altering source or delivery', async () => {
  await stopCluster(state);
  try {
    for (const response of [await get(), await mark()]) { assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { code: 'USER_NOTIFICATIONS_UNAVAILABLE', message: 'The user notification inbox is unavailable.' }); }
  } finally { await startCluster(state); }
  assert.equal((await get()).statusCode, 200); assert.deepEqual(await fingerprint(), baseline);
});
