import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { riskHash } from '@lmps/risk';
import { alertFixture } from './fixtures/alert.mjs';
import { generateAlerts } from '../../../apps/risk-workers/scripts/alerts.mjs';
import { savePrivateReport } from '../../../apps/risk-workers/scripts/private-json.mjs';

async function setup(t) {
  const f = alertFixture(), temporary = await mkdtemp('/tmp/lmps-alert-private-'), base = join(temporary, 'inputs'), calls = [];
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await savePrivateReport(base, 'v1', f.generation.assessment_run_id, 'input.json', f.generation, 16384);
  t.mock.method(pg.Pool.prototype, 'connect', async () => ({ release() {}, async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT snapshot,')) return { rows: [{ snapshot: f.row.risk_snapshot, snapshot_sha256: f.row.risk_snapshot_sha256 }] };
    if (sql.startsWith('SELECT policy,')) return { rows: [{ policy: f.policy, policy_sha256: riskHash(f.policy) }] };
    if (sql.includes('INSERT INTO platform.local_alerts')) return { rows: [{ alert_id: f.row.alert_id }] };
    return { rows: [] };
  } }));
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = 'lmps_intake'; url.password = randomUUID();
  return { base, f, calls, dsn: url.toString(), file: join(base, 'v1', f.generation.assessment_run_id, 'input.json') };
}
test('private manifest worker generates one grouped alert and emits only status/reason/reference', async t => {
  const { base, f, dsn } = await setup(t), result = await generateAlerts(base, f.generation.assessment_run_id, dsn);
  assert.deepEqual(result, { status: 'inserted', reason_code: 'ALERT_CREATED', alert_id: f.row.alert_id });
  assert.ok(!JSON.stringify(result).includes('900.00')); assert.ok(!JSON.stringify(result).includes('synthetic_A'));
});
test('worker rejects unsafe files, wrong IDs and live mode before any connection', async t => {
  const { base, f, dsn, file, calls } = await setup(t); await chmod(file, 0o644);
  await assert.rejects(generateAlerts(base, f.generation.assessment_run_id, dsn), /diagnostics withheld/); await chmod(file, 0o600);
  await assert.rejects(generateAlerts(base, randomUUID(), dsn), /diagnostics withheld/);
  const before = process.env.LMPS_EXECUTION_MODE; process.env.LMPS_EXECUTION_MODE = 'live';
  try { await assert.rejects(generateAlerts(base, f.generation.assessment_run_id, dsn), /diagnostics withheld/); }
  finally { if (before === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = before; }
  assert.equal(calls.length, 0);
});
