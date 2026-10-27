import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createSyncJobs } from '@lmps/database';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';

let temporary, state, owner, jobs, app, fixture, origin, complete, pending, retried, other;
const url = '/v1/local/sync/jobs';
const get = (path, token, headers = {}) => fetch(origin + path, { headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });
const token = (changes = {}) => fixture.token({ scope: 'sync:read', ...changes });
async function register(workspace = 'synthetic_local') {
  const identity = { workspace_key: workspace, capture_id: randomUUID(), snapshot_sha256: 'a'.repeat(64), total: 0 };
  const job_ref = await jobs.register(identity); return { identity, job_ref };
}
async function claim(job) { const result = await jobs.claim(job.identity); assert.equal(result.status, 'claimed'); return result.claim; }
async function expire(job) { await owner.pool.query("UPDATE platform.local_sync_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_ref=$1", [job.job_ref]); }
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-sync-http-'); fixture = await authFixture(temporary);
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); jobs = createSyncJobs(dsn(state, 'intake'));
  await owner.pool.query('ALTER SEQUENCE platform.local_sync_jobs_job_id_seq RESTART WITH 9007199254740993');
  complete = await register(); const held = await claim(complete); await jobs.imported(held); await jobs.finish(held, 'PASS');
  pending = await register(); retried = await register(); await claim(retried); await expire(retried); const retry = await claim(retried); await jobs.finish(retry, 'IMPORT_FAILED');
  other = await register('synthetic_other'); await claim(other); await expire(other);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: fixture.path }));
  await app.listen(0, '127.0.0.1'); origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
after(async () => {
  await app?.close(); await jobs?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('sync read requires its independent scope and server-generated uncached response context', async () => {
  for (const path of [url, url + '/' + retried.job_ref + '/attempts']) {
    const denied = await get(path, undefined, { 'x-request-id': 'SYNTHETIC_PRIVATE_VALUE' }); assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /^Bearer/); assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.notEqual(denied.headers.get('x-request-id'), 'SYNTHETIC_PRIVATE_VALUE');
    for (const scope of ['source:read', 'operations:read', 'audit:read']) assert.equal((await get(path, await fixture.token({ scope }))).status, 403);
    assert.equal((await get(path, await token())).status, 200);
  }
  for (const path of ['/v1/local/operations', '/v1/local/audit/events', '/v1/local/source/captures/' + complete.identity.capture_id + '/events']) assert.equal((await get(path, await token())).status, 403);
});

test('scoped live job pages preserve bigint IDs, pending unknown attempt and completed reconciliation separately', async () => {
  const first = await (await get(url + '?limit=1', await token())).json();
  assert.equal(first.pagination, 'live_committed_view'); assert.equal(first.items.length, 1); assert.equal(first.items[0].job_id, '9007199254740993');
  assert.equal(first.items[0].job_ref, complete.job_ref); assert.equal(first.items[0].status, 'reconciled');
  assert.equal(first.items[0].last_attempt.reconciliation_status, 'PASS'); assert.equal(first.items[0].last_attempt.import_completed, true);
  const second = await (await get(url + '?limit=1&after=' + first.next_cursor, await token())).json();
  assert.equal(second.items[0].job_ref, pending.job_ref); assert.equal(second.items[0].last_attempt, null); assert.equal(second.items[0].status, 'pending');
  const third = await (await get(url + '?limit=1&after=' + second.next_cursor, await token())).json();
  assert.equal(third.items[0].job_ref, retried.job_ref); assert.equal(third.items[0].status, 'failed'); assert.equal(third.next_cursor, null);
  const filtered = await (await get(url + '?capture_id=' + complete.identity.capture_id, await token())).json(); assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].job_ref, complete.job_ref);
  const text = JSON.stringify(filtered); for (const secret of ['snapshot_sha256', 'lease_token', 'semantic_key', 'fields', ...Object.values(state.passwords)]) assert.ok(!text.includes(secret));
});

test('expired lease is interrupted without claiming failure/success; workspace claims scope job and attempt queries', async () => {
  const response = await get(url, await token({ workspace_key: 'synthetic_other' }), { 'x-workspace-key': 'synthetic_local' });
  const page = await response.json(); assert.equal(page.items.length, 1); assert.equal(page.workspace_key, 'synthetic_other');
  assert.equal(page.items[0].status, 'running'); assert.equal(page.items[0].effective_status, 'interrupted');
  assert.equal(page.items[0].last_attempt.finished_at, null); assert.equal(page.items[0].last_attempt.reconciliation_status, null);
  for (const path of [url + '/' + other.job_ref + '/attempts', url + '?capture_id=' + other.identity.capture_id]) assert.deepEqual((await (await get(path, await token())).json()).items, []);
  assert.deepEqual((await (await get(url, await token({ workspace_key: 'synthetic_empty' }))).json()).items, []);
});

test('attempt history retains interrupted predecessor and bounded ascending retry pages without lease tokens', async () => {
  const path = url + '/' + retried.job_ref + '/attempts'; const access = await token();
  const first = await (await get(path + '?limit=1', access)).json(); assert.equal(first.items.length, 1); assert.equal(first.next_cursor, '1');
  assert.equal(first.items[0].status, 'interrupted'); assert.equal(first.items[0].error_code, 'LEASE_EXPIRED');
  const second = await (await get(path + '?limit=1&after=1', access)).json(); assert.equal(second.items[0].attempt_number, 2); assert.equal(second.next_cursor, null);
  assert.equal(second.items[0].status, 'failed'); assert.equal(second.items[0].error_code, 'STORAGE_FAILED');
  assert.ok(!JSON.stringify([first, second]).includes('lease_token')); assert.ok(!JSON.stringify([first, second]).includes(access));
});

test('sync rejects bad filters/cursors and write methods; OpenAPI/audit expose versioned typed job evidence', async () => {
  const access = await token();
  for (const suffix of ['?workspace_key=synthetic_other', '?limit=101', '?limit=0', '?after=01', '?after=-1', '?after=9223372036854775808', '?after=0&after=1', '?capture_id=SYNTHETIC_PRIVATE_VALUE', '?capture_id=' + randomUUID() + '&capture_id=' + randomUUID(), '?snapshot_sha256=anything', '?mode=live']) {
    const response = await get(url + suffix, access); assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
  assert.equal((await get(url + '/SYNTHETIC_PRIVATE_VALUE/attempts', access)).status, 400);
  assert.equal((await get(url + '/' + retried.job_ref + '/attempts?capture_id=' + randomUUID(), access)).status, 400);
  const document = await (await get('/openapi.json')).json();
  for (const path of [url, url + '/{job_ref}/attempts']) {
    assert.deepEqual(document.paths[path].get.security, [{ bearer: [] }]);
    for (const status of ['200', '400', '401', '403', '503']) assert.ok(document.paths[path].get.responses[status]);
  }
  assert.equal((await fetch(origin + url, { method: 'POST' })).status, 404);
  const audit = await (await get('/v1/local/audit/events?job_ref=' + complete.job_ref, await fixture.token({ scope: 'audit:read' }))).json();
  assert.equal(audit.items.length, 5); assert.ok(audit.items.every(row => row.schema_version === 2 && row.target_type === 'local_sync_job' && row.actor_type === 'service'));
  assert.deepEqual((await (await get('/v1/local/audit/events?intent_ref=' + complete.job_ref, await fixture.token({ scope: 'audit:read' }))).json()).items, []);
  assert.equal((await get('/v1/local/audit/events?job_ref=' + complete.job_ref + '&intent_ref=' + complete.job_ref, await fixture.token({ scope: 'audit:read' }))).status, 400);
});

test('database outage returns unavailable503 rather than empty jobs while liveness remains available', async () => {
  const access = await token(); await stopCluster(state);
  try {
    for (const path of [url, url + '/' + complete.job_ref + '/attempts']) {
      const response = await get(path, access); assert.equal(response.status, 503); const body = await response.text();
      assert.equal(JSON.parse(body).code, 'SYNC_UNAVAILABLE'); for (const secret of [...Object.values(state.passwords), access]) assert.ok(!body.includes(secret));
    }
    assert.equal((await get('/health/live')).status, 200); assert.equal((await get('/health/ready')).status, 503);
  } finally { await startCluster(state); }
  assert.equal((await get(url, access)).status, 200);
});
