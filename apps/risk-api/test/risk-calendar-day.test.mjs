import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { overviewFixture, OVERVIEW_SCOPES } from './fixtures/overview.mjs';
let fixture, calendar, date, start, fingerprint;
const root = '/v1/local/overview/risk-calendar';
const get = async (path, claims = {}) => fixture.app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer ' + await fixture.token(claims) } });
const path = (selected = date, asOf = calendar.as_of) => root + '/day?' + new URLSearchParams({ date: selected, as_of: asOf });
before(async () => {
  fixture = await overviewFixture();
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  date = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10); start = Date.parse(date + 'T00:00:00+07:00');
  const times = [start, start + 5 * 3600000, start + 5 * 3600000 + 600000, start + 5 * 3600000 + 1200000, start + 86400000 - 1, start + 86400000, start - 1];
  for (const [index, time] of times.entries()) await fixture.owner.pool.query('UPDATE platform.local_alerts SET created_at=$2 WHERE alert_id=$1', [fixture.entries[index].alert_id, new Date(time).toISOString()]);
  calendar = (await get(root)).json();
  fingerprint = (await fixture.owner.pool.query("SELECT md5(string_agg(to_jsonb(a)::text,'|' ORDER BY alert_id)) AS proof FROM platform.local_alerts a")).rows[0].proof;
});
after(async () => { await fixture?.close(); });
test('all 24 ICT hours match the selected calendar total, including reviewed Alerts and exact midnight boundaries', async () => {
  const response = await get(path()); assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  const value = response.json(); assert.equal(value.date, date); assert.equal(value.as_of, calendar.as_of); assert.equal(value.metric, 'alerts_created');
  assert.equal(value.hours.length, 24); assert.equal(value.total_alerts, 5); assert.equal(calendar.days.find(row => row.date === date).count, value.total_alerts);
  for (const [hour, row] of value.hours.entries()) assert.deepEqual(row, { hour, count: hour === 0 || hour === 23 ? 1 : hour === 5 ? 3 : 0 });
  for (const forbidden of ['alert_id', 'snapshot', 'account', 'note']) assert.ok(!response.body.includes(forbidden));
});
test('the original observation cutoff excludes later Alerts and a valid empty day retains 24 explicit zero bins', async () => {
  const cutoff = new Date(start + 5 * 3600000 + 300000).toISOString().replace('.000Z', '.000000Z');
  const value = (await get(path(date, cutoff))).json(); assert.equal(value.total_alerts, 2); assert.equal(value.hours[0].count, 1); assert.equal(value.hours[5].count, 1); assert.equal(value.hours[23].count, 0);
  const emptyDate = new Date(Date.parse(date) - 2 * 86400000).toISOString().slice(0, 10), empty = (await get(path(emptyDate))).json();
  assert.equal(empty.total_alerts, 0); assert.equal(empty.hours.length, 24); assert.ok(empty.hours.every(row => row.count === 0));
});
test('all read scopes and workspace isolation are rechecked without revealing foreign hourly counts', async () => {
  assert.equal((await fixture.app.inject({ method: 'GET', url: path() })).statusCode, 401);
  for (const scope of OVERVIEW_SCOPES.split(' ')) assert.equal((await get(path(), { scope: OVERVIEW_SCOPES.split(' ').filter(value => value !== scope).join(' ') })).statusCode, 403);
  assert.equal((await get(path(), { exp: Math.floor(Date.now() / 1000) - 1 })).statusCode, 401);
  const foreign = (await get(path(), { workspace_key: 'synthetic_other' })).json(); assert.equal(foreign.workspace_key, 'synthetic_other'); assert.equal(foreign.total_alerts, 0);
});
test('malformed, repeated, out-of-calendar and future-cutoff coordinates fail with fixed errors', async () => {
  const future = new Date(Date.now() + 86400000).toISOString().replace('Z', '000Z');
  for (const query of [
    '', '?date=' + date, '?as_of=' + calendar.as_of, '?' + new URLSearchParams({ date: '2026-02-30', as_of: calendar.as_of }),
    path('2000-01-01').slice((root + '/day').length), path(date, future).slice((root + '/day').length),
    path().slice((root + '/day').length) + '&date=' + date, path().slice((root + '/day').length) + '&workspace_key=synthetic_other',
    '?' + new URLSearchParams({ date, as_of: '2026-01-01T99:00:00.000000Z' }),
  ]) {
    const response = await get(root + '/day' + query); assert.equal(response.statusCode, 400, query); assert.equal(response.json().code, 'INVALID_QUERY'); assert.equal(response.json().hours, undefined);
  }
});
test('OpenAPI is GET-only and storage failure never becomes a zero series or changes stored Alerts', async () => {
  const spec = (await fixture.app.inject({ method: 'GET', url: '/openapi.json' })).json(); assert.deepEqual(Object.keys(spec.paths[root + '/day']), ['get']);
  assert.equal(spec.components.schemas.RiskCalendarHour.properties.hour.maximum, 23);
  await fixture.stopDatabase();
  try { const response = await get(path()); assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { code: 'OVERVIEW_UNAVAILABLE', message: 'Risk calendar day is unavailable.' }); }
  finally { await fixture.startDatabase(); }
  assert.equal((await get(path())).json().total_alerts, 5);
  assert.equal((await fixture.owner.pool.query("SELECT md5(string_agg(to_jsonb(a)::text,'|' ORDER BY alert_id)) AS proof FROM platform.local_alerts a")).rows[0].proof, fingerprint);
});
