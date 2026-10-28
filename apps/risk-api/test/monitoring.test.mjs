import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { overviewFixture } from './fixtures/overview.mjs';
import { parseMonitoringFilters, isMonitoringSummary } from '@lmps/contracts/monitoring';
const SCOPES = 'transactions:read risk:read alerts:read';
let f;
before(async () => { f = await overviewFixture(); });
after(async () => { await f?.close(); });
const get = async (query = '', claims = {}) => f.app.inject({ method: 'GET', url: '/v1/local/monitoring/summary' + query, headers: { authorization: 'Bearer ' + await f.token({ scope: SCOPES, ...claims }) } });
test('monitoring counts current revisions from validated evidence without Case/Reviewer permission', async () => {
  const r = await get(); assert.equal(r.statusCode, 200, r.body);
  const v = r.json(); assert.ok(isMonitoringSummary(v));
  assert.deepEqual(v.counts, { transactions: 48, assessed: 6, not_assessed: 42, flagged: 6, alerts: 6 });
  assert.deepEqual(v.dimensions, { fraud: 6, mule_network: 6, aml: 6 });
  assert.equal(v.availability.source_lag_seconds, null); assert.equal(v.availability.continuous_intake, 'not_attested');
  assert.equal(v.time_basis, 'latest_revision_recorded_at'); assert.equal(r.headers['cache-control'], 'no-store');
  const legacy = await f.app.inject({ method: 'GET', url: '/v1/local/overview', headers: { authorization: 'Bearer ' + await f.token({ scope: SCOPES }) } });
  assert.equal(legacy.statusCode, 403);
});
test('all three scopes are required and verified workspace remains the only tenant selector', async () => {
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/local/monitoring/summary' })).statusCode, 401);
  for (const missing of SCOPES.split(' ')) assert.equal((await get('', { scope: SCOPES.split(' ').filter(s => s !== missing).join(' ') })).statusCode, 403);
  const other = (await get('', { workspace_key: 'synthetic_other' })).json(); assert.equal(other.counts.transactions, 1); assert.equal(other.counts.assessed, 0);
  const empty = (await get('', { workspace_key: 'synthetic_empty' })).json(); assert.ok(Object.values(empty.counts).every(n => n === 0));
  assert.ok(!JSON.stringify((await get()).json()).includes('foreign_secret'));
});
test('filters bind to latest revisions and selected triggered findings, with separate currencies', async () => {
  const base = (await get()).json();
  let sum = 0;
  for (const row of base.currencies) {
    const r = await get('?currency=' + row.currency); assert.equal(r.statusCode, 200, r.body);
    const v = r.json(); assert.equal(v.counts.transactions, row.transactions); assert.equal(v.filters.currency, row.currency); sum += row.transactions;
  }
  assert.equal(sum, 48);
  const eur = (await get('?currency=EUR')).json(); assert.equal(eur.counts.transactions, 1);
  const fraud = (await get('?dimension=fraud&severity=high')).json(); assert.equal(fraud.counts.transactions, 6); assert.equal(fraud.counts.alerts, 6);
  const codes = (await f.owner.pool.query('SELECT snapshot FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', ['synthetic_local', f.entries[2].request.run_id])).rows[0].snapshot.result.findings;
  const code = codes.find(x => x.status === 'triggered' && x.dimension === 'fraud').code;
  const exact = (await get('?pattern=' + code + '&dimension=fraud')).json(); assert.equal(exact.counts.transactions, 6);
  const impossible = (await get('?pattern=' + code + '&dimension=aml')).json(); assert.equal(impossible.counts.transactions, 0);
});
test('strict shared filters reject tenant/snapshot overrides, repeated keys and invalid intervals', async () => {
  const queries = ['?workspace_key=synthetic_other', '?as_of=2026-01-01', '?institution=bank', '?currency=usd', '?currency=USD&currency=LAK', '?namespace=%20synthetic_local', '?from=2026-01-01T00:00:00Z', '?pattern=FRAUD_NOT_A_RULE', '?timezone=Europe/Paris', '?from=2026-02-30T00:00:00Z&to=2026-03-31T00:00:00Z', '?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z'];
  for (const q of queries) { const r = await get(q); assert.equal(r.statusCode, 400, q); assert.equal(r.json().counts, undefined); }
  assert.equal(parseMonitoringFilters({}).timezone, 'Asia/Vientiane');
  assert.equal(parseMonitoringFilters({ from: '2026-01-01T00:00:00.000001Z', to: '2026-01-01T00:00:00.000002Z' }).from, '2026-01-01T00:00:00.000001Z');
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/local/monitoring/summary' })).statusCode, 404);
});
test('time window does not resurrect an older revision when the newest is outside the range', async () => {
  const saved = (await f.owner.pool.query(`SELECT revision_number,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001'`)).rows;
  try {
    await f.owner.pool.query(`UPDATE platform.local_transaction_revisions SET recorded_at=CASE revision_number WHEN 1 THEN '2026-01-02'::timestamptz ELSE '2026-01-04'::timestamptz END WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001'`);
    const v = (await get('?namespace=synthetic_alternate&from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z')).json(); assert.equal(v.counts.transactions, 0);
  } finally { for (const row of saved) await f.owner.pool.query(`UPDATE platform.local_transaction_revisions SET recorded_at=$1 WHERE workspace_key='synthetic_local' AND namespace='synthetic_alternate' AND transaction_id='001' AND revision_number=$2`, [row.at, row.revision_number]); }
});
test('read-only repeatable read keeps a concurrent newly assessed transaction out of the original snapshot', async () => {
  const { MonitoringController } = await import('../dist/monitoring.controller.js');
  const pool = f.app.get(MonitoringController).database.pool, connect = pool.connect;
  const before = (await get()).json(); let probed = false;
  pool.connect = async function () {
    const client = await connect.call(this), query = client.query.bind(client);
    client.query = async (sql, ...args) => {
      const result = await query(sql, ...args);
      if (!probed && typeof sql === 'string' && sql.includes('LIMIT $8')) {
        probed = true;
        assert.deepEqual((await query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly")).rows[0], { isolation: 'repeatable read', readonly: 'on' });
        const request = structuredClone(f.entries[0].request); request.run_id = randomUUID(); request.target.revision_number = 2;
        request.context = null;
        await f.risks.evaluate(request);
      }
      return result;
    }; return client;
  };
  try { assert.deepEqual((await get()).json().counts, before.counts); assert.ok(probed); }
  finally { pool.connect = connect; }
  assert.equal((await get()).json().counts.assessed, before.counts.assessed + 1);
});
test('a missing-target run made before intake cannot cover the revision arriving later', async () => {
  const { publicationTransaction } = await import('@lmps/contracts/synthetic-publication');
  const request = structuredClone(f.entries[6].request); request.run_id = randomUUID(); request.context = null;
  request.target.transaction_id = 'synthetic_monitoring_late';
  const revision = structuredClone(f.entries[6].revision); revision.publication.binding.transaction_id = request.target.transaction_id;
  revision.transaction = publicationTransaction(revision.publication).transaction;
  try {
    await f.risks.evaluate(request); await f.writer.append(revision);
    const r = await get(); assert.equal(r.statusCode, 200, r.body); const v = r.json();
    assert.equal(v.counts.transactions, 49); assert.equal(v.counts.not_assessed, 42);
    assert.equal(v.counts.assessed, 7);
  } finally {
    await f.owner.pool.query('DELETE FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', ['synthetic_local', request.run_id]);
    await f.owner.pool.query('DELETE FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3', ['synthetic_local', request.target.namespace, request.target.transaction_id]);
  }
});
test('pilot cap rejects an overbroad scope instead of presenting truncated totals', async () => {
  try {
    await f.owner.pool.query(`INSERT INTO platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number,payload)
      SELECT 'synthetic_empty','synthetic_bound','bound_'||n,1,
        jsonb_set(jsonb_set(jsonb_set(payload,'{transaction_id}',to_jsonb('bound_'||n)),
          '{source_reference,namespace}','"synthetic_bound"'::jsonb),'{source_reference,record_ref}',to_jsonb('synthetic_bound_'||n))
      FROM (SELECT payload FROM platform.local_transaction_revisions WHERE publication IS NULL LIMIT 1) template CROSS JOIN generate_series(1,501) n`);
    const r = await get('', { workspace_key: 'synthetic_empty' }); assert.equal(r.statusCode, 503); assert.equal(r.json().code, 'MONITORING_SCOPE_TOO_LARGE'); assert.equal(r.json().counts, undefined);
    assert.equal((await get('?currency=ZZZ', { workspace_key: 'synthetic_empty' })).json().counts.transactions, 0);
  } finally { await f.owner.pool.query("DELETE FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_empty' AND namespace='synthetic_bound'"); }
});
test('corrupt evidence and unavailable database fail closed with fixed errors and no totals', async () => {
  const id = f.entries[3].request.run_id;
  const saved = (await f.owner.pool.query('SELECT snapshot_sha256 FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', ['synthetic_local', id])).rows[0].snapshot_sha256;
  try {
    await f.owner.pool.query('UPDATE platform.local_transaction_risks SET snapshot_sha256=$1 WHERE workspace_key=$2 AND run_id=$3', ['0'.repeat(64), 'synthetic_local', id]);
    const r = await get(); assert.equal(r.statusCode, 503); assert.equal(r.json().code, 'MONITORING_UNAVAILABLE'); assert.equal(r.json().counts, undefined);
  } finally { await f.owner.pool.query('UPDATE platform.local_transaction_risks SET snapshot_sha256=$1 WHERE workspace_key=$2 AND run_id=$3', [saved, 'synthetic_local', id]); }
  await f.stopDatabase();
  try { const r = await get(); assert.equal(r.statusCode, 503); assert.equal(r.json().code, 'MONITORING_UNAVAILABLE'); assert.ok(!r.body.includes('postgres')); }
  finally { await f.startDatabase(); }
  assert.equal((await get()).statusCode, 200);
});
