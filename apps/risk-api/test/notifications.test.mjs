import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { notificationsFixture } from './fixtures/notifications.mjs';
import { createApp } from '../dist/app.js';
let f;
before(async () => { f = await notificationsFixture(); });
after(async () => { await f?.close(); });
const root = '/v1/local/notifications';
const get = async (path = root, claims = {}) => f.app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer ' + await f.token(claims) } });
const keys = value => Object.keys(value).sort();
const commonKeys = ['provenance', 'execution_mode', 'provider', 'delivery_semantics', 'workspace_key', 'as_of'];
function common(response, workspace = f.workspace) {
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers['cache-control'], 'no-store');
  const v = response.json();
  assert.equal(v.provenance, 'local_synthetic'); assert.equal(v.execution_mode, 'test'); assert.equal(v.provider, 'fake');
  assert.equal(v.delivery_semantics, 'fake_provider_only'); assert.equal(v.workspace_key, workspace);
  assert.match(v.as_of, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  for (const secret of f.secrets) assert.ok(!response.body.includes(secret), 'Private outbox fields must not escape');
  for (const name of ['semantic_key', 'lease_token', 'recipient', 'device', 'payload', 'alert_id']) assert.ok(!response.body.includes('"' + name + '"'));
  return v;
}
async function invalid(path, claims) {
  const response = await get(path, claims); assert.equal(response.statusCode, 400, path);
  assert.deepEqual(response.json(), { code: 'INVALID_QUERY', message: 'Invalid local notification query.' });
}
test('list projects exact stored state, server-clock expiry and no private payload fields', async () => {
  const v = common(await get(root + '?limit=100'));
  assert.deepEqual(keys(v), [...commonKeys, 'pagination', 'filters', 'items', 'next_cursor'].sort());
  assert.equal(v.pagination, 'live_committed_view_uuid_order'); assert.deepEqual(v.filters, { state: null, notification_ref: null });
  assert.equal(v.items.length, 37); assert.equal(v.next_cursor, null);
  assert.deepEqual(v.items.map(i => i.intent_ref), f.entries.map(i => i.intent_ref));
  for (const item of v.items) {
    assert.deepEqual(keys(item), ['intent_ref', 'notification_ref', 'state', 'attempt_count', 'created_at', 'available_at', 'expires_at', 'lease_until', 'is_expired', 'lease_expired'].sort());
    assert.equal(item.state, f.entries.find(i => i.intent_ref === item.intent_ref).state);
    assert.equal(item.is_expired, item.expires_at <= v.as_of);
    assert.equal(item.lease_expired, item.lease_until !== null && item.lease_until <= v.as_of);
  }
  assert.equal(v.items.find(i => i.intent_ref === f.overdue.intent_ref).state, 'pending');
  assert.equal(v.items.find(i => i.intent_ref === f.overdue.intent_ref).is_expired, true);
  assert.equal(v.items.find(i => i.intent_ref === f.stale.intent_ref).lease_expired, true);
  assert.equal(v.items.find(i => i.intent_ref === f.leased.intent_ref).lease_expired, false);
});
test('default 25-row page and changing page sizes traverse UUID order without omissions', async () => {
  const first = common(await get()); assert.equal(first.items.length, 25); assert.equal(typeof first.next_cursor, 'string');
  const all = [...first.items]; let cursor = first.next_cursor;
  while (cursor) { const next = common(await get(root + '?limit=7&after=' + cursor)); all.push(...next.items); cursor = next.next_cursor; }
  assert.deepEqual(all.map(i => i.intent_ref), f.entries.map(i => i.intent_ref));
});
test('every stored-state and exact notification filter is workspace-bound, including combinations', async () => {
  for (const state of ['pending', 'leased', 'accepted', 'expired', 'dead']) {
    const v = common(await get(root + '?limit=100&state=' + state));
    assert.deepEqual(v.items.map(i => i.intent_ref), f.entries.filter(i => i.state === state).map(i => i.intent_ref));
  }
  const path = root + '?notification_ref=' + f.sharedReference;
  const v = common(await get(path)); assert.equal(v.items.length, 10);
  assert.equal(common(await get(path + '&state=accepted')).items.length, 0);
  const foreign = common(await get(path, { workspace_key: 'synthetic_other' }), 'synthetic_other');
  assert.deepEqual(foreign.items.map(i => i.intent_ref), [f.foreign.intent_ref]);
  const empty = common(await get(root, { workspace_key: 'synthetic_empty' }), 'synthetic_empty');
  assert.deepEqual(empty.items, []); assert.equal(empty.next_cursor, null);
});
test('detail equals list projection, unknown and foreign IDs are indistinguishable and attempts stay scoped', async () => {
  const list = common(await get(root + '?limit=100'));
  for (const row of list.items) {
    const detail = common(await get(root + '/' + row.intent_ref));
    assert.deepEqual(keys(detail), [...commonKeys, 'intent'].sort()); assert.deepEqual(detail.intent, row);
  }
  for (const id of [randomUUID(), f.foreign.intent_ref]) {
    assert.equal(common(await get(root + '/' + id)).intent, null);
    const attempts = common(await get(root + '/' + id + '/attempts')); assert.deepEqual(attempts.items, []); assert.equal(attempts.next_cursor, null);
  }
  assert.deepEqual(common(await get(root + '/' + f.overdue.intent_ref + '/attempts')).items, []);
});
test('attempts preserve bigint IDs, retry order, unknown unfinished evidence and independent pagination', async () => {
  const path = root + '/' + f.chain.intent_ref + '/attempts', rows = []; let cursor = null;
  do {
    const v = common(await get(path + '?limit=1' + (cursor ? '&after=' + cursor : '')));
    assert.deepEqual(keys(v), [...commonKeys, 'intent_ref', 'pagination', 'items', 'next_cursor'].sort());
    assert.equal(v.intent_ref, f.chain.intent_ref); assert.equal(v.pagination, 'live_committed_view_attempt_number_order');
    rows.push(...v.items); cursor = v.next_cursor;
  } while (cursor);
  assert.deepEqual(rows.map(a => a.attempt_number), [1, 2, 3]); assert.deepEqual(rows.map(a => a.outcome), ['retry', 'retry', 'accepted']);
  const stored = (await f.owner.pool.query('SELECT attempt_id::text FROM platform.local_outbox_attempts WHERE intent_ref=$1 ORDER BY attempt_number', [f.chain.intent_ref])).rows;
  assert.deepEqual(rows.map(a => a.attempt_id), stored.map(a => a.attempt_id));
  for (const row of rows) { assert.ok(BigInt(row.attempt_id) > BigInt(Number.MAX_SAFE_INTEGER)); assert.equal(typeof row.finished_at, 'string'); assert.deepEqual(keys(row), ['attempt_id', 'attempt_number', 'outcome', 'claimed_at', 'finished_at'].sort()); }
  const unknown = common(await get(root + '/' + f.stale.intent_ref + '/attempts')).items[0];
  assert.equal(unknown.outcome, 'unknown'); assert.equal(unknown.finished_at, null);
});
test('cursors reject workspace, filter, resource, intent and noncanonical substitutions', async () => {
  const cursor = common(await get(root + '?limit=1')).next_cursor;
  const attemptsPath = root + '/' + f.chain.intent_ref + '/attempts';
  const attemptCursor = common(await get(attemptsPath + '?limit=1')).next_cursor;
  await invalid(root + '?after=' + cursor, { workspace_key: 'synthetic_other' });
  await invalid(root + '?state=pending&after=' + cursor); await invalid(root + '?notification_ref=' + f.sharedReference + '&after=' + cursor);
  const filteredCursor = common(await get(root + '?notification_ref=' + f.sharedReference + '&limit=1')).next_cursor;
  await invalid(root + '?after=' + filteredCursor);
  await invalid(attemptsPath + '?after=' + cursor); await invalid(root + '?after=' + attemptCursor);
  await invalid(root + '/' + f.accepted.intent_ref + '/attempts?after=' + attemptCursor);
  await invalid(attemptsPath + '?after=' + attemptCursor, { workspace_key: 'synthetic_other' });
  for (const value of ['', '!', cursor + '=', 'a'.repeat(1025), Buffer.from('[1,"notifications"] ').toString('base64url')]) await invalid(root + '?after=' + encodeURIComponent(value));
  const wrongTail = Buffer.from(JSON.stringify([1, 'notification_attempts', f.workspace, f.chain.intent_ref, 4])).toString('base64url');
  await invalid(attemptsPath + '?after=' + wrongTail);
});
test('query and path validation rejects repeated, unknown, blank and noncanonical values', async () => {
  for (const query of ['workspace_key=synthetic_other', 'workspace=synthetic_other', 'limit=0', 'limit=101', 'limit=01', 'limit=1.0', 'limit=-1', 'limit=', 'limit=1&limit=2', 'state=', 'state=sent', 'state=pending&state=pending', 'notification_ref=', 'notification_ref=' + f.sharedReference + '&notification_ref=' + f.sharedReference, 'notification_ref=00000000-0000-0000-0000-000000000000', 'after=a&after=b']) await invalid(root + '?' + query);
  await invalid(root + '/bad'); await invalid(root + '/bad/attempts');
  await invalid(root + '/' + f.accepted.intent_ref + '?limit=1');
  for (const query of ['state=pending', 'limit=01', 'limit=101', 'limit=1&limit=2', 'after=a&after=b']) await invalid(root + '/' + f.chain.intent_ref + '/attempts?' + query);
});
test('all routes enforce verified scopes and expiry before disclosure; Audit is independently scoped', async () => {
  for (const path of [root, root + '/' + f.chain.intent_ref, root + '/' + f.chain.intent_ref + '/attempts']) {
    assert.equal((await f.app.inject({ method: 'GET', url: path })).statusCode, 401);
    assert.equal((await get(path, { exp: Math.floor(Date.now() / 1000) - 5 })).statusCode, 401);
    const denied = await get(path, { scope: 'audit:read' }); assert.equal(denied.statusCode, 403); assert.equal(denied.json().code, 'FORBIDDEN');
  }
  const path = '/v1/local/audit/events?intent_ref=' + f.chain.intent_ref;
  assert.equal((await get(path)).statusCode, 403);
  assert.equal((await get(path, { scope: 'audit:read' })).statusCode, 200);
});
test('OpenAPI advertises the three GET projections with no business write routes', async () => {
  const doc = (await f.app.inject({ method: 'GET', url: '/openapi.json' })).json();
  for (const path of [root, root + '/{intent_ref}', root + '/{intent_ref}/attempts']) {
    assert.deepEqual(Object.keys(doc.paths[path]), ['get']); assert.deepEqual(doc.paths[path].get.security, [{ bearer: [] }]);
    for (const status of ['200', '400', '401', '403', '503']) assert.ok(doc.paths[path].get.responses[status]);
  }
  assert.equal(doc.components.schemas.AttemptView.properties.attempt_id.type, 'string');
  for (const path of [root, root + '/' + f.chain.intent_ref, root + '/' + f.chain.intent_ref + '/attempts']) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await f.app.inject({ method, url: path })).statusCode, 404);
});
test('invalid stored projections fail closed with fixed errors, then recover', async () => {
  const path = root + '/' + f.accepted.intent_ref;
  await f.owner.pool.query("UPDATE platform.local_outbox_intents SET notification_ref='00000000-0000-0000-0000-000000000000' WHERE intent_ref=$1", [f.accepted.intent_ref]);
  try { for (const target of [path, root + '?limit=100']) { const r = await get(target); assert.equal(r.statusCode, 503); assert.deepEqual(r.json(), { code: 'NOTIFICATIONS_UNAVAILABLE', message: 'Local notification evidence is unavailable.' }); } }
  finally { await f.owner.pool.query('UPDATE platform.local_outbox_intents SET notification_ref=$2 WHERE intent_ref=$1', [f.accepted.intent_ref, f.accepted.notification_ref]); }
  const saved = (await f.owner.pool.query(`SELECT to_char(claimed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS claimed_at FROM platform.local_outbox_attempts WHERE intent_ref=$1`, [f.accepted.intent_ref])).rows[0].claimed_at;
  await f.owner.pool.query("UPDATE platform.local_outbox_attempts SET claimed_at='infinity' WHERE intent_ref=$1", [f.accepted.intent_ref]);
  try { const r = await get(path + '/attempts'); assert.equal(r.statusCode, 503); assert.equal(r.json().code, 'NOTIFICATIONS_UNAVAILABLE'); }
  finally { await f.owner.pool.query('UPDATE platform.local_outbox_attempts SET claimed_at=$2 WHERE intent_ref=$1', [f.accepted.intent_ref, saved]); }
  common(await get(path));
});
test('startup rejects authenticated mode without storage; actual PostgreSQL outage returns redacted503', async () => {
  await assert.rejects(createApp({ LMPS_ENVIRONMENT: 'test', LMPS_LOCAL_AUTH_CONFIG: f.auth.path }), /requires an absolute private config path and app database/);
  await f.stopDatabase();
  try {
    for (const path of [root, root + '/' + f.chain.intent_ref, root + '/' + f.chain.intent_ref + '/attempts']) {
      const r = await get(path); assert.equal(r.statusCode, 503); assert.deepEqual(r.json(), { code: 'NOTIFICATIONS_UNAVAILABLE', message: 'Local notification evidence is unavailable.' });
    }
  } finally { await f.startDatabase(); }
  assert.equal(common(await get(root + '?limit=100')).items.length, 37);
});
test('reads leave every stored intent, attempt and audit row byte-for-byte equivalent', async () => {
  assert.deepEqual(await f.fingerprint(), f.baseline);
});
