import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateTransactionRisk, riskHash, validateRiskRequest } from '@lmps/risk';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { createApp } from '../dist/app.js';
import { POSTGRES_DATABASE } from '../dist/postgres.service.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, app, auth, rows, failed, calls, fixture;
const firstId = '11111111-1111-4111-8111-111111111111', secondId = '22222222-2222-4222-8222-222222222222';
const detail = '/v1/local/risk-assessments/' + firstId;
const history = '/v1/local/transactions/synthetic_snapshot/synthetic_target/revisions/1/risk-assessments';
const get = async (url, language, scope = 'risk:read', changes = {}) => app.inject({ method: 'GET', url,
  headers: { ...(scope ? { authorization: 'Bearer ' + await auth.token({ scope, ...changes }) } : {}), ...(language ? { 'accept-language': language } : {}) } });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-risk-http-'); auth = await authFixture(temporary);
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = 'lmps_app'; url.password = randomUUID();
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: url.toString(), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
  app.get(POSTGRES_DATABASE).pool.query = async (sql, args) => {
    calls.push({ sql, args }); if (failed) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    if (args[0] !== 'synthetic_local') return { rows: [] };
    if (sql.includes('run_id=$2')) return { rows: rows.filter(row => row.run_id === args[1]) };
    return { rows: rows.filter(row => row.namespace === args[1] && row.transaction_id === args[2] && row.revision_number === args[3] && (!args[4] || row.run_id > args[4])).slice(0, args[5]) };
  };
  await app.init();
});
beforeEach(() => {
  failed = false; calls = []; fixture = transactionRiskFixture();
  rows = [firstId, secondId].map(run_id => {
    const request = validateRiskRequest({ ...fixture.request, run_id }), observation = fixture.observation;
    const snapshot = { request, observation, result: evaluateTransactionRisk(request, observation) };
    return { run_id, ...request.target, snapshot, snapshot_sha256: riskHash(snapshot) };
  });
});
after(async () => { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });

test('risk reads use independent JWT/workspace scope and localized auth errors without cacheable responses', async () => {
  for (const path of [detail, history, '/v1/local/risk/catalog']) {
    const denied = await get(path, 'lo', null); assert.equal(denied.statusCode, 401); assert.match(denied.json().message, /[\u0e80-\u0eff]/);
    assert.match(denied.headers['www-authenticate'], /^Bearer/); assert.equal(denied.headers['cache-control'], 'no-store');
    for (const scope of ['source:read', 'transactions:read', 'assessments:read', 'rules:read']) assert.equal((await get(path, 'en', scope)).statusCode, 403);
    assert.equal((await get(path, 'en')).statusCode, 200);
  }
});
test('Lao defaults, la alias, English and fallback change text while preserving codes, evidence, scores and core hash', async () => {
  const lao = await get(detail), english = await get(detail, 'en-US'), alias = await get(detail, 'la');
  assert.equal(lao.headers['content-language'], 'lo'); assert.equal(english.headers['content-language'], 'en'); assert.equal(lao.headers.vary, 'Accept-Language');
  assert.equal(alias.json().core_sha256, lao.json().core_sha256); assert.equal(english.json().core_sha256, lao.json().core_sha256);
  assert.deepEqual(english.json().assessment.fraud_score, lao.json().assessment.fraud_score);
  assert.equal(lao.json().assessment.risk_types.length, 15); assert.equal(lao.json().assessment.fraud_score.value, 1);
  assert.match(lao.json().assessment.response_message, /[\u0e80-\u0eff]/); assert.notEqual(english.json().assessment.response_message, lao.json().assessment.response_message);
  assert.deepEqual(english.json().assessment.findings.map(f => f.evidence_refs), lao.json().assessment.findings.map(f => f.evidence_refs));
  assert.equal((await get(detail, 'fr')).headers['content-language'], 'en');
  for (const locale of ['lo', 'en']) {
    const catalog = (await get('/v1/local/risk/catalog', locale)).json(); assert.equal(catalog.risk_types.length, 15); assert.ok(catalog.codes.length > 25); assert.ok(catalog.statuses.length);
  }
});
test('history is bounded, pinned to one revision and paginated in UUID order', async () => {
  const first = (await get(history + '?limit=1', 'en')).json(); assert.equal(first.items.length, 1); assert.equal(first.next_cursor, firstId);
  const last = (await get(history + '?limit=1&after=' + first.next_cursor, 'en')).json(); assert.equal(last.items[0].assessment.run_id, secondId); assert.equal(last.next_cursor, null);
  assert.ok(calls.every(call => !call.sql.includes('local_transaction_revisions')));
  assert.deepEqual((await get(history.replace('/revisions/1/', '/revisions/2/'), 'en')).json().items, []);
  assert.equal((await get(detail, 'en', 'risk:read', { workspace_key: 'synthetic_other' })).json().assessment, null);
  assert.deepEqual((await get(history, 'en', 'risk:read', { workspace_key: 'synthetic_other' })).json().items, []);
});
test('overrides, duplicate parameters, invalid cursors/IDs and mutations reject without echoing input', async () => {
  for (const path of [history + '?limit=11', history + '?limit=01', history + '?limit=1&limit=2', history + '?after=bad', history + '?workspace_key=synthetic_other',
    detail + '?extra=SYNTHETIC_PRIVATE_VALUE', '/v1/local/risk-assessments/invalid', '/v1/local/risk/catalog?language=en', history.replace('/revisions/1/', '/revisions/0/')]) {
    const response = await get(path, 'lo'); assert.equal(response.statusCode, 400); assert.match(response.json().message, /[\u0e80-\u0eff]/); assert.ok(!response.body.includes('PRIVATE'));
  }
  assert.equal(calls.length, 0);
  assert.equal((await app.inject({ method: 'POST', url: detail, payload: {} })).statusCode, 404);
});
test('storage outages and rehashed corrupt scores return redacted localized503 responses', async () => {
  failed = true; let response = await get(detail, 'lo'); assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('PRIVATE')); assert.match(response.json().message, /[\u0e80-\u0eff]/);
  failed = false; rows[0].snapshot.result.fraud_score.value = 0; rows[0].snapshot_sha256 = riskHash(rows[0].snapshot);
  response = await get(detail, 'en'); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'RISK_STORAGE_UNAVAILABLE');
});
test('OpenAPI advertises read-only risk routes, and readiness stays503', async () => {
  const doc = (await app.inject('/openapi.json')).json();
  for (const path of ['/v1/local/risk/catalog', '/v1/local/risk-assessments/{run_id}', '/v1/local/transactions/{namespace}/{transaction_id}/revisions/{revision_number}/risk-assessments']) {
    assert.deepEqual(Object.keys(doc.paths[path]), ['get']); assert.ok(doc.paths[path].get.security);
    for (const status of ['200', '400', '401', '403', '503']) assert.ok(doc.paths[path].get.responses[status]);
  }
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
});
