import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions } from '@lmps/database';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { revision } from '../../../packages/database/test/fixtures/transaction-revision.mjs';

let temporary, state, owner, writer, app, fixture, origin;
const sample = revision(); const base = `/v1/local/transactions/${sample.transaction.source_reference.namespace}/${sample.transaction.transaction_id}/revisions`;
const get = (path, token, headers = {}) => fetch(origin + path, { headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });
const token = (changes = {}) => fixture.token({ scope: 'transactions:read', ...changes });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-transactions-http-'); fixture = await authFixture(temporary);
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  writer = createTransactionRevisions(dsn(state, 'intake')); owner = createDatabase(dsn(state, 'migration'), 'migration');
  for (let i = 0; i < 3; i++) {
    const value = revision(i); value.transaction.observed_at = `2026-10-${17 - i}T10:00:00Z`;
    if (i === 2) value.transaction.amount = '9999999999999999999999.99';
    await writer.append(value);
  }
  const other = revision(); other.workspace_key = 'synthetic_other'; other.transaction.correlation_id = 'synthetic_other_workspace_canary'; await writer.append(other);
  const namespaced = revision(); namespaced.transaction.source_reference.namespace = 'synthetic_other'; namespaced.transaction.correlation_id = 'synthetic_other_namespace_canary'; await writer.append(namespaced);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: fixture.path }));
  await app.listen(0, '127.0.0.1'); origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
after(async () => {
  await app?.close(); await writer?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('revision reads require an independent scope and preserve uncached server request context', async () => {
  for (const path of [base, base + '/latest']) {
    const denied = await get(path, null, { 'x-request-id': 'SYNTHETIC_PRIVATE_VALUE' });
    assert.equal(denied.status, 401); assert.match(denied.headers.get('www-authenticate'), /^Bearer/);
    assert.equal(denied.headers.get('cache-control'), 'no-store'); assert.notEqual(denied.headers.get('x-request-id'), 'SYNTHETIC_PRIVATE_VALUE');
    for (const scope of ['source:read', 'operations:read', 'audit:read', 'sync:read']) assert.equal((await get(path, await fixture.token({ scope }))).status, 403);
    assert.equal((await get(path, await token())).status, 200);
  }
  for (const path of ['/v1/local/sync/jobs', '/v1/local/audit/events', '/v1/local/operations']) assert.equal((await get(path, await token())).status, 403);
});

test('latest is published ordinal order with explicit unknown semantics, exact decimal strings and opaque IDs', async () => {
  const response = await get(base + '/latest', await token()); const page = await response.json();
  assert.equal(page.view, 'latest'); assert.equal(page.canonical_emission, false); assert.equal(page.source_semantics, 'unverified');
  assert.equal(page.items.length, 1); assert.equal(page.items[0].revision_number, 3); assert.equal(page.next_cursor, null);
  assert.equal(page.items[0].payload.transaction_id, '0009007199254740993');
  assert.equal(page.items[0].payload.amount, '9999999999999999999999.99');
  assert.equal(page.items[0].payload.observed_at, '2026-10-15T10:00:00Z');
  assert.equal(page.items[0].payload.transaction_status, 'unknown'); assert.equal(page.items[0].payload.occurred_at, null);
  assert.equal(page.items[0].payload.sender.status, 'unresolved');
  assert.match(page.items[0].recorded_at, /^\d{4}-\d{2}-\d{2}T.*\.\d{6}Z$/);
  assert.ok(!JSON.stringify(page).includes('canary')); assert.ok(!Object.hasOwn(page.items[0], 'recorded_by'));
});

test('bounded ascending history pages preserve immutable observations and expose no other workspace or namespace', async () => {
  const items = []; let cursor = '0';
  do {
    const page = await (await get(base + '?limit=1&after=' + cursor, await token())).json();
    assert.equal(page.pagination, 'live_committed_view'); assert.equal(page.view, 'history'); assert.equal(page.items.length, 1);
    items.push(...page.items); cursor = page.next_cursor;
  } while (cursor !== null);
  assert.deepEqual(items.map(row => row.revision_number), [1, 2, 3]);
  assert.equal(items[0].payload.amount, sample.transaction.amount);
  assert.ok(!JSON.stringify(items).includes('canary'));
  const empty = await (await get(base + '?after=2147483647', await token())).json(); assert.equal(empty.items.length, 0);
});

test('verified workspace is authoritative; unknown/foreign scope and leading-zero ID variants reveal no history', async () => {
  const other = await (await get(base, await token({ workspace_key: 'synthetic_other' }), { 'x-workspace-key': 'synthetic_local' })).json();
  assert.equal(other.items.length, 1); assert.equal(other.items[0].payload.correlation_id, 'synthetic_other_workspace_canary');
  for (const path of [base.replace(sample.transaction.transaction_id, '9007199254740993'), base.replace('synthetic_transactions', 'synthetic_missing')]) {
    for (const suffix of ['', '/latest']) assert.deepEqual((await (await get(path + suffix, await token())).json()).items, []);
  }
  assert.equal((await get(base + '?workspace_key=synthetic_other', await token())).status, 400);
});

test('query/path bounds reject overrides, duplicate parameters, unsafe IDs and mutations without echoing payloads', async () => {
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'after=-1', 'after=01', 'after=2147483648', 'after=0&after=1', 'after[]=1', 'order=desc']) {
    assert.equal((await get(base + '?' + query, await token())).status, 400);
  }
  assert.equal((await get(base + '/latest?limit=1', await token())).status, 400);
  assert.equal((await get(base.replace('synthetic_transactions', 'real_namespace'), await token())).status, 400);
  assert.equal((await get(base.replace(sample.transaction.transaction_id, 'SYNTHETIC%20PRIVATE'), await token())).status, 400);
  const response = await fetch(origin + base, { method: 'POST', headers: { authorization: 'Bearer ' + await token(), 'content-type': 'application/json' }, body: JSON.stringify({ account: 'SYNTHETIC_PRIVATE_VALUE' }) });
  assert.equal(response.status, 404); assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('OpenAPI exposes only scoped reads with explicit response and error contracts', async () => {
  const doc = await (await get('/openapi.json')).json();
  for (const suffix of ['', '/latest']) {
    const operation = doc.paths['/v1/local/transactions/{namespace}/{transaction_id}/revisions' + suffix].get;
    assert.ok(operation.security); assert.equal(operation.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/TransactionRevisionPage');
    for (const status of ['400', '401', '403', '503']) assert.ok(operation.responses[status]);
  }
  assert.deepEqual(doc.components.schemas.TransactionRevisionPage.properties.canonical_emission.enum, [false]);
});

test('corrupt stored contract data fails closed with a fixed response rather than leaking payloads', async () => {
  const original = (await owner.pool.query('SELECT payload FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=3',
    ['synthetic_local', sample.transaction.source_reference.namespace, sample.transaction.transaction_id])).rows[0].payload;
  try {
    await owner.pool.query("UPDATE platform.local_transaction_revisions SET payload=jsonb_set(payload,'{observed_at}',to_jsonb('SYNTHETIC_PRIVATE_VALUE'::text)) WHERE workspace_key='synthetic_local' AND revision_number=3");
    const response = await get(base + '/latest', await token()); assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
  } finally {
    await owner.pool.query("UPDATE platform.local_transaction_revisions SET payload=$1 WHERE workspace_key='synthetic_local' AND revision_number=3", [original]);
  }
});

test('database outage is redacted and recovery preserves history without changing readiness claims', async () => {
  await stopCluster(state);
  try {
    for (const suffix of ['', '/latest']) {
      const response = await get(base + suffix, await token()); assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { code: 'TRANSACTIONS_UNAVAILABLE', message: 'Local transaction observations are unavailable.' });
    }
  } finally { await startCluster(state); }
  assert.equal((await get(base, await token())).status, 200);
  assert.equal((await get('/health/ready')).status, 503);
});
