import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { overviewFixture, OVERVIEW_SCOPES } from './fixtures/overview.mjs';
let f, baseline, first, expected;
const root = '/v1/local/overview/risk-calendar';
const get = async (path = root, claims = {}) => f.app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer ' + await f.token(claims) } });
async function fingerprint() { return (await f.owner.pool.query("SELECT md5(string_agg(to_jsonb(a)::text,'|' ORDER BY alert_id)) AS proof FROM platform.local_alerts a")).rows[0].proof; }
before(async () => {
  f = await overviewFixture();
  const original = (await get()).json(); first = original.start_date;
  const start = Date.parse(first + 'T00:00:00+07:00'), newYear = Date.UTC(Number(original.through_date.slice(0, 4)), 0, 1) - 7 * 3600000;
  const dates = [start, start - 1, start + 86400000, newYear, newYear - 1, Date.now() - 1000, Date.now() + 86400000].map(ms => new Date(ms).toISOString());
  expected = new Map();
  for (const date of dates.filter((_, i) => i !== 1 && i !== 6)) { const key = new Date(Date.parse(date) + 7 * 3600000).toISOString().slice(0, 10); expected.set(key, (expected.get(key) ?? 0) + 1); }
  for (let i = 0; i < dates.length; i++) await f.owner.pool.query('UPDATE platform.local_alerts SET created_at=$2 WHERE alert_id=$1', [f.entries[i].alert_id, dates[i]]);
  baseline = await fingerprint();
});
after(async () => { await f?.close(); });
test('ICT year/start boundaries count each Alert once, including reviewed records and overlapping dimensions', async () => {
  const r = await get(); assert.equal(r.statusCode, 200); assert.equal(r.headers['cache-control'], 'no-store');
  const v = r.json(); assert.equal(v.metric, 'alerts_created'); assert.equal(v.timezone, 'Asia/Vientiane'); assert.equal(v.range, 'week_aligned_year');
  assert.equal(v.start_date, first); assert.equal(v.total_alerts, 5); assert.ok(v.days.length >= 365 && v.days.length <= 371);
  for (const d of v.days) assert.equal(d.count, expected.get(d.date) ?? 0, d.date);
  assert.equal(new Date(v.start_date).getUTCDay(), 0);
  assert.ok(!r.body.includes('alert_id')); assert.ok(!r.body.includes('snapshot')); assert.ok(!r.body.includes('account'));
});
test('complete consecutive year bins use the statement clock and exclude future/out-of-window timestamps', async () => {
  const r = await get(); assert.equal(r.statusCode, 200); const v = r.json();
  const today = new Date(Date.parse(v.as_of) + 7 * 3600000).toISOString().slice(0, 10);
  assert.equal(v.through_date, today); assert.equal(v.days.at(-1).date, today);
  for (let i = 0; i < v.days.length; i++) { assert.equal(v.days[i].date, new Date(Date.parse(v.start_date) + i * 86400000).toISOString().slice(0, 10)); assert.equal(typeof v.days[i].count, 'number'); }
  assert.equal(v.days.reduce((n, d) => n + d.count, 0), 5);
});
test('all Overview scopes, verified workspace, unknown query fields and expired credentials are independently enforced', async () => {
  assert.equal((await f.app.inject({ method: 'GET', url: root })).statusCode, 401);
  assert.equal((await get(root, { exp: Math.floor(Date.now() / 1000) - 5 })).statusCode, 401);
  for (const scope of OVERVIEW_SCOPES.split(' ')) assert.equal((await get(root, { scope: OVERVIEW_SCOPES.split(' ').filter(s => s !== scope).join(' ') })).statusCode, 403);
  const v = (await get(root, { workspace_key: 'synthetic_other' })).json(); assert.equal(v.total_alerts, 0); assert.ok(v.days.every(d => d.count === 0));
});
test('all range/month/workspace queries are rejected with fixed messages', async () => {
  for (const query of ['month=', 'month=2024-2', 'month=2024-13', 'month=0000-01', 'month=2024-02-01', 'month=9999-12', 'month=2024-02&month=2024-02', 'month=2024-02&workspace_key=synthetic_other', "month=2024-02'", 'limit=31']) {
    const r = await get(root + '?' + query); assert.equal(r.statusCode, 400, query); assert.deepEqual(r.json(), { code: 'INVALID_QUERY', message: 'Risk calendar accepts no query parameters.' });
  }
});
test('OpenAPI describes the actual GET-only year contract and old Overview query behavior stays unchanged', async () => {
  const doc = (await f.app.inject({ method: 'GET', url: '/openapi.json' })).json(); assert.deepEqual(Object.keys(doc.paths[root]), ['get']);
  assert.notEqual(doc.components.schemas.RiskCalendarDay.properties.count.nullable, true); assert.equal(doc.components.schemas.RiskCalendarView.properties.range.enum[0], 'week_aligned_year');
  assert.equal((await f.app.inject({ method: 'POST', url: root })).statusCode, 404); assert.equal((await get('/v1/local/overview?month=2024-02')).statusCode, 400);
});
test('actual database outage returns503 rather than zero history and recovers without writes', async () => {
  await f.stopDatabase();
  try { const r = await get(root); assert.equal(r.statusCode, 503); assert.deepEqual(r.json(), { code: 'OVERVIEW_UNAVAILABLE', message: 'Risk calendar is unavailable.' }); }
  finally { await f.startDatabase(); }
  assert.equal((await get(root)).json().total_alerts, 5); assert.equal(await fingerprint(), baseline);
});
