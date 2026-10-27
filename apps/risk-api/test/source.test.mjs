import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SignJWT, generateSecret } from 'jose';
import { createDatabase, createLocalOutbox, createSourceIntake } from '@lmps/database';
import { createApp } from '../dist/app.js';
import { loadLocalAuthenticator } from '../dist/local-auth.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';

let temporary, state, app, fixture, intake, origin, queue, owner;
const capture = randomUUID(); const generation = randomUUID();
const event = JSON.parse(await readFile(new URL('../../../packages/database/fixtures/source-event.json', import.meta.url), 'utf8'));
const path = `/v1/local/source/captures/${capture}/events`;
const get = (url, token, headers = {}) => fetch(origin + url, { headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-auth-'); fixture = await authFixture(temporary);
  state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  intake = createSourceIntake(dsn(state, 'intake'));
  queue = createLocalOutbox(dsn(state, 'outbox')); owner = createDatabase(dsn(state, 'migration'), 'migration');
  await owner.pool.query('ALTER SEQUENCE platform.audit_events_audit_id_seq RESTART WITH 9007199254740993');
  for (const [workspace, count] of [['synthetic_local', 1], ['synthetic_other', 2]]) for (let i = 0; i < count; i++) await queue.enqueue({ workspace_key: workspace, semantic_key: 'synthetic_ops_' + i, notification_ref: randomUUID(), expires_at: '2030-01-01T00:00:00.000Z' });
  for (let i = 1; i <= 3; i++) await intake.append({ ...event, source_namespace: 'synthetic_snapshot', workspace_key: 'synthetic_local', source_generation: generation,
    capture_epoch: capture, event_key: `transfer:${i}`, source_key: { ...event.source_key, id: String(i) }, operation: 'snapshot' });
  await intake.append({ ...event, source_namespace: 'synthetic_snapshot', workspace_key: 'synthetic_other', source_generation: generation, capture_epoch: capture, event_key: 'transfer:1', fields: { ...event.fields, result: 'OTHER_WORKSPACE_CANARY' } });
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: fixture.path }));
  await app.listen(0, '127.0.0.1'); origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
after(async () => {
  await app?.close(); await intake?.close(); await queue?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('source route requires a token; auth errors are fixed, uncached and carry a server-generated request ID', async () => {
  for (const authorization of [undefined, 'Bearer SYNTHETIC_PRIVATE_VALUE', 'Basic SYNTHETIC_PRIVATE_VALUE', 'Bearer a.b.c', 'Bearer ' + 'a'.repeat(5000)]) {
    const response = await get(path, null, { ...(authorization ? { authorization } : {}), 'x-request-id': 'SYNTHETIC_PRIVATE_VALUE' });
    assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('www-authenticate'), /^Bearer/);
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
});

test('valid access token reads scoped source events with exact decimal strings, opaque record reference and no account/source keys', async () => {
  const response = await get(path, await fixture.token()); assert.equal(response.status, 200);
  const page = await response.json(); assert.equal(page.items.length, 3); assert.equal(page.next_cursor, null);
  assert.equal(page.execution_mode, 'test'); assert.equal(page.provenance, 'local_synthetic');
  assert.equal(page.items[0].fields.amount, '123.45'); assert.equal(typeof page.items[0].event_id, 'string');
  assert.match(page.items[0].record_ref, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(page).includes('source_key')); assert.ok(!JSON.stringify(page).includes('account'));
  assert.ok(!JSON.stringify(page).includes('OTHER_WORKSPACE_CANARY'));
});

test('workspace comes only from verified token; query/header overrides cannot broaden source scope', async () => {
  const other = await get(path, await fixture.token({ workspace_key: 'synthetic_other' }), { 'x-workspace-key': 'synthetic_local' });
  const page = await other.json(); assert.equal(page.items.length, 1); assert.equal(page.items[0].fields.result, 'OTHER_WORKSPACE_CANARY');
  assert.equal((await get(path + '?workspace_key=synthetic_other', await fixture.token())).status, 400);
  assert.equal((await get(path, await fixture.token({ workspace_key: 'production_bank' }))).status, 403);
  assert.equal((await get(path, await fixture.token({ scope: 'rules:write' }))).status, 403);
});

test('pagination is bounded and uses full bigint text cursors without duplicate rows', async () => {
  const token = await fixture.token(); const first = await (await get(path + '?limit=2', token)).json();
  assert.equal(first.items.length, 2); assert.equal(first.next_cursor, first.items[1].event_id);
  const second = await (await get(path + '?limit=2&after=' + first.next_cursor, token)).json();
  assert.equal(second.items.length, 1); assert.equal(second.next_cursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.event_id)).size, 3);
  for (const suffix of ['?limit=0', '?limit=101', '?limit=1.5', '?limit=2&limit=3', '?after=-1', '?after=9223372036854775808', '?after=1.0', '?after=01', '?after=SYNTHETIC_PRIVATE_VALUE', '?mode=live']) {
    const response = await get(path + suffix, token); assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
  assert.equal((await get(path.replace(capture, 'SYNTHETIC_PRIVATE_VALUE'), token)).status, 400);
});

test('wrong signature/key/issuer/audience/type, expired/future/missing/overlong claims and symmetric substitution are rejected', async () => {
  const now = Math.floor(Date.now() / 1000);
  const otherDirectory = join(temporary, 'other'); await (await import('node:fs/promises')).mkdir(otherDirectory, { mode: 0o700 });
  const otherFixture = await authFixture(otherDirectory);
  const invalid = [await otherFixture.token(), await fixture.token({ iss: 'https://other.invalid' }), await fixture.token({ aud: 'other' }),
    await fixture.token({ exp: now - 1, iat: now - 60, nbf: now - 60 }), await fixture.token({ nbf: now + 60 }), await fixture.token({ iat: now + 60, exp: now + 120 }),
    await fixture.token({ iat: now, nbf: now, exp: now + 301 }), await fixture.token({ sub: null }), await fixture.token({ jti: null }), await fixture.token({ iat: null }),
    await fixture.token({}, { typ: 'JWT' }), await fixture.token({}, { kid: 'unknown' }), await fixture.token({}, { jku: 'https://attacker.invalid/keys' })];
  invalid.push(await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).sign(await generateSecret('HS256')));
  for (const token of invalid) assert.equal((await get(path, token)).status, 401);
});

test('public-key config fails closed on insecure/private/duplicate/corrupt/unowned configuration and key changes require reload', async () => {
  const original = await readFile(fixture.path);
  await chmod(fixture.path, 0o644);
  try { await assert.rejects(loadLocalAuthenticator(fixture.path), /Invalid private/); }
  finally { await chmod(fixture.path, 0o600); }
  const link = join(temporary, 'auth-link.json'); await symlink(fixture.path, link);
  await assert.rejects(loadLocalAuthenticator(link), /Invalid private/);
  const fifo = join(temporary, 'auth-fifo'); execFileSync('mkfifo', ['-m', '600', fifo]);
  await assert.rejects(loadLocalAuthenticator(fifo), /Invalid private/);
  for (const change of [c => { c.jwks.keys[0].d = 'PRIVATE_VALUE'; }, c => { c.jwks.keys.push(c.jwks.keys[0]); }, c => { c.issuer = 'https://real-idp.invalid'; }, c => { c.jwks.keys[0].x = 'bad'; }, c => { c.extra = true; }]) {
    const value = JSON.parse(original); change(value); await writeFile(fixture.path, JSON.stringify(value), { mode: 0o600 });
    await assert.rejects(loadLocalAuthenticator(fixture.path), /Invalid private/);
  }
  await writeFile(fixture.path, original, { mode: 0o600 });
  const loaded = await loadLocalAuthenticator(fixture.path);
  assert.equal((await loaded.verify('Bearer ' + await fixture.token())).workspace, 'synthetic_local');
  const directory = join(temporary, 'rotated'); await (await import('node:fs/promises')).mkdir(directory, { mode: 0o700 });
  const rotated = await authFixture(directory);
  await writeFile(fixture.path, JSON.stringify(rotated.config), { mode: 0o600 });
  try {
    assert.equal((await get(path, await rotated.token())).status, 401);
    assert.equal((await get(path, await fixture.token())).status, 200);
    const reloaded = await loadLocalAuthenticator(fixture.path);
    assert.equal((await reloaded.verify('Bearer ' + await rotated.token())).workspace, 'synthetic_local');
    await assert.rejects(reloaded.verify('Bearer ' + await fixture.token()), error => error.status === 401);
  } finally { await writeFile(fixture.path, original, { mode: 0o600 }); }
  await assert.rejects(createApp({ LMPS_LOCAL_AUTH_CONFIG: fixture.path }), /requires/);
});

test('outage returns a fixed503 after auth, leaves liveness available, and restart recovers scoped reads', async () => {
  const token = await fixture.token(); await stopCluster(state);
  try {
    const response = await get(path, token); assert.equal(response.status, 503);
    const body = await response.text(); assert.equal(JSON.parse(body).code, 'SOURCE_UNAVAILABLE');
    for (const secret of [...Object.values(state.passwords), token]) assert.ok(!body.includes(secret));
    assert.equal((await get('/health/live')).status, 200);
    const audit = await get('/v1/local/audit/events', await fixture.token({ scope: 'audit:read' }));
    assert.equal(audit.status, 503); assert.equal((await audit.json()).code, 'AUDIT_UNAVAILABLE');
    const operations = await get('/v1/local/operations', await fixture.token({ scope: 'operations:read' }));
    const status = await operations.json(); assert.equal(status.status, 'unavailable'); assert.equal(status.outbox, null);
  } finally { await startCluster(state); }
  assert.equal((await get(path, token)).status, 200);
});

test('operations endpoint requires its separate scope and reports only bounded current process pool and fake-workspace counts', async () => {
  assert.equal((await get('/v1/local/operations')).status, 401);
  assert.equal((await get('/v1/local/operations', await fixture.token())).status, 403);
  const token = await fixture.token({ scope: 'operations:read' });
  assert.equal((await get(path, token)).status, 403);
  const response = await get('/v1/local/operations', token); assert.equal(response.status, 200);
  const status = await response.json(); assert.equal(status.status, 'available');
  assert.deepEqual(status.outbox, { pending: 1, leased: 0, accepted: 0, expired: 0, dead: 0 });
  assert.equal(status.pool.limit, 4); assert.ok(status.pool.total <= 4); assert.ok(status.pool.idle <= status.pool.total);
  const text = JSON.stringify(status); for (const secret of [...Object.values(state.passwords), token]) assert.ok(!text.includes(secret));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('operations scope cannot select another workspace through query/header and preserves per-workspace counts', async () => {
  const token = await fixture.token({ scope: 'operations:read', workspace_key: 'synthetic_other' });
  const result = await (await get('/v1/local/operations', token, { 'x-workspace-key': 'synthetic_local' })).json();
  assert.equal(result.workspace_key, 'synthetic_other'); assert.equal(result.outbox.pending, 2);
  assert.equal((await get('/v1/local/operations?workspace_key=synthetic_local', token)).status, 400);
  const empty = await (await get('/v1/local/operations', await fixture.token({ scope: 'operations:read', workspace_key: 'synthetic_empty' }))).json();
  assert.equal(empty.status, 'available'); assert.equal(empty.outbox.pending, 0);
});

test('operations row limit reports unknown totals and OpenAPI describes the enabled read-only endpoint', async () => {
  await owner.pool.query("INSERT INTO platform.local_outbox_intents(workspace_key,semantic_key,notification_ref,expires_at) SELECT 'synthetic_overflow','synthetic_ops_'||n,gen_random_uuid(),now() FROM generate_series(1,1001) n");
  const response = await get('/v1/local/operations', await fixture.token({ scope: 'operations:read', workspace_key: 'synthetic_overflow' }));
  const status = await response.json(); assert.equal(status.status, 'limit_exceeded'); assert.equal(status.outbox, null);
  const document = await (await get('/openapi.json')).json(); assert.deepEqual(document.paths['/v1/local/operations'].get.security, [{ bearer: [] }]);
  assert.equal((await fetch(origin + '/v1/local/operations', { method: 'POST' })).status, 404);
});

test('OpenAPI advertises only enabled scoped read route with bearer auth and readiness stays503', async () => {
  const document = await (await get('/openapi.json')).json();
  const route = document.paths['/v1/local/source/captures/{capture_id}/events'].get;
  assert.deepEqual(route.security, [{ bearer: [] }]);
  for (const status of ['200', '400', '401', '403', '503']) assert.ok(route.responses[status]);
  assert.equal((await get('/health/ready')).status, 503);
  assert.equal((await fetch(origin + path, { method: 'POST' })).status, 404);
});


test('audit route has an independent scope and returns exact string IDs, approved metadata and no notification payload', async () => {
  const url = '/v1/local/audit/events';
  assert.equal((await get(url)).status, 401);
  for (const scope of ['source:read', 'operations:read', 'rules:write']) assert.equal((await get(url, await fixture.token({ scope }))).status, 403);
  const token = await fixture.token({ scope: 'audit:read' });
  assert.equal((await get(path, token)).status, 403); assert.equal((await get('/v1/local/operations', token)).status, 403);
  const response = await get(url, token, { 'x-request-id': 'SYNTHETIC_PRIVATE_VALUE' }); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.notEqual(response.headers.get('x-request-id'), 'SYNTHETIC_PRIVATE_VALUE');
  const page = await response.json(); assert.equal(page.items.length, 1); assert.equal(page.pagination, 'live_committed_view');
  const row = page.items[0]; assert.equal(row.audit_id, '9007199254740993'); assert.equal(row.correlation_id, row.target_ref);
  assert.equal(row.actor_role, 'lmps_outbox'); assert.equal(row.actor_type, 'service'); assert.equal(row.action, 'outbox.intent_created');
  assert.match(row.occurred_at, /^\d{4}-\d{2}-\d{2}T.*\.\d{6}Z$/); assert.equal(row.schema_version, 1);
  const text = JSON.stringify(page);
  for (const forbidden of ['semantic_key', 'notification_ref', 'lease_token', 'account', ...Object.values(state.passwords), token]) assert.ok(!text.includes(forbidden));
});

test('audit pagination and target filters are bounded, workspace scoped and reject client scope overrides', async () => {
  const token = await fixture.token({ scope: 'audit:read', workspace_key: 'synthetic_other' });
  const first = await (await get('/v1/local/audit/events?limit=1', token, { 'x-workspace-key': 'synthetic_local' })).json();
  assert.equal(first.workspace_key, 'synthetic_other'); assert.equal(first.items.length, 1); assert.equal(first.next_cursor, first.items[0].audit_id);
  const second = await (await get('/v1/local/audit/events?limit=1&after=' + first.next_cursor, token)).json();
  assert.equal(second.items.length, 1); assert.equal(second.next_cursor, null); assert.ok(BigInt(second.items[0].audit_id) > BigInt(first.next_cursor));
  const filtered = await (await get('/v1/local/audit/events?intent_ref=' + first.items[0].target_ref, token)).json();
  assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0].event_ref, first.items[0].event_ref);
  const otherWorkspace = await (await get('/v1/local/audit/events?intent_ref=' + first.items[0].target_ref, await fixture.token({ scope: 'audit:read' }))).json();
  assert.deepEqual(otherWorkspace.items, []);
  const empty = await (await get('/v1/local/audit/events', await fixture.token({ scope: 'audit:read', workspace_key: 'synthetic_empty' }))).json();
  assert.deepEqual(empty.items, []); assert.equal(empty.next_cursor, null);
});

test('audit rejects invalid/duplicate/unbounded queries without echoing values, and OpenAPI describes read-only scope', async () => {
  const url = '/v1/local/audit/events'; const token = await fixture.token({ scope: 'audit:read' });
  for (const query of ['?workspace_key=synthetic_other', '?limit=0', '?limit=101', '?limit=1&limit=2', '?after=01', '?after=-1', '?after=9223372036854775808', '?after=0&after=1', '?intent_ref=SYNTHETIC_PRIVATE_VALUE', '?intent_ref=' + randomUUID() + '&intent_ref=' + randomUUID(), '?actor_role=lmps_migrator', '?mode=live']) {
    const response = await get(url + query, token); assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
  const document = await (await get('/openapi.json')).json(); const route = document.paths[url].get;
  assert.deepEqual(route.security, [{ bearer: [] }]); for (const status of ['200', '400', '401', '403', '503']) assert.ok(route.responses[status]);
  assert.equal((await fetch(origin + url, { method: 'POST' })).status, 404);
  assert.equal((await get('/health/ready')).status, 503);
});
