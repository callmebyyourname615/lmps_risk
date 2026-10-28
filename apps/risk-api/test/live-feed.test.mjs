import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { detectionFixture } from './fixtures/detection.mjs';
let fixture;
before(async () => { fixture = await detectionFixture(); await fixture.approve(); await fixture.template(); await fixture.handoff.work(); });
after(async () => { await fixture?.close(); });
async function request(path = '/feed', changes = {}) {
  return fixture.app.inject({ method: 'GET', url: '/v1/local/monitoring' + path, headers: { authorization: 'Bearer ' + await fixture.token(changes) } });
}
test('feed reads actual latest revisions, frozen assessments and alerts with shared monitoring totals', async () => {
  const response = await request(); assert.equal(response.statusCode, 200);
  const value = response.json(), summary = (await request('/summary')).json();
  assert.equal(value.version, 'local-monitoring-feed-1'); assert.deepEqual(value.summary.counts, summary.counts);
  assert.equal(value.rows.filter(row => row.kind === 'transaction').length, summary.counts.transactions);
  assert.equal(value.rows.filter(row => row.kind === 'alert').length, summary.counts.alerts);
  assert.equal(value.rows[0].risk.status, 'partial'); assert.equal(value.summary.availability.source_lag_seconds, null);
  const before = (await fixture.owner.pool.query('SELECT job_ref,input_sha256,status,attempt_number FROM platform.local_risk_jobs ORDER BY job_ref')).rows;
  for (let index = 0; index < 3; index++) assert.equal((await request()).statusCode, 200);
  assert.deepEqual((await fixture.owner.pool.query('SELECT job_ref,input_sha256,status,attempt_number FROM platform.local_risk_jobs ORDER BY job_ref')).rows, before);
});
test('polling never consumes pinned Overview/Network snapshot cache capacity', async () => {
  const snapshot = (await request('/snapshots')).json();
  for (let index = 0; index < 8; index++) assert.equal((await request()).statusCode, 200);
  assert.equal((await request('/snapshots/' + snapshot.snapshot_id)).statusCode, 200);
});
test('reader scope, workspace isolation, repeated filters and unsupported cursor controls are enforced', async () => {
  assert.equal((await request('/feed', { scope: 'transactions:read risk:read' })).statusCode, 403);
  const foreign = (await request('/feed', { workspace_key: 'synthetic_other' })).json(); assert.equal(foreign.rows.length, 0);
  for (const query of ['currency=SYN&currency=USD', 'after=anything', 'workspace_key=synthetic_other', 'namespace=../../escape']) assert.equal((await request('/feed?' + query)).statusCode, 400);
  const scoped = (await request('/feed?namespace=' + fixture.selection.namespace + '&currency=SYN')).json(); assert.equal(scoped.summary.filters.currency, 'SYN'); assert.ok(scoped.rows.every(row => row.currency === 'SYN'));
});
test('recording a new revision changes only subsequent feed reads and preserves prior results', async () => {
  const before = (await request()).json(), transaction = before.rows.find(row => row.kind === 'transaction');
  await fixture.append(transaction.transaction_id, 1);
  const after = (await request()).json(); assert.equal(after.summary.counts.not_assessed, 1); assert.equal(after.summary.counts.alerts, 0);
  assert.equal(after.rows[0].revision_number, 2); assert.equal(before.rows[0].revision_number, 1);
  assert.equal(await fixture.handoff.handoff(), 1); await fixture.handoff.work();
  assert.equal((await request()).json().rows[0].risk.status, 'partial');
});
test('storage outage is explicit, fixed and recoverable', async () => {
  await fixture.stopDatabase();
  try { const response = await request(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'MONITORING_UNAVAILABLE'); assert.equal(response.json().rows, undefined); }
  finally { await fixture.startDatabase(); }
  assert.equal((await request()).statusCode, 200);
});
test('oversized scopes fail without publishing partial feed rows or totals', async () => {
  const value = await fixture.append('synthetic_bound_seed', 0, false);
  await fixture.owner.pool.query(`INSERT INTO platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number,payload,publication)
    SELECT 'synthetic_local',$1,'synthetic_bulk_'||number,1,jsonb_set($2::jsonb,'{transaction_id}',to_jsonb('synthetic_bulk_'||number)),NULL FROM generate_series(1,500) number`, [fixture.selection.namespace, JSON.stringify(value.transaction)]);
  const response = await request(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'MONITORING_SCOPE_TOO_LARGE'); assert.equal(response.json().rows, undefined);
});
