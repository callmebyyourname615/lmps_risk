import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { riskHash, validateRiskRequest } from '@lmps/risk';
import { transactionRiskFixture } from './fixtures/transaction-risk.mjs';
import { assessTransactionRisk } from '../../../apps/risk-workers/scripts/risk-assess.mjs';
import { savePrivateReport } from '../../../apps/risk-workers/scripts/private-json.mjs';

async function setup(t, source = true) {
  const temporary = await mkdtemp('/tmp/lmps-risk-private-'), base = join(temporary, 'inputs'), f = transactionRiskFixture(), policy = validateRiskRequest(f.request).policy;
  await savePrivateReport(base, 'v1', f.request.run_id, 'input.json', f.request, 384 * 1024);
  let saved; const calls = [];
  t.mock.method(pg.Pool.prototype, 'connect', async () => ({ release() {}, async query(sql, args) {
    calls.push(sql);
    if (sql.startsWith('SELECT snapshot,')) return { rows: saved ? [saved] : [] };
    if (sql.includes('SELECT payload,publication')) return { rows: source ? [{ payload: f.revision.transaction, publication: f.revision.publication }] : [] };
    if (sql.startsWith('SELECT policy,')) return { rows: [{ policy, policy_sha256: riskHash(policy) }] };
    if (sql.includes('INSERT INTO platform.local_transaction_risks')) saved = { snapshot: JSON.parse(args[7]), snapshot_sha256: args[8] };
    return { rows: [] };
  } }));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = 'lmps_intake'; url.password = randomUUID();
  return { base, f, calls, dsn: url.toString(), file: join(base, 'v1', f.request.run_id, 'input.json') };
}
test('private worker executes the real evaluator/repository code and exposes only run status, business code and counts', async t => {
  const { base, f, dsn } = await setup(t);
  const result = await assessTransactionRisk(base, f.request.run_id, dsn);
  assert.deepEqual(result, { status: 'inserted', run_id: f.request.run_id, assessment_status: 'complete', response_code: 'RISK_SIGNALS_DETECTED', triggered_types: 15 });
  assert.equal((await assessTransactionRisk(base, f.request.run_id, dsn)).status, 'duplicate');
  assert.ok(!JSON.stringify(result).includes('900.00')); assert.ok(!JSON.stringify(result).includes('synthetic_A'));
});
test('private worker retains an unavailable result when the explicit source target is missing', async t => {
  const { base, f, dsn } = await setup(t, false);
  const result = await assessTransactionRisk(base, f.request.run_id, dsn);
  assert.equal(result.assessment_status, 'unavailable'); assert.equal(result.response_code, 'RISK_ASSESSMENT_UNAVAILABLE'); assert.equal(result.triggered_types, 0);
});
test('private worker rejects unsafe files, mismatched IDs and live mode before database access', async t => {
  const { base, f, dsn, file, calls } = await setup(t); await chmod(file, 0o644);
  await assert.rejects(assessTransactionRisk(base, f.request.run_id, dsn), /diagnostics withheld/); await chmod(file, 0o600);
  await assert.rejects(assessTransactionRisk(base, randomUUID(), dsn), /diagnostics withheld/);
  const before = process.env.LMPS_EXECUTION_MODE; process.env.LMPS_EXECUTION_MODE = 'live';
  try { await assert.rejects(assessTransactionRisk(base, f.request.run_id, dsn), /diagnostics withheld/); }
  finally { if (before === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = before; }
  assert.equal(calls.length, 0);
});
