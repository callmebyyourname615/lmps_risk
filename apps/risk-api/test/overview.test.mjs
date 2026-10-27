import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { overviewFixture, OVERVIEW_SCOPES } from './fixtures/overview.mjs';
let f;
before(async () => { f = await overviewFixture(); });
after(async () => { await f?.close(); });
const get = async (path = '/v1/local/overview', claims = {}) => f.app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer ' + await f.token(claims) } });
test('workspace totals deduplicate revisions, cover only latest targets and retain independent review/case states', async () => {
  const response = await get(); assert.equal(response.statusCode, 200);
  const v = response.json(); assert.deepEqual(v.counts, f.expectedCounts);
  assert.equal(v.scope, 'all_stored_history'); assert.equal(v.consistency, 'repeatable_read');
  assert.equal(v.workspace_key, 'synthetic_local'); assert.equal(v.canonical_emission, false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(v.measurements, { source_lag_seconds: null, production_tps: null, verified_account_identity: null });
  assert.equal(v.recent_transactions.length, 5); assert.equal(v.pending_alerts.length, 5); assert.equal(v.active_cases.length, 5);
  assert.equal(v.recent_transactions[0].transaction_id, 'synthetic_overview_001'); assert.equal(v.recent_transactions[0].revision_number, 2);
  assert.equal(v.recent_transactions[0].assessment, null);
  assert.ok(v.pending_alerts.every(a => a.state !== 'reviewed')); assert.ok(v.active_cases.every(c => c.state !== 'closed'));
  assert.ok(!JSON.stringify(v).includes('foreign_secret')); assert.ok(!JSON.stringify(v).includes('actor_subject'));
});
test('bounded lists use recorded timestamps and all detail/assessment links resolve to the same evidence', async () => {
  const v = (await get()).json();
  for (const row of v.recent_transactions) {
    assert.equal(typeof row.amount, 'string');
    const response = await get(`/v1/local/transactions/${row.namespace}/${row.transaction_id}/revisions/latest`);
    assert.equal(response.statusCode, 200); assert.equal(response.json().items[0].revision_number, row.revision_number);
    if (row.assessment) assert.equal((await get('/v1/local/risk-assessments/' + row.assessment.run_id)).json().core_sha256, row.assessment.core_sha256);
  }
  for (const row of v.pending_alerts) assert.equal((await get('/v1/local/alerts/' + row.alert_id)).json().alert.state, row.state);
  for (const row of v.active_cases) assert.equal((await get('/v1/local/cases/' + row.case_id)).json().case.state, row.state);
  const latest = (await f.owner.pool.query(`SELECT DISTINCT ON(namespace,transaction_id) namespace,transaction_id,revision_number FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_local' ORDER BY namespace,transaction_id,revision_number DESC`)).rows;
  assert.equal(latest.length, v.counts.transactions);
});
test('charts aggregate all stored alerts once per dimension and seven ICT calendar days, independent of preview limits', async () => {
  const v = (await get()).json(), charts = v.charts;
  assert.equal(charts.timezone, 'Asia/Vientiane'); assert.equal(charts.days.length, 7);
  assert.deepEqual(charts.alert_dimensions, { fraud: 7, mule_network: 7, aml: 7 });
  assert.deepEqual(charts.alert_severity, { low: 0, medium: 0, high: 7, critical: 0 });
  assert.equal(charts.days.reduce((n, d) => n + d.transactions, 0), 48);
  assert.equal(charts.days.reduce((n, d) => n + d.assessment_runs, 0), 8);
  assert.equal(charts.days.reduce((n, d) => n + d.alerts_created, 0), 7);
  assert.equal(charts.days.reduce((n, d) => n + d.cases_created, 0), 7);
  for (let i = 0; i < 7; i++) assert.equal(charts.days[i].date, new Date(Date.parse(v.generated_at) + 7 * 3600000 - (6 - i) * 86400000).toISOString().slice(0, 10));
  const empty = (await get(undefined, { workspace_key: 'synthetic_empty' })).json();
  assert.ok(empty.charts.days.every(day => Object.entries(day).every(([key, n]) => key === 'date' || n === 0)));
  assert.ok(Object.values(empty.charts.alert_dimensions).every(n => n === 0));
});
test('daily transactions use only latest revisions across the ICT midnight boundary and exclude future recordings', async () => {
  const before = (await get()).json(), saved = (await f.owner.pool.query(`SELECT revision_number,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
    FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001' ORDER BY revision_number`)).rows;
  const boundary = (await f.owner.pool.query("SELECT ((transaction_timestamp() AT TIME ZONE 'Asia/Vientiane')::date)::timestamp AT TIME ZONE 'Asia/Vientiane' AS boundary")).rows[0].boundary.getTime();
  const previousDay = new Date(boundary + 7 * 3600000 - 1).toISOString().slice(0, 10), originalDay = new Date(Date.parse(saved[1].recorded_at) + 7 * 3600000).toISOString().slice(0, 10);
  try {
    await f.owner.pool.query(`UPDATE platform.local_transaction_revisions SET recorded_at=CASE revision_number WHEN 2 THEN $1::timestamptz ELSE $2::timestamptz END
      WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001'`, [new Date(boundary - 1).toISOString(), new Date(boundary + 1).toISOString()]);
    const moved = (await get()).json(); assert.equal(moved.counts.transactions, 48);
    for (const day of moved.charts.days) assert.equal(day.transactions, (before.charts.days.find(d => d.date === day.date)?.transactions ?? 0) - (day.date === originalDay ? 1 : 0) + (day.date === previousDay ? 1 : 0));
    await f.owner.pool.query(`UPDATE platform.local_transaction_revisions SET recorded_at=transaction_timestamp()+interval '1 minute'
      WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001' AND revision_number=2`);
    assert.equal((await get()).json().charts.days.reduce((n, d) => n + d.transactions, 0), 47);
  } finally {
    for (const row of saved) await f.owner.pool.query(`UPDATE platform.local_transaction_revisions SET recorded_at=$1
      WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001' AND revision_number=$2`, [row.recorded_at, row.revision_number]);
  }
});
test('each required scope is enforced before any summary leaks; foreign workspaces contain only their actual records', async () => {
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/local/overview' })).statusCode, 401);
  for (const missing of OVERVIEW_SCOPES.split(' ')) {
    const response = await get(undefined, { scope: OVERVIEW_SCOPES.split(' ').filter(s => s !== missing).join(' ') });
    assert.equal(response.statusCode, 403); assert.equal(response.json().counts, undefined);
  }
  const other = (await get(undefined, { workspace_key: 'synthetic_other' })).json();
  assert.equal(other.counts.transactions, 1); assert.equal(other.counts.assessment_runs, 0); assert.equal(other.pending_alerts.length, 0);
  assert.equal(other.recent_transactions[0].transaction_id, 'foreign_secret');
  const empty = (await get(undefined, { workspace_key: 'synthetic_empty' })).json();
  assert.ok(Object.values(empty.counts).every(n => n === 0)); assert.deepEqual(empty.recent_transactions, []);
});
test('query injection, methods and OpenAPI stay bounded and read-only', async () => {
  for (const query of ['?workspace=synthetic_other', '?limit=100', '?range=7d', '?x=a&x=b']) assert.equal((await get('/v1/local/overview' + query)).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/local/overview' })).statusCode, 404);
  const paths = (await f.app.inject({ method: 'GET', url: '/openapi.json' })).json().paths;
  assert.deepEqual(Object.keys(paths['/v1/local/overview']), ['get']);
});
test('concurrent committed risk runs do not mix counts and references across the actual read-only snapshot', async () => {
  const { OverviewController } = await import('../dist/overview.controller.js');
  const pool = f.app.get(OverviewController).database.pool, connect = pool.connect;
  const request = { ...f.entries[6].request, run_id: (await import('node:crypto')).randomUUID() };
  let probed = false;
  pool.connect = async function () {
    const client = await connect.call(this), query = client.query.bind(client);
    client.query = async (sql, ...args) => {
      const result = await query(sql, ...args);
      if (!probed && typeof sql === 'string' && sql.includes('AS assessed_latest_transactions')) {
        probed = true;
        const probe = (await query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly")).rows[0];
        assert.deepEqual(probe, { isolation: 'repeatable read', readonly: 'on' });
        await f.risks.evaluate(request);
      }
      return result;
    };
    return client;
  };
  try {
    const response = await get(); assert.equal(response.statusCode, 200); assert.equal(probed, true);
    assert.equal(response.json().counts.assessment_runs, 8);
    assert.equal(response.json().charts.days.reduce((n, day) => n + day.assessment_runs, 0), 8);
    assert.ok(response.json().recent_transactions.every(row => row.assessment?.run_id !== request.run_id));
  } finally { pool.connect = connect; }
  f.expectedCounts.assessment_runs++;
  const next = (await get()).json(); assert.equal(next.counts.assessment_runs, 9);
  assert.equal(next.charts.days.reduce((n, day) => n + day.assessment_runs, 0), 9);
  assert.equal(next.recent_transactions.find(row => row.transaction_id === 'synthetic_overview_007').assessment.run_id, request.run_id);
});
test('corrupt bounded evidence fails closed without any counts', async () => {
  const row = f.entries[6], id = row.request.run_id;
  const saved = (await f.owner.pool.query('SELECT snapshot_sha256 FROM platform.local_transaction_risks WHERE run_id=$1', [id])).rows[0].snapshot_sha256;
  // Select the original run as latest again before corrupting its proof.
  await f.owner.pool.query("UPDATE platform.local_transaction_risks SET recorded_at='2099-01-01T00:00:00Z' WHERE run_id=$1", [id]);
  await f.owner.pool.query("UPDATE platform.local_transaction_risks SET snapshot_sha256=repeat('0',64) WHERE run_id=$1", [id]);
  try { const response = await get(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'OVERVIEW_UNAVAILABLE'); assert.equal(response.json().counts, undefined); }
  finally { await f.owner.pool.query('UPDATE platform.local_transaction_risks SET snapshot_sha256=$2 WHERE run_id=$1', [id, saved]); }
});
test('actual database outage returns fixed errors and recovers without writes', async () => {
  await f.stopDatabase();
  try { const response = await get(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'OVERVIEW_UNAVAILABLE'); assert.ok(!response.body.includes('postgres')); }
  finally { await f.startDatabase(); }
  assert.deepEqual((await get()).json().counts, f.expectedCounts);
});
