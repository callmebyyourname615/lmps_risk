import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { overviewFixture } from './fixtures/overview.mjs';
import { MonitoringSnapshots } from '../dist/monitoring-snapshots.js';
import { readMonitoringSnapshot } from '@lmps/database';
import { parseMonitoringFilters } from '@lmps/contracts/monitoring';
import { revision } from '../../../packages/database/test/fixtures/transaction-revision.mjs';
let fixture;
before(async () => { fixture = await overviewFixture(); });
after(async () => { await fixture?.close(); });
const get = async (path, claims = {}) => fixture.app.inject({ method: 'GET', url: '/v1/local/monitoring/' + path, headers: { authorization: 'Bearer ' + await fixture.token(claims) } });
async function capture(query = '') { const response = await get('snapshots' + query); assert.equal(response.statusCode, 200); return response.json(); }
test('trends publish the exact pinned latest rows and original Alerts without raw evidence, duplicate assessment runs or extra snapshot allocations', async () => {
  const saved = await capture(), response = await get(`snapshots/${saved.snapshot_id}/trends`); assert.equal(response.statusCode, 200);
  const value = response.json(); assert.equal(value.version, 'local-monitoring-trends-1'); assert.deepEqual(value.summary, saved.summary);
  assert.deepEqual(Object.keys(value).sort(), ['expires_at', 'rows', 'snapshot_id', 'summary', 'version']);
  assert.equal(value.rows.filter(row => row.kind === 'transaction').length, 48); assert.equal(value.rows.filter(row => row.kind === 'alert').length, 6);
  const targets = value.rows.filter(row => row.kind === 'transaction').map(row => JSON.stringify([row.namespace, row.transaction_id])); assert.equal(new Set(targets).size, 48);
  const page = (await get(`snapshots/${saved.snapshot_id}/records?mode=transactions&limit=50`)).json();
  assert.deepEqual(new Set(value.rows.filter(row => row.kind === 'transaction').map(row => row.record_key)), new Set(page.rows.map(row => row.record_key)));
  for (let index = 0; index < 6; index++) assert.deepEqual((await get(`snapshots/${saved.snapshot_id}/trends`)).json(), value);
  const first = value.rows.find(row => row.kind === 'transaction'), evidence = await get(`snapshots/${saved.snapshot_id}/evidence?record=${first.record_key}`); assert.equal(evidence.statusCode, 200);
});
test('scopes, principal/workspace binding, strict snapshot IDs and unsupported query coordinates fail closed', async () => {
  const saved = await capture(), path = `snapshots/${saved.snapshot_id}/trends`;
  for (const scope of ['transactions:read', 'risk:read', 'alerts:read']) assert.equal((await get(path, { scope: ['transactions:read', 'risk:read', 'alerts:read'].filter(value => value !== scope).join(' ') })).statusCode, 403);
  for (const changes of [{ sub: 'synthetic_other_reader' }, { workspace_key: 'synthetic_other' }]) {
    const response = await get(path, changes); assert.equal(response.statusCode, 410); assert.equal(response.json().rows, undefined);
  }
  for (const query of ['?timezone=UTC', '?workspace_key=synthetic_other', '?bucket=one&bucket=two']) assert.equal((await get(path + query)).statusCode, 400);
  assert.equal((await get('snapshots/bad/trends')).statusCode, 400);
  assert.equal((await fixture.app.inject({ method: 'GET', url: '/v1/local/monitoring/' + path })).statusCode, 401);
});
test('a new revision never mutates prior heatmap inputs; cached evidence remains available during an outage while a fresh capture fails', async () => {
  const saved = await capture(), path = `snapshots/${saved.snapshot_id}/trends`, original = (await get(path)).json();
  const value = revision(); value.transaction.transaction_id = 'synthetic_trends_new'; await fixture.writer.append(value);
  assert.deepEqual((await get(path)).json(), original);
  const next = await capture(); assert.equal(next.summary.counts.transactions, original.summary.counts.transactions + 1);
  await fixture.stopDatabase();
  try { assert.deepEqual((await get(path)).json(), original); const failure = await get('snapshots'); assert.equal(failure.statusCode, 503); assert.equal(failure.json().rows, undefined); }
  finally { await fixture.startDatabase(); }
});
test('timezone and empty scopes survive unchanged; expiry and response size limits do not substitute partial rows', async () => {
  const empty = await capture('?currency=XXX&timezone=UTC'), value = (await get(`snapshots/${empty.snapshot_id}/trends`)).json();
  assert.deepEqual(value.rows, []); assert.equal(value.summary.filters.timezone, 'UTC'); assert.equal(value.summary.counts.transactions, 0);
  let now = Date.now(); const cache = new MonitoringSnapshots(() => now, 1000), principal = { workspace: 'synthetic_local', subject: 'synthetic_reader' };
  const payload = await readMonitoringSnapshot(fixture.owner.pool, principal.workspace, parseMonitoringFilters({})), saved = cache.create(principal, payload);
  now += 1001; assert.throws(() => cache.trends(principal, saved.snapshot_id), error => error.getStatus() === 410);
  const large = structuredClone(payload); large.transactions = Array.from({ length: 500 }, () => ({ ...payload.transactions[0], transaction_id: 'synthetic_' + 'x'.repeat(4500) }));
  const oversized = cache.create(principal, large); assert.throws(() => cache.trends(principal, oversized.snapshot_id), error => error.code === 'MONITORING_SCOPE_TOO_LARGE');
});
