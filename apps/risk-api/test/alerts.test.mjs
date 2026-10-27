import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AlertError, riskHash, projectAlert, evaluateTransactionRisk } from '@lmps/risk';
import { validateAlertRow } from '@lmps/database';
import { alertFixture } from '../../../packages/database/test/fixtures/alert.mjs';
import { createApp } from '../dist/app.js';
import { POSTGRES_DATABASE } from '../dist/postgres.service.js';
import { ALERT_REVIEWS } from '../dist/alerts.controller.js';
import { readConfig } from '../dist/config.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, app, auth, f, rows, failed, calls, reviewCalls, env;
const dsn = role => { const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = role; url.password = randomUUID(); return url.toString(); };
const request = async (method, url, { scope = 'alerts:read', language = 'en', payload, workspace_key = 'synthetic_local', ...rest } = {}) => app.inject({ method, url, ...rest,
  headers: { ...(scope ? { authorization: 'Bearer ' + await auth.token({ scope, workspace_key, sub: 'synthetic_reviewer' }) } : {}), 'accept-language': language }, ...(payload === undefined ? {} : { payload }) });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-alert-http-'); auth = await authFixture(temporary);
  env = { LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn('lmps_app'), LMPS_LOCAL_AUTH_CONFIG: auth.path, LMPS_LOCAL_REVIEW_DSN: dsn('lmps_reviewer') };
  ({ app } = await createApp(env));
  app.get(POSTGRES_DATABASE).pool.query = async (sql, args) => {
    calls.push({ sql, args }); if (failed) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    if (!args || args[0] !== 'synthetic_local') return { rows: [] };
    if (sql.includes('a.alert_id=$2')) return { rows: rows.filter(row => row.alert_id === args[1]) };
    return { rows: rows.filter(row => (!args[1] || row.alert_id > args[1]) && (!args[2] || row.severity === args[2])
      && (!args[3] || row.snapshot.selected_risk_types.includes(args[3])) && (!args[4] || ['open', 'acknowledged', 'reviewed'][row.history.length] === args[4])).slice(0, args[5]) };
  };
  app.get(ALERT_REVIEWS).review = async (workspace, id, actor, command) => {
    reviewCalls.push({ workspace, id, actor, command });
    if (failed) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    const row = rows.find(r => r.alert_id === id); if (workspace !== 'synthetic_local' || !row) throw new AlertError('ALERT_NOT_FOUND');
    const saved = row.history.find(e => e.request_id === command.request_id);
    if (saved) return { status: 'duplicate', view: validateAlertRow(row, workspace) };
    if (command.expected_version !== row.history.length) throw new AlertError('ALERT_REVIEW_CONFLICT');
    row.history.push({ ...f.event(command), actor_subject: actor }); return { status: 'inserted', view: validateAlertRow(row, workspace) };
  };
  await app.init();
});
beforeEach(() => { f = alertFixture(); rows = [f.row]; failed = false; calls = []; reviewCalls = []; });
after(async () => { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });
test('alert reads and reviews require independent scopes and JWT identity; neither scope alone can review', async () => {
  const path = '/v1/local/alerts/' + f.row.alert_id;
  const unauth = await request('GET', path, { scope: null, language: 'lo' }); assert.equal(unauth.statusCode, 401); assert.match(unauth.json().message, /[\u0e80-\u0eff]/);
  for (const scope of ['risk:read', 'assessments:read', 'alerts:review']) assert.equal((await request('GET', path, { scope })).statusCode, 403);
  for (const scope of ['alerts:read', 'alerts:review', 'risk:read']) assert.equal((await request('POST', path + '/reviews', { scope, payload: f.ack })).statusCode, 403);
  assert.equal(calls.length, 0); assert.equal(reviewCalls.length, 0);
  const accepted = await request('POST', path + '/reviews', { scope: 'alerts:read alerts:review', payload: f.ack }); assert.equal(accepted.statusCode, 201);
  assert.equal(reviewCalls[0].actor, 'synthetic_reviewer'); assert.equal(accepted.json().alert.history[0].actor_subject, 'synthetic_reviewer');
});
test('Lao/English details retain scores, evidence and core hashes; catalog covers statuses and outcome semantics', async () => {
  const path = '/v1/local/alerts/' + f.row.alert_id;
  const lo = await request('GET', path, { language: 'lo' }), en = await request('GET', path), alias = await request('GET', path, { language: 'la' });
  assert.equal(lo.statusCode, 200); assert.equal(lo.headers['content-language'], 'lo'); assert.equal(lo.headers['cache-control'], 'no-store'); assert.equal(lo.headers.vary, 'Accept-Language');
  assert.equal(lo.json().alert.core_sha256, en.json().alert.core_sha256); assert.equal(alias.json().alert.core_sha256, lo.json().alert.core_sha256);
  assert.deepEqual(lo.json().alert.fraud_score, en.json().alert.fraud_score); assert.deepEqual(lo.json().alert.assessment.findings.map(f => f.evidence_refs), en.json().alert.assessment.findings.map(f => f.evidence_refs));
  assert.equal(lo.json().alert.selected_risk_types.length, 15); assert.match(lo.json().alert.state_message, /[\u0e80-\u0eff]/);
  const catalog = await request('GET', '/v1/local/alerts/catalog', { language: 'lo' }); assert.equal(catalog.statusCode, 200);
  assert.ok(catalog.json().codes.some(c => c.code === 'unknown')); assert.match(catalog.json().review_semantics, /[\u0e80-\u0eff]/);
});
test('inbox is bounded, filtered and workspace scoped; detail and mutations hide foreign IDs', async () => {
  const first = f.row.alert_id; rows.push({ ...structuredClone(f.row), alert_id: randomUUID() }); rows.sort((a, b) => a.alert_id.localeCompare(b.alert_id));
  const page = await request('GET', '/v1/local/alerts?limit=1&severity=high&state=open&risk_code=FRAUD_HIGH_AMOUNT');
  assert.equal(page.json().items.length, 1); assert.equal(page.json().next_cursor, rows[0].alert_id); assert.ok(!('history' in page.json().items[0]));
  const next = await request('GET', '/v1/local/alerts?limit=1&after=' + page.json().next_cursor); assert.equal(next.json().items.length, 1); assert.equal(next.json().next_cursor, null);
  assert.equal((await request('GET', '/v1/local/alerts/' + first, { workspace_key: 'synthetic_other' })).json().alert, null);
  assert.deepEqual((await request('GET', '/v1/local/alerts', { workspace_key: 'synthetic_other' })).json().items, []);
  assert.equal((await request('POST', '/v1/local/alerts/' + first + '/reviews', { workspace_key: 'synthetic_other', scope: 'alerts:read alerts:review', payload: f.ack })).statusCode, 404);
});
test('a partial assessment keeps null dimension scores and its missing-data response visible in the inbox', async () => {
  const risk = f.row.risk_snapshot; risk.request.context.flagged_accounts = null; risk.request.context.flagged_accounts_version = null;
  risk.result = evaluateTransactionRisk(risk.request, risk.observation); f.row.risk_snapshot_sha256 = riskHash(risk);
  f.row.snapshot = projectAlert(risk.result, f.policy).snapshot; f.row.snapshot_sha256 = riskHash(f.row.snapshot);
  const response = await request('GET', '/v1/local/alerts', { language: 'lo' }); assert.equal(response.statusCode, 200);
  const item = response.json().items[0]; assert.equal(item.assessment_status, 'partial'); assert.equal(item.response_code, 'RISK_ASSESSMENT_PARTIAL');
  assert.equal(item.mule_network_score.value, null); assert.match(item.response_message, /[\u0e80-\u0eff]/); assert.equal(item.selected_risk_types.length, 14);
});
test('acknowledge and review expose versions, immutable actor history, terminal unknown and retry status', async () => {
  const path = '/v1/local/alerts/' + f.row.alert_id + '/reviews', options = { scope: 'alerts:read alerts:review', language: 'lo' };
  const ack = await request('POST', path, { ...options, payload: f.ack }); assert.equal(ack.json().alert.version, 1);
  const reviewed = await request('POST', path, { ...options, payload: f.review }); assert.equal(reviewed.json().alert.version, 2); assert.equal(reviewed.json().alert.outcome, 'unknown');
  assert.equal(reviewed.json().alert.history.length, 2); assert.match(reviewed.json().alert.outcome_message, /[\u0e80-\u0eff]/);
  const retry = await request('POST', path, { ...options, payload: f.ack }); assert.equal(retry.json().status, 'duplicate'); assert.equal(retry.json().alert.version, 2);
  assert.equal((await request('POST', path, { ...options, payload: { ...f.review, request_id: randomUUID() } })).statusCode, 409);
});
test('unknown fields, actor overrides, invalid filters/cursors and malformed review actions reject before storage', async () => {
  for (const suffix of ['?limit=0', '?limit=11', '?limit=01', '?limit=1&limit=2', '?state=closed', '?severity=huge', '?risk_code=UNKNOWN', '?after=bad', '?workspace_key=synthetic_other', '/catalog?lang=en']) {
    const response = await request('GET', '/v1/local/alerts' + suffix, { language: 'lo' }); assert.equal(response.statusCode, 400); assert.match(response.json().message, /[\u0e80-\u0eff]/);
  }
  for (const change of [c => c.actor_subject = 'SYNTHETIC_PRIVATE_VALUE', c => c.outcome = 'legitimate', c => c.expected_version = '0', c => c.note = 'a'.repeat(1001)]) {
    const command = structuredClone(f.ack); change(command);
    const response = await request('POST', '/v1/local/alerts/' + f.row.alert_id + '/reviews', { scope: 'alerts:read alerts:review', payload: command });
    assert.equal(response.statusCode, 400); assert.ok(!response.body.includes('PRIVATE'));
  }
  assert.equal(calls.length, 0); assert.equal(reviewCalls.length, 0);
});
test('storage outages and rehashed corrupt evidence return redacted localized errors', async () => {
  const path = '/v1/local/alerts/' + f.row.alert_id; failed = true;
  for (const language of ['lo', 'en']) { const response = await request('GET', path, { language }); assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('PRIVATE')); }
  failed = false; f.row.snapshot.selected_risk_types.pop(); f.row.snapshot_sha256 = riskHash(f.row.snapshot);
  assert.equal((await request('GET', path)).statusCode, 503);
});
test('malformed JSON at the review boundary is redacted and cannot echo submitted text', async () => {
  const response = await app.inject({ method: 'POST', url: '/v1/local/alerts/' + f.row.alert_id + '/reviews',
    headers: { authorization: 'Bearer ' + await auth.token({ scope: 'alerts:read alerts:review' }), 'content-type': 'application/json', 'accept-language': 'lo' },
    payload: '{"request_id":"SYNTHETIC_PRIVATE_VALUE", broken}' });
  assert.equal(response.statusCode, 400); assert.ok(!response.body.includes('PRIVATE'));
  assert.match(response.json().message, /[\u0e80-\u0eff]/); assert.equal(reviewCalls.length, 0);
});
test('missing review configuration fails closed; wrong writer roles and unauthenticated write configuration are rejected', async () => {
  const { LMPS_LOCAL_REVIEW_DSN, ...readonlyEnv } = env, created = await createApp(readonlyEnv);
  try {
    await created.app.init(); const response = await created.app.inject({ method: 'POST', url: '/v1/local/alerts/' + f.row.alert_id + '/reviews',
      headers: { authorization: 'Bearer ' + await auth.token({ scope: 'alerts:read alerts:review' }), 'accept-language': 'lo' }, payload: f.ack });
    assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'ALERT_REVIEW_NOT_CONFIGURED');
  } finally { await created.app.close(); }
  for (const role of ['lmps_app', 'lmps_intake', 'lmps_migrator']) assert.throws(() => readConfig({ ...env, LMPS_LOCAL_REVIEW_DSN: dsn(role) }));
  assert.throws(() => readConfig({ ...env, LMPS_LOCAL_REVIEW_DSN: env.LMPS_LOCAL_REVIEW_DSN.replace(':18599/', ':18598/') }));
  assert.throws(() => readConfig({ LMPS_LOCAL_REVIEW_DSN }));
});
test('OpenAPI documents review mutation, mandatory scopes, filters, body shape and conflict responses', async () => {
  const doc = (await app.inject('/openapi.json')).json();
  const mutation = doc.paths['/v1/local/alerts/{alert_id}/reviews'].post;
  assert.ok(mutation.security); assert.ok(mutation.responses['409']); assert.ok(mutation.responses['404']);
  assert.deepEqual(mutation.requestBody.content['application/json'].schema.required.sort(), ['action', 'expected_version', 'note', 'outcome', 'request_id']);
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
});
