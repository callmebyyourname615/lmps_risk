import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateBacktest, ruleEvidenceHash } from '@lmps/database';
import { assessmentFixture } from '../../../packages/database/test/fixtures/rule-assessment.mjs';
import { createApp } from '../dist/app.js';
import { POSTGRES_DATABASE } from '../dist/postgres.service.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temporary, app, auth, runs, versions, failed, calls;
const rulePath = '/v1/local/rules/synthetic_amount/versions';
const firstId = '11111111-1111-4111-8111-111111111111', nextId = '22222222-2222-4222-8222-222222222222';
const request = async (url, scope, changes = {}, options = {}) => app.inject({ method: 'GET', url,
  headers: { ...(scope ? { authorization: 'Bearer ' + await auth.token({ scope, ...changes }) } : {}), 'x-request-id': 'SYNTHETIC_PRIVATE_VALUE' }, ...options });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-assessments-inject-'); auth = await authFixture(temporary);
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = 'lmps_app'; url.password = randomUUID();
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: url.toString(), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
  // Exercise real Nest/Fastify/JWT handling without a listener; native SQL has separate integration tests.
  app.get(POSTGRES_DATABASE).pool.query = async (sql, args) => {
    calls.push({ sql, args }); if (failed) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    if (args[0] !== 'synthetic_local') return { rows: [] };
    if (sql.includes('platform.local_rule_versions')) return { rows: versions.filter(row => row.definition.rule_id === args[1] && row.rule_version > args[2]).slice(0, args[3]) };
    if (sql.includes('platform.local_assessment_runs')) return { rows: runs.filter(row => sql.includes('run_id=$2::uuid') ? row.run_id === args[1] : !args[1] || row.run_id > args[1]).slice(0, args[2]) };
    throw new Error('Unexpected query');
  };
  await app.init();
});
beforeEach(() => {
  failed = false; calls = []; const f = assessmentFixture();
  runs = [firstId, nextId].map(run_id => {
    const report = evaluateBacktest({ ...f.manifest, run_id }, f.observations);
    return { run_id, report, report_sha256: ruleEvidenceHash(report) };
  });
  versions = ['synthetic_v1', 'synthetic_v2'].map(rule_version => {
    const definition = { ...f.manifest.rules[0], rule_version };
    return { rule_version, definition, rule_sha256: ruleEvidenceHash(definition) };
  });
});
after(async () => { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });

test('rule and assessment HTTP routes require independent verified scopes and return no-store responses', async () => {
  for (const [path, scope] of [[rulePath, 'rules:read'], ['/v1/local/assessments', 'assessments:read'], ['/v1/local/assessments/' + firstId, 'assessments:read']]) {
    const unauthorized = await request(path); assert.equal(unauthorized.statusCode, 401); assert.match(unauthorized.headers['www-authenticate'], /^Bearer/);
    assert.equal(unauthorized.headers['cache-control'], 'no-store'); assert.notEqual(unauthorized.headers['x-request-id'], 'SYNTHETIC_PRIVATE_VALUE');
    for (const denied of ['source:read', 'operations:read', 'audit:read', 'sync:read', 'transactions:read', scope === 'rules:read' ? 'assessments:read' : 'rules:read'])
      assert.equal((await request(path, denied)).statusCode, 403);
    assert.equal((await request(path, scope)).statusCode, 200);
  }
});

test('rule versions paginate lexically and assessment summaries/details preserve frozen exact evidence', async () => {
  const first = (await request(rulePath + '?limit=1', 'rules:read')).json();
  assert.equal(first.items[0].rule_version, 'synthetic_v1'); assert.equal(first.next_cursor, 'synthetic_v1');
  const next = (await request(rulePath + '?limit=1&after=' + first.next_cursor, 'rules:read')).json();
  assert.equal(next.items[0].rule_version, 'synthetic_v2'); assert.equal(next.next_cursor, null);
  const page = (await request('/v1/local/assessments?limit=1', 'assessments:read')).json();
  assert.equal(page.items[0].run_id, firstId); assert.equal(page.next_cursor, firstId); assert.equal(page.enforcement, false);
  assert.equal(page.items[0].report, undefined); assert.equal(page.items[0].counts.targets, 1);
  const last = (await request('/v1/local/assessments?limit=1&after=' + page.next_cursor, 'assessments:read')).json();
  assert.equal(last.items[0].run_id, nextId); assert.equal(last.next_cursor, null);
  const detail = (await request('/v1/local/assessments/' + firstId, 'assessments:read')).json();
  assert.deepEqual(detail.report, runs[0].report); assert.equal(detail.report_sha256, runs[0].report_sha256);
  assert.equal(detail.report.rows[0].results[0].evidence.amount, '9999999999999999999999.99');
  assert.equal(detail.report.historical_availability, 'unverified');
  assert.ok(calls.every(call => !call.sql.includes('local_transaction_revisions')));
});

test('verified workspace controls all queries and missing/foreign IDs reveal no evidence', async () => {
  assert.deepEqual((await request(rulePath, 'rules:read', { workspace_key: 'synthetic_other' })).json().items, []);
  assert.deepEqual((await request('/v1/local/assessments', 'assessments:read', { workspace_key: 'synthetic_other' })).json().items, []);
  assert.deepEqual((await request('/v1/local/assessments/' + firstId, 'assessments:read', { workspace_key: 'synthetic_other' })).json(), { report: null, report_sha256: null });
  assert.deepEqual((await request('/v1/local/assessments/33333333-3333-4333-8333-333333333333', 'assessments:read')).json(), { report: null, report_sha256: null });
  assert.deepEqual((await request(rulePath.replace('synthetic_amount', 'synthetic_missing'), 'rules:read')).json().items, []);
});

test('invalid paths, duplicate/oversized pagination and workspace overrides reject before querying; no HTTP mutations', async () => {
  for (const [base, scope, queries] of [[rulePath, 'rules:read', ['limit=0', 'limit=101', 'after=bad', 'after=', 'after=synthetic_v1&after=synthetic_v2']],
    ['/v1/local/assessments', 'assessments:read', ['limit=11', 'after=bad', 'after=', 'limit=1&limit=2']]]) {
    for (const query of [...queries, 'limit=01', 'limit[]=1', 'workspace_key=synthetic_other']) assert.equal((await request(base + '?' + query, scope)).statusCode, 400);
  }
  assert.equal((await request(rulePath.replace('synthetic_amount', 'real'), 'rules:read')).statusCode, 400);
  assert.equal((await request('/v1/local/assessments/invalid', 'assessments:read')).statusCode, 400);
  assert.equal((await request('/v1/local/assessments/' + firstId + '?limit=1', 'assessments:read')).statusCode, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('/v1/local/assessments', 'assessments:read', {}, { method: 'POST', payload: { value: 'SYNTHETIC_PRIVATE_VALUE' } })).statusCode, 404);
});

test('storage outages and corrupt/rehashed stored evidence fail closed without raw values', async () => {
  failed = true;
  for (const [path, scope] of [[rulePath, 'rules:read'], ['/v1/local/assessments', 'assessments:read'], ['/v1/local/assessments/' + firstId, 'assessments:read']]) {
    const response = await request(path, scope); assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('PRIVATE'));
  }
  failed = false; versions[0].definition.extra = 'SYNTHETIC_PRIVATE_VALUE';
  assert.equal((await request(rulePath, 'rules:read')).statusCode, 503);
  runs[0].report.rows[0].results[0].evidence.extra = 'SYNTHETIC_PRIVATE_VALUE'; runs[0].report_sha256 = ruleEvidenceHash(runs[0].report);
  const response = await request('/v1/local/assessments/' + firstId, 'assessments:read');
  assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('PRIVATE'));
});

test('OpenAPI describes three read routes and readiness remains unavailable', async () => {
  const doc = (await app.inject('/openapi.json')).json();
  for (const path of ['/v1/local/rules/{rule_id}/versions', '/v1/local/assessments', '/v1/local/assessments/{run_id}']) {
    assert.deepEqual(Object.keys(doc.paths[path]), ['get']);
    assert.ok(doc.paths[path].get.security);
    for (const code of ['200', '400', '401', '403', '503']) assert.ok(doc.paths[path].get.responses[code]);
  }
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
});
