import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { overviewFixture } from './fixtures/overview.mjs';
import { MonitoringSnapshots } from '../dist/monitoring-snapshots.js';
import { readMonitoringSnapshot } from '@lmps/database';
import { parseMonitoringFilters } from '@lmps/contracts/monitoring';
let f;
const scopes = 'transactions:read risk:read alerts:read';
before(async () => { f = await overviewFixture(); });
after(async () => { await f?.close(); });
const get = async (path, claims = {}) => f.app.inject({ method: 'GET', url: '/v1/local/monitoring/' + path, headers: { authorization: 'Bearer ' + await f.token({ scope: scopes, ...claims }) } });
async function capture(query = '') { const response = await get('snapshots' + query); assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function page(id, query = '') { const response = await get('snapshots/' + id + '/records' + query); assert.equal(response.statusCode, 200, response.body); return response.json(); }
test('each KPI drills into exactly its frozen records without Case or reviewer scopes', async () => {
  const s = await capture(); assert.equal(s.version, 'local-monitoring-records-1');
  assert.deepEqual(s.summary.counts, { transactions: 48, assessed: 6, not_assessed: 42, flagged: 6, alerts: 6 });
  for (const mode of ['transactions', 'assessed', 'not_assessed', 'flagged', 'alerts']) {
    const p = await page(s.snapshot_id, '?mode=' + mode + '&limit=50'); assert.equal(p.total, s.summary.counts[mode]); assert.equal(p.scope_total, p.total);
    assert.equal(p.rows.length, p.total); assert.deepEqual(p.summary, s.summary); assert.equal(p.snapshot_id, s.snapshot_id);
    if (mode === 'flagged') assert.ok(p.rows.every(row => row.risk.patterns.length));
    if (mode === 'not_assessed') assert.ok(p.rows.every(row => row.risk === null));
    if (mode === 'alerts') assert.ok(p.rows.every(row => row.alert_id && row.kind === 'alert'));
  }
});
test('cursor pages have no duplicate/missing identities and literal search does not change scope totals', async () => {
  const s = await capture(), rows = []; let next = '', pages = 0;
  do { const p = await page(s.snapshot_id, '?sort=id_asc&limit=10' + (next ? '&after=' + encodeURIComponent(next) : '')); rows.push(...p.rows); next = p.next_cursor; pages++; }
  while (next);
  assert.equal(pages, 5); assert.equal(rows.length, 48); assert.equal(new Set(rows.map(r => r.record_key)).size, 48);
  assert.deepEqual(rows.map(r => r.transaction_id), rows.map(r => r.transaction_id).toSorted());
  for (const q of ['001', 'synthetic_overview', 'FRAUD', 'DOES_NOT_EXIST']) {
    const p = await page(s.snapshot_id, '?q=' + q + '&limit=50');
    assert.equal(p.scope_total, 48); assert.equal(p.total, rows.filter(row => [row.transaction_id, row.namespace, ...(row.risk?.patterns ?? [])].some(value => value.includes(q))).length);
  }
  assert.ok(rows.some(row => row.transaction_id === '001')); assert.ok(rows.some(row => row.transaction_id === '1'));
});
test('amount sort is exact and grouped by currency; identifiers retain leading zeroes', async () => {
  const s = await capture(), p = await page(s.snapshot_id, '?sort=amount_asc&limit=50');
  let previous;
  for (const row of p.rows) {
    assert.equal(typeof row.amount, 'string');
    if (previous) {
      assert.ok(previous.currency <= row.currency);
      if (previous.currency === row.currency) {
        const [ai, af = ''] = previous.amount.split('.'), [bi, bf = ''] = row.amount.split('.'), digits = Math.max(af.length, bf.length);
        assert.ok(BigInt(ai + af.padEnd(digits, '0')) <= BigInt(bi + bf.padEnd(digits, '0')));
      }
    }
    previous = row;
  }
  assert.ok(p.rows.some(row => row.amount === '9999999999999999999999.99'));
});
test('evidence pins the revision and exact assessment hash, preserving source/window limitations', async () => {
  const s = await capture(), p = await page(s.snapshot_id, '?mode=flagged&limit=50');
  for (const row of p.rows) {
    const response = await get(`snapshots/${s.snapshot_id}/evidence?record=${row.record_key}`); assert.equal(response.statusCode, 200, response.body);
    const e = response.json().evidence; assert.deepEqual(e.record, row); assert.equal(e.window.seconds, 3600); assert.equal(e.window.coverage_complete, true);
    const raw = await f.app.inject({ method: 'GET', url: '/v1/local/risk-assessments/' + row.risk.run_id, headers: { authorization: 'Bearer ' + await f.token({ scope: scopes }) } });
    assert.equal(raw.statusCode, 200); assert.equal(raw.json().core_sha256, row.risk.core_sha256); assert.equal(raw.json().assessment.revision_sha256, e.revision_sha256);
    assert.ok(e.source.snapshot_sha256); assert.equal(Object.hasOwn(e, 'sender'), false); assert.ok(!JSON.stringify(e).includes('flagged_accounts'));
  }
  const alerts = await page(s.snapshot_id, '?mode=alerts&limit=50'), transactions = await page(s.snapshot_id, '?limit=50');
  for (const row of alerts.rows) {
    const e = (await get(`snapshots/${s.snapshot_id}/evidence?record=${row.record_key}`)).json().evidence;
    const tx = transactions.rows.find(tx => tx.namespace === row.namespace && tx.transaction_id === row.transaction_id);
    assert.equal(e.revision_recorded_at, tx.recorded_at); assert.ok(e.revision_recorded_at <= row.recorded_at);
  }
});
test('alert records preserve policy-selected patterns separately from all assessment triggers', async () => {
  let alertId;
  const policy = { policy_id: 'synthetic_monitoring_subset', version: 'synthetic_v1', minimum_severity: 'low', included_codes: ['FRAUD_HIGH_AMOUNT'], include_partial: true };
  try {
    const result = await f.alerts.generate({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', assessment_run_id: f.entries[2].request.run_id, policy });
    alertId = result.alert_id; assert.ok(alertId);
    const s = await capture(), p = await page(s.snapshot_id, '?mode=alerts&limit=50'), row = p.rows.find(r => r.alert_id === alertId);
    assert.deepEqual(row.alert.patterns, ['FRAUD_HIGH_AMOUNT']); assert.ok(row.risk.patterns.length > row.alert.patterns.length);
    assert.equal(row.alert.policy.policy_id, policy.policy_id); assert.equal(row.alert.snapshot_sha256.length, 64);
  } finally {
    if (alertId) await f.owner.pool.query('DELETE FROM platform.local_alerts WHERE workspace_key=$1 AND alert_id=$2', ['synthetic_local', alertId]);
    await f.owner.pool.query('DELETE FROM platform.local_alert_policies WHERE workspace_key=$1 AND policy_id=$2', ['synthetic_local', policy.policy_id]);
  }
});
test('new revisions/results cannot change an existing KPI, page cursor or evidence target', async () => {
  const s = await capture(), original = await page(s.snapshot_id, '?sort=id_asc&limit=10');
  const request = structuredClone(f.entries[0].request); request.run_id = randomUUID(); request.context = null; request.target.revision_number = 2;
  try {
    await f.risks.evaluate(request);
    const p = await page(s.snapshot_id, '?sort=id_asc&limit=10'); assert.deepEqual(p, original);
    const current = await capture(); assert.equal(current.summary.counts.assessed, 7); assert.equal(s.summary.counts.assessed, 6);
    const saved = (await get('snapshots/' + s.snapshot_id)).json(); assert.deepEqual(saved.summary, s.summary);
  } finally { await f.owner.pool.query('DELETE FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', ['synthetic_local', request.run_id]); }
});
test('cursors bind snapshot, mode, search, sort and page size; malformed/repeated/extra fields are rejected', async () => {
  const s = await capture(), p = await page(s.snapshot_id, '?limit=10');
  for (const query of ['?limit=10&sort=id_asc', '?limit=25', '?limit=10&mode=not_assessed', '?limit=10&q=001']) assert.equal((await get('snapshots/' + s.snapshot_id + '/records' + query + '&after=' + encodeURIComponent(p.next_cursor))).statusCode, 400);
  for (const query of ['?limit=11', '?limit=10&limit=25', '?q=hello%20world', '?workspace_key=synthetic_other', '?sort=amount', '?after=bad', '?as_of=2026-01-01']) assert.equal((await get('snapshots/' + s.snapshot_id + '/records' + query)).statusCode, 400);
  assert.equal((await get('snapshots/' + s.snapshot_id + '/evidence?record=__proto__')).statusCode, 410);
  assert.equal((await get('snapshots/' + s.snapshot_id + '?currency=USD')).statusCode, 400);
  const other = await capture(); assert.equal((await get('snapshots/' + other.snapshot_id + '/records?limit=10&after=' + encodeURIComponent(p.next_cursor))).statusCode, 400);
});
test('each read rechecks scopes and principal ownership without disclosing foreign snapshot contents', async () => {
  const s = await capture();
  for (const missing of scopes.split(' ')) assert.equal((await get('snapshots/' + s.snapshot_id + '/records', { scope: scopes.split(' ').filter(x => x !== missing).join(' ') })).statusCode, 403);
  for (const claims of [{ sub: 'synthetic_different_reader' }, { workspace_key: 'synthetic_other' }]) {
    const r = await get('snapshots/' + s.snapshot_id, claims); assert.equal(r.statusCode, 410); assert.equal(r.json().summary, undefined);
  }
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/local/monitoring/snapshots/' + s.snapshot_id })).statusCode, 401);
});
test('expiry, owner cache eviction and process loss fail explicitly instead of recreating newer results', async () => {
  let time = Date.now(); const cache = new MonitoringSnapshots(() => time, 1000), principal = { workspace: 'synthetic_local', subject: 'synthetic_reader' };
  const payload = await readMonitoringSnapshot(f.owner.pool, principal.workspace, parseMonitoringFilters({}));
  const s = cache.create(principal, payload); time += 1001;
  assert.throws(() => cache.session(principal, s.snapshot_id), e => e.getStatus() === 410);
  const old = cache.create(principal, payload); for (let i = 0; i < 4; i++) cache.create(principal, payload);
  assert.throws(() => cache.session(principal, old.snapshot_id), e => e.getStatus() === 410);
  assert.throws(() => new MonitoringSnapshots().session(principal, old.snapshot_id), e => e.getStatus() === 410);
});
test('cached evidence is explicitly pinned during a real DB outage; new captures fail closed and recover', async () => {
  const s = await capture(); await f.stopDatabase();
  try {
    const cached = await page(s.snapshot_id); assert.deepEqual(cached.summary, s.summary);
    const response = await get('snapshots'); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'MONITORING_UNAVAILABLE'); assert.equal(response.json().summary, undefined);
  } finally { await f.startDatabase(); }
  assert.equal((await capture()).summary.counts.transactions, 48);
});
