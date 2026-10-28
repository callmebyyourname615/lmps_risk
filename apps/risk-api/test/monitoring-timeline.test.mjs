import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { riskHash } from '@lmps/risk';
import { timelineFixture } from './fixtures/timeline.mjs';
import { revision } from '../../../packages/database/test/fixtures/transaction-revision.mjs';
let fixture;
before(async () => { fixture = await timelineFixture(); });
after(async () => { await fixture?.close(); });
async function read(target = fixture.target, changes = {}, suffix = '', locale = 'en') {
  return fixture.app.inject({ method: 'GET', url: '/v1/local/monitoring/timeline?' + new URLSearchParams(target) + suffix,
    headers: { authorization: 'Bearer ' + await fixture.token(changes), 'accept-language': locale } });
}
test('timeline includes historical revisions and their own assessments/alerts, with exact coverage and localized frozen proofs', async () => {
  const response = await read(); assert.equal(response.statusCode, 200); const value = response.json();
  assert.equal(value.version, 'local-monitoring-timeline-1'); assert.equal(value.revisions.length, 6); assert.equal(value.coverage.assessed_revisions, 5); assert.equal(value.coverage.missing_assessments, 1);
  assert.ok(value.alerts.some(row => row.revision_number === 1)); assert.ok(value.assessments.some(row => row.result.target.revision_number === 1));
  assert.ok(value.revisions.every((row, index) => row.revision_number === index + 1)); assert.equal(value.coverage.revision_history_complete, true);
  const stored = await fixture.owner.pool.query('SELECT run_id::text,snapshot FROM platform.local_transaction_risks WHERE run_id=ANY($1::uuid[])', [value.assessments.map(row => row.result.run_id)]);
  for (const row of value.assessments) assert.equal(row.core_sha256, riskHash(stored.rows.find(record => record.run_id === row.result.run_id).snapshot.result));
  const lao = (await read(fixture.target, {}, '', 'lo')).json(); assert.deepEqual(lao.assessments.map(row => row.core_sha256), value.assessments.map(row => row.core_sha256));
  assert.notEqual(lao.assessments[0].result.findings[0].title, value.assessments[0].result.findings[0].title);
  assert.deepEqual(lao.revisions, value.revisions);
});
test('requested and failed reversals never reduce executed value; completed evidence is exact and duplicate events do not double-count', async () => {
  const value = (await read()).json(), initial = value.revisions[0];
  for (const index of [2, 3]) { assert.equal(value.revisions[index].status, 'succeeded'); assert.equal(value.revisions[index].executed_amount, initial.amount); assert.equal(value.revisions[index].reversed_amount, '0.00'); }
  const partial = value.revisions[4], full = value.revisions[5];
  assert.equal(partial.status, 'partially_reversed'); assert.equal(BigInt(partial.executed_amount.replace('.', '')) + BigInt(partial.reversed_amount.replace('.', '')), BigInt(partial.amount.replace('.', '')));
  assert.equal(full.status, 'reversed'); assert.equal(full.reversed_amount, full.amount); assert.equal(full.executed_amount, '0.00');
  assert.ok(partial.changes.includes('status')); assert.equal(full.occurred_at, null);
});
test('multiple assessment runs on one revision retain separate immutable IDs without increasing assessed-revision coverage', async () => {
  const entry = fixture.entries[1], value = (await read({ namespace: entry.request.target.namespace, transaction_id: entry.id })).json();
  assert.equal(value.assessments.length, 2); assert.equal(value.coverage.assessed_revisions, 1); assert.equal(value.revisions.length, 1);
  assert.notEqual(value.assessments[0].result.run_id, value.assessments[1].result.run_id);
  assert.ok(value.assessments[0].recorded_at <= value.assessments[1].recorded_at);
});
test('scopes, strict coordinates and tenant isolation are enforced by the API', async () => {
  assert.equal((await read(fixture.target, { scope: 'transactions:read risk:read' })).statusCode, 403);
  for (const suffix of ['&namespace=synthetic_other', '&as_of=2026-01-01', '&workspace_key=synthetic_other']) assert.equal((await read(fixture.target, {}, suffix)).statusCode, 400);
  const foreign = (await read(fixture.target, { workspace_key: 'synthetic_other' })).json(); assert.equal(foreign.revisions.length, 0); assert.equal(foreign.assessments.length, 0); assert.equal(foreign.alerts.length, 0);
  const absent = (await read({ namespace: fixture.target.namespace, transaction_id: 'synthetic_absent' })).json(); assert.equal(absent.coverage.revisions, 0);
});
test('read-only evidence is frozen in the response and storage failures never become empty histories', async () => {
  const before = (await fixture.owner.pool.query('SELECT count(*)::int AS total FROM platform.local_transaction_revisions')).rows[0].total;
  await read(); assert.equal((await fixture.owner.pool.query('SELECT count(*)::int AS total FROM platform.local_transaction_revisions')).rows[0].total, before);
  await fixture.stopDatabase();
  try { const response = await read(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'MONITORING_UNAVAILABLE'); assert.equal(response.json().revisions, undefined); }
  finally { await fixture.startDatabase(); }
  assert.equal((await read()).statusCode, 200);
});
test('more than 100 revisions fails explicitly without truncating history or publishing partial coverage', async () => {
  const target = { namespace: 'synthetic_transactions', transaction_id: 'synthetic_history_bound' };
  for (let index = 0; index <= 100; index++) { const value = revision(index); value.transaction.transaction_id = target.transaction_id; await fixture.writer.append(value); }
  const response = await read(target); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'MONITORING_SCOPE_TOO_LARGE'); assert.equal(response.json().coverage, undefined);
});
