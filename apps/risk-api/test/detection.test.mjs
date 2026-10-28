import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { detectionFixture } from './fixtures/detection.mjs';
import { DetectionRuntime } from '../dist/detection-runtime.js';
import { dsn } from '../../../packages/database/scripts/local.mjs';
import { createDatabase, readDetectionHealth } from '@lmps/database';
let fixture;
before(async () => { fixture = await detectionFixture(); });
after(async () => { await fixture?.close(); });
async function request(path = '/health', changes = {}, body) {
  return fixture.app.inject({ method: body ? 'POST' : 'GET', url: '/v1/local/detection' + path,
    headers: { authorization: 'Bearer ' + await fixture.token(changes) }, ...(body ? { payload: body } : {}) });
}
test('coverage requires normalization, active approval and an unambiguous pinned alert policy', async () => {
  await fixture.append('synthetic_new'); await fixture.append('synthetic_unknown', 0, false);
  let response = await request(); assert.equal(response.statusCode, 200);
  let health = response.json(); assert.equal(health.counts.waiting_policy, 1); assert.equal(health.counts.not_normalized, 1);
  assert.equal(await fixture.handoff.handoff(), 0);
  await fixture.approve(); health = (await request()).json(); assert.equal(health.counts.waiting_alert_policy, 1);
  await fixture.template(); health = (await request()).json(); assert.equal(health.counts.ready, 1);
  assert.equal(health.availability.source_lag_seconds, null); assert.equal(health.availability.account_identity, 'unverified');
  assert.equal((await request('', { scope: 'risk-jobs:read' })).statusCode, 404);
});
test('concurrent automatic dispatch deduplicates, freezes null context and processes current revisions only', async () => {
  const counts = await Promise.all([fixture.handoff.handoff(), fixture.handoff.handoff()]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 1);
  const saved = (await fixture.owner.pool.query("SELECT manifest FROM platform.local_risk_jobs WHERE transaction_id='synthetic_new'")).rows;
  assert.equal(saved.length, 1); assert.equal(saved[0].manifest.risk_request.context, null);
  assert.equal(await fixture.handoff.work(), 2);
  const health = (await request()).json(); assert.equal(health.counts.completed, 2); assert.equal(health.counts.with_assessment, 2);
  assert.ok(health.counts.missing_inputs >= 1); assert.ok(health.rows.find(row => row.transaction_id === 'synthetic_new').reasons.length);
  await fixture.append('synthetic_new', 1);
  assert.equal(await fixture.handoff.handoff(), 1); assert.equal(await fixture.handoff.work(), 1);
  assert.equal((await request()).json().rows.find(row => row.transaction_id === 'synthetic_new').revision_number, 2);
});
test('retry requires a separate scope, optimistic concurrency and never resets the eight-attempt ceiling', async () => {
  const reference = await fixture.template('synthetic_retry');
  const claim = await fixture.jobs.claim(reference); assert.equal(claim.status, 'claimed');
  await fixture.jobs.fail(claim.claim, 'JOB_STORAGE_UNAVAILABLE');
  await fixture.owner.pool.query("UPDATE platform.local_risk_jobs SET next_attempt_at=clock_timestamp()+interval '60 seconds' WHERE job_ref=$1", [reference]);
  const health = (await request()).json(), row = health.rows.find(value => value.job_ref === reference);
  assert.equal(row.retryable, true);
  const body = { attempt_number: row.attempt_number, updated_at: row.updated_at };
  assert.equal((await request('/jobs/' + reference + '/retry', {}, body)).statusCode, 403);
  const operator = { scope: 'risk-jobs:read risk-jobs:retry' };
  const responses = await Promise.all([request('/jobs/' + reference + '/retry', operator, body), request('/jobs/' + reference + '/retry', operator, body)]);
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
  assert.equal(await fixture.handoff.work(), 1);
  assert.equal((await request()).json().rows.find(value => value.job_ref === reference).attempt_number, 2);
  assert.equal((await request('/jobs/' + reference + '/retry', operator, { ...body, attempt_number: 8 })).statusCode, 400);
});
test('scheduled runtime discovers and finishes an eligible revision without a Portal click or explicit enqueue', async () => {
  await fixture.append('synthetic_automatic');
  const runtime = new DetectionRuntime(dsn(fixture.state, 'intake'), true, 1000);
  try {
    runtime.onModuleInit();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const health = (await request()).json();
      if (health.rows.find(row => row.transaction_id === 'synthetic_automatic')?.state === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await request()).json().rows.find(row => row.transaction_id === 'synthetic_automatic').state, 'completed');
    assert.equal(runtime.snapshot().state, 'running'); assert.equal(runtime.snapshot().last_enqueued, 1);
  } finally { await runtime.onApplicationShutdown(); }
});
test('eight transient attempts and permanent errors cannot be revived through operator retry', async () => {
  const reference = await fixture.template('synthetic_exhausted');
  for (let attempt = 1; attempt <= 8; attempt++) {
    const result = await fixture.jobs.claim(reference); assert.equal(result.status, 'claimed'); assert.equal(result.claim.attempt_number, attempt);
    await fixture.jobs.fail(result.claim, 'JOB_STORAGE_UNAVAILABLE');
    if (attempt < 8) await fixture.owner.pool.query('UPDATE platform.local_risk_jobs SET next_attempt_at=clock_timestamp() WHERE job_ref=$1', [reference]);
  }
  assert.equal((await fixture.jobs.claim(reference)).status, 'idle');
  let row = (await request()).json().rows.find(row => row.job_ref === reference);
  assert.equal(row.state, 'failed'); assert.equal(row.retryable, false); assert.equal(row.attempt_number, 8);
  const operator = { scope: 'risk-jobs:read risk-jobs:retry' };
  assert.equal((await request('/jobs/' + reference + '/retry', operator, { attempt_number: 7, updated_at: row.updated_at })).statusCode, 409);
  const permanent = await fixture.template('synthetic_permanent'), claim = await fixture.jobs.claim(permanent);
  await fixture.jobs.fail(claim.claim, 'JOB_INPUT_CONFLICT');
  row = (await request()).json().rows.find(row => row.job_ref === permanent);
  assert.equal(row.retryable, false); assert.equal((await request('/jobs/' + permanent + '/retry', operator, { attempt_number: 1, updated_at: row.updated_at })).statusCode, 409);
});
test('handoff failure does not prevent recovery of a previously frozen eligible job', async () => {
  const reference = await fixture.template('synthetic_pinned_recovery');
  const runtime = new DetectionRuntime(dsn(fixture.state, 'intake'), true);
  runtime.service.handoff = async () => { throw new Error('synthetic dispatcher unavailable'); };
  try {
    await runtime.tick();
    assert.equal(runtime.snapshot().state, 'unavailable'); assert.equal(runtime.snapshot().last_enqueued, null); assert.equal(runtime.snapshot().last_processed, 1);
    assert.equal((await request()).json().rows.find(row => row.job_ref === reference).state, 'completed');
  } finally { await runtime.onApplicationShutdown(); }
});
test('different pinned alert policies block new dispatch; malformed and foreign scopes cannot leak records', async () => {
  await fixture.template('synthetic_other_policy', { ...fixture.input.alert_policy, version: 'synthetic_v2', minimum_severity: 'critical' });
  await fixture.append('synthetic_ambiguous');
  const health = (await request()).json(); assert.equal(health.counts.policy_ambiguous, 1); assert.equal(await fixture.handoff.handoff(), 0);
  assert.equal((await request('/health?currency=SYN&currency=USD')).statusCode, 400);
  assert.equal((await request('/health?unknown=1')).statusCode, 400);
  assert.equal((await request('/health', { scope: 'risk-jobs:read' })).statusCode, 403);
  const foreign = (await request('/health', { workspace_key: 'synthetic_other' })).json(); assert.equal(foreign.rows.length, 0); assert.equal(foreign.policies.length, 0);
  const reader = createDatabase(dsn(fixture.state));
  try {
    const scoped = await readDetectionHealth(reader.pool, 'synthetic_other', { namespace: null, currency: null }, { configured: true, enabled: true, state: 'running', last_completed_at: new Date().toISOString(), last_enqueued: 10, last_processed: 5, interval_seconds: 2 });
    assert.equal(scoped.worker.enabled, false); assert.equal(scoped.worker.last_enqueued, null); assert.equal(scoped.worker.last_processed, null);
  } finally { await reader.close(); }
});
test('database outage is redacted and never represented as an empty healthy queue', async () => {
  await fixture.stopDatabase();
  try { const response = await request(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'DETECTION_UNAVAILABLE'); assert.ok(!response.body.includes('postgres')); }
  finally { await fixture.startDatabase(); }
});
