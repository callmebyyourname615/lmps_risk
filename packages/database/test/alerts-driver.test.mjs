import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createLocalAlerts, createAlertReviews, validateAlertRow, listLocalAlerts } from '../dist/index.js';
import { riskHash } from '@lmps/risk';
import { alertFixture } from './fixtures/alert.mjs';

async function driver(t, handle, reviewer = false) {
  const calls = [], client = { async query(sql, args) { calls.push({ sql, args }); return handle(sql, args); }, release() {} };
  const connect = t.mock.method(pg.Pool.prototype, 'connect', async () => client);
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = reviewer ? 'lmps_reviewer' : 'lmps_intake'; url.password = randomUUID();
  const repo = reviewer ? createAlertReviews(url.toString()) : createLocalAlerts(url.toString()); t.after(() => repo.close()); return { repo, calls, connect };
}
function generationDriver(f, { fail = false, duplicate = false, missing = false } = {}) {
  return async sql => {
    if (sql.startsWith('SELECT snapshot,')) return { rows: missing ? [] : [{ snapshot: f.row.risk_snapshot, snapshot_sha256: f.row.risk_snapshot_sha256 }] };
    if (sql.startsWith('SELECT policy,')) return { rows: [{ policy: f.policy, policy_sha256: riskHash(f.policy) }] };
    if (sql.startsWith('SELECT alert_id')) return { rows: duplicate ? [{ alert_id: f.row.alert_id }] : [] };
    if (sql.startsWith('SELECT a.alert_id')) return { rows: [f.row] };
    if (sql.includes('INSERT INTO platform.local_alerts')) { if (fail) throw new Error('SYNTHETIC_PRIVATE_VALUE'); return { rows: [{ alert_id: f.row.alert_id }] }; }
    return { rows: [] };
  };
}
test('generation writes one grouped alert and policy transactionally; duplicate returns original verified evidence', async t => {
  const f = alertFixture(); let duplicate = false;
  const { repo, calls } = await driver(t, (sql, args) => generationDriver(f, { duplicate })(sql, args));
  assert.equal((await repo.generate(f.generation)).status, 'inserted'); assert.equal(calls.at(-1).sql, 'COMMIT');
  const insert = calls.find(x => x.sql.includes('INSERT INTO platform.local_alerts')); assert.equal(JSON.parse(insert.args[5]).selected_risk_types.length, 15);
  assert.equal(insert.args[6], riskHash(JSON.parse(insert.args[5])));
  duplicate = true; calls.length = 0; assert.equal((await repo.generate(f.generation)).alert_id, f.row.alert_id);
  assert.ok(!calls.some(x => x.sql.includes('INSERT INTO platform.local_alerts'))); assert.equal(calls.at(-1).sql, 'COMMIT');
});
test('a downstream alert failure rolls back policy registration and redacts private diagnostics', async t => {
  const f = alertFixture(), { repo, calls } = await driver(t, generationDriver(f, { fail: true }));
  await assert.rejects(repo.generate(f.generation), e => e.code === 'ALERT_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE'));
  assert.equal(calls.at(-1).sql, 'ROLLBACK'); assert.ok(!calls.some(x => x.sql === 'COMMIT'));
});
test('policy version conflicts never insert an alert', async t => {
  const f = alertFixture(), { repo, calls } = await driver(t, generationDriver(f));
  const changed = structuredClone(f.generation); changed.policy.minimum_severity = 'critical';
  await assert.rejects(repo.generate(changed), e => e.code === 'ALERT_POLICY_CONFLICT'); assert.equal(calls.at(-1).sql, 'ROLLBACK');
});
test('non-matching alert policy is registered without generating an alert or fabricating a clean assessment', async t => {
  const f = alertFixture(); f.policy.minimum_severity = 'critical';
  const { repo, calls } = await driver(t, generationDriver(f));
  assert.deepEqual(await repo.generate(f.generation), { status: 'skipped', reason_code: 'ALERT_NO_MATCH', alert_id: null });
  assert.ok(calls.some(x => x.sql.includes('INSERT INTO platform.local_alert_policies')));
  assert.ok(!calls.some(x => x.sql.includes('INSERT INTO platform.local_alerts'))); assert.equal(calls.at(-1).sql, 'COMMIT');
});
test('a duplicate with missing joined evidence fails closed', async t => {
  const f = alertFixture(), { repo } = await driver(t, sql => sql.startsWith('SELECT a.alert_id') ? { rows: [] } : generationDriver(f, { duplicate: true })(sql));
  await assert.rejects(repo.generate(f.generation), e => e.code === 'ALERT_STORAGE_UNAVAILABLE');
});
test('missing source assessment and malformed/live requests reject without fabricated alerts', async t => {
  const f = alertFixture(), { repo, calls, connect } = await driver(t, generationDriver(f, { missing: true }));
  await assert.rejects(repo.generate({ ...f.generation, execution_mode: 'live' }), e => e.code === 'INVALID_ALERT_INPUT'); assert.equal(connect.mock.calls.length, 0);
  await assert.rejects(repo.generate(f.generation), e => e.code === 'ALERT_ASSESSMENT_NOT_FOUND');
  assert.ok(!calls.some(x => x.sql.includes('INSERT INTO')));
});
test('frozen alert proof detects rehashed corruption, changed assessment, broken review chains and scope mismatches', () => {
  const f = alertFixture(); assert.equal(validateAlertRow(f.row, 'synthetic_local').state, 'open');
  for (const change of [r => r.workspace_key = 'synthetic_other', r => r.snapshot.severity = 'critical', r => r.snapshot.selected_risk_types.pop(),
    r => r.risk_snapshot.result.fraud_score.value = 0, r => r.recorded_by = 'spoofed', r => r.history = [f.event(f.review)],
    r => r.policy_sha256 = '0'.repeat(64)]) {
    const row = structuredClone(f.row); change(row); row.snapshot_sha256 = riskHash(row.snapshot); row.risk_snapshot_sha256 = riskHash(row.risk_snapshot);
    assert.throws(() => validateAlertRow(row, 'synthetic_local'), /ALERT_STORAGE_UNAVAILABLE/);
  }
});
test('inbox filters use bound parameters, bounded keyset pagination and validated rows', async () => {
  const f = alertFixture(); let captured;
  const page = await listLocalAlerts({ query: async (sql, args) => { captured = { sql, args }; return { rows: [f.row, f.row] }; } }, 'synthetic_local',
    { limit: 1, state: 'open', severity: 'high', risk_code: 'FRAUD_HIGH_AMOUNT' });
  assert.equal(page.items.length, 1); assert.equal(page.next_cursor, f.row.alert_id); assert.equal(captured.args.at(-1), 2);
  assert.ok(!captured.sql.includes('FRAUD_HIGH_AMOUNT')); assert.equal(captured.args[4], 'open');
});
test('review repository uses only the reviewer role, JWT subject, fixed SQL function and atomic ledger verification', async t => {
  const f = alertFixture(); let wrote = false;
  const { repo, calls } = await driver(t, async (sql, args) => {
    if (sql.startsWith('SELECT a.alert_id')) return { rows: [{ ...f.row, history: wrote ? [f.event(f.ack)] : [] }] };
    if (sql.includes('platform.review_local_alert')) { assert.equal(args[7], 'synthetic_reviewer'); wrote = true; return { rows: [{ inserted: true }] }; }
    return { rows: [] };
  }, true);
  const result = await repo.review('synthetic_local', f.row.alert_id, 'synthetic_reviewer', f.ack);
  assert.equal(result.view.state, 'acknowledged'); assert.equal(result.view.version, 1); assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.ok(calls.every(x => !/UPDATE|DELETE|INSERT INTO/.test(x.sql)));
});
test('concurrent/stale review conflicts and corrupt post-write history roll back with no successful response', async t => {
  const f = alertFixture(); let conflict = true;
  const { repo, calls } = await driver(t, async sql => {
    if (sql.startsWith('SELECT a.alert_id')) return { rows: [f.row] };
    if (sql.includes('platform.review_local_alert')) { if (conflict) throw Object.assign(new Error('SYNTHETIC_PRIVATE_VALUE'), { code: 'P3209' }); return { rows: [{ inserted: true }] }; }
    return { rows: [] };
  }, true);
  await assert.rejects(repo.review('synthetic_local', f.row.alert_id, 'synthetic_reviewer', f.ack), e => e.code === 'ALERT_REVIEW_CONFLICT');
  assert.equal(calls.at(-1).sql, 'ROLLBACK'); conflict = false;
  await assert.rejects(repo.review('synthetic_local', f.row.alert_id, 'synthetic_reviewer', f.ack), e => e.code === 'ALERT_STORAGE_UNAVAILABLE');
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});
