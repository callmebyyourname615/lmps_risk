import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions, createTransactionRisks } from '@lmps/database';
import {
  availablePort,
  dsn,
  initializeCluster,
  startCluster,
  stopCluster,
  loadState,
} from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { authFixture } from '../scripts/auth-fixture.mjs';

let temp, state, app, readOnlyApp, auth, reader, owner, writer, risks, f, policy, candidate;
const ws = 'synthetic_local',
  maker = 'synthetic_maker',
  checker = 'synthetic_checker';
const ref = (p) => ({ policy_id: p.policy_id, policy_version: p.version });
const cmd = (action, body = {}) => ({
  action,
  request_id: randomUUID(),
  note: 'Synthetic API policy evidence',
  ...body,
});
const request = async (method, url, scope, payload, sub = maker, workspace_key = ws, language = 'en', target = app) =>
  target.inject({
    method,
    url,
    headers: {
      authorization: 'Bearer ' + (await auth.token({ scope, sub, workspace_key })),
      'accept-language': language,
    },
    ...(payload ? { payload } : {}),
  });
const write = (route, scope, body, sub = maker) =>
  request('POST', '/v1/local/risk-policies/' + route, 'policies:read ' + scope, body, sub);
before(async () => {
  temp = await mkdtemp('/tmp/lmps-policy-api-');
  state = await initializeCluster(join(temp, 'pg'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  auth = await authFixture(temp);
  reader = createDatabase(dsn(state));
  owner = createDatabase(dsn(state, 'migration'), 'migration');
  writer = createTransactionRevisions(dsn(state, 'intake'));
  risks = createTransactionRisks(dsn(state, 'intake'));
  f = transactionRiskFixture();
  policy = f.request.policy;
  candidate = structuredClone(policy);
  candidate.version = 'synthetic_v2';
  candidate.rules.forEach((r) => (r.enabled = false));
  await writer.append(f.revision);
  await risks.evaluate(f.request);
  const env = { LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path };
  ({ app } = await createApp({ ...env, LMPS_LOCAL_POLICY_DSN: dsn(state, 'policy') }));
  await app.init();
  ({ app: readOnlyApp } = await createApp(env));
  await readOnlyApp.init();
});
after(async () => {
  await app?.close();
  await readOnlyApp?.close();
  for (const r of [reader, owner, risks, writer]) await r?.close();
  if (temp && !state) {
    try {
      state = await loadState(join(temp, 'pg'));
    } catch {}
  }
  if (state) await stopCluster(state);
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('native policy APIs use JWT identity, independent scopes and versioned maker/checker transitions', async () => {
  const create = cmd('create', { policy });
  assert.equal((await request('POST', '/v1/local/risk-policies/drafts', 'policies:read', create)).statusCode, 403);
  assert.equal((await write('drafts', 'policies:write', create)).statusCode, 201);
  assert.equal((await write('drafts', 'policies:write', create)).json().status, 'duplicate');
  assert.equal(
    (await write('submissions', 'policies:write', cmd('submit', { ...ref(policy), expected_revision: 0 }))).statusCode,
    201,
  );
  const approval = cmd('approve', { ...ref(policy), expected_revision: 1 });
  const denied = await write('approvals', 'policies:approve', approval);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, 'POLICY_SELF_APPROVAL');
  const approved = await write('approvals', 'policies:approve', approval, checker);
  assert.equal(approved.statusCode, 201);
  assert.equal(approved.json().result.state, 'approved');
  const detail = await request(
    'GET',
    `/v1/local/risk-policies/${policy.policy_id}/versions/${policy.version}`,
    'policies:read',
  );
  assert.equal(detail.json().policy.approved_by, checker);
  assert.equal(detail.json().policy.revision, 2);
  assert.equal(
    (
      await request(
        'GET',
        `/v1/local/risk-policies/${policy.policy_id}/versions/${policy.version}`,
        'policies:read',
        null,
        maker,
        'synthetic_other',
      )
    ).json().policy,
    null,
  );
});
test('activation requires an approved version and isolated scope; stale generation conflicts and retry stays exact', async () => {
  assert.equal((await write('drafts', 'policies:write', cmd('create', { policy: candidate }))).statusCode, 201);
  const base = { namespace: f.request.target.namespace, currency: policy.currency, expected_generation: 0 };
  assert.equal(
    (await write('activations', 'policies:activate', cmd('activate', { ...ref(candidate), ...base }), checker)).json()
      .code,
    'POLICY_NOT_APPROVED',
  );
  const activation = cmd('activate', { ...ref(policy), ...base });
  assert.equal((await write('activations', 'policies:write', activation, checker)).statusCode, 403);
  assert.equal((await write('activations', 'policies:activate', activation, checker)).json().result.generation, 1);
  assert.equal((await write('activations', 'policies:activate', activation, checker)).json().status, 'duplicate');
  assert.equal(
    (await write('activations', 'policies:activate', cmd('activate', { ...ref(policy), ...base }), checker)).statusCode,
    409,
  );
  const binding = await request(
    'GET',
    `/v1/local/risk-policies/binding/${base.namespace}/${base.currency}`,
    'policies:read',
  );
  assert.equal(binding.json().binding.policy_version, policy.version);
});
test('comparison uses scoped stored evidence, deterministic language-independent hashes, and no operational writes', async () => {
  const payload = { baseline: ref(policy), candidate: ref(candidate), run_ids: [f.request.run_id] };
  assert.equal(
    (await request('POST', '/v1/local/risk-policies/comparisons', 'policies:read', payload)).statusCode,
    403,
  );
  const en = await request('POST', '/v1/local/risk-policies/comparisons', 'policies:read risk:read', payload),
    lo = await request(
      'POST',
      '/v1/local/risk-policies/comparisons',
      'policies:read risk:read',
      payload,
      maker,
      ws,
      'lo',
    );
  assert.equal(en.statusCode, 201);
  assert.equal(en.json().summary.changed_runs, 1);
  assert.equal(en.json().rows[0].after.fraud_score.value, null);
  assert.equal(en.json().report_sha256, lo.json().report_sha256);
  assert.equal(lo.headers['content-language'], 'lo');
  assert.equal(en.headers['cache-control'], 'no-store');
  const foreign = await request(
    'POST',
    '/v1/local/risk-policies/comparisons',
    'policies:read risk:read',
    payload,
    maker,
    'synthetic_other',
  );
  assert.equal(foreign.statusCode, 404);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_alerts')).rows[0].n, 0);
  assert.equal(
    (await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_risks')).rows[0].n,
    1,
  );
});
test('bounded reads and protected event history enforce scopes, pagination and query validation', async () => {
  const list = await request('GET', '/v1/local/risk-policies?limit=1', 'policies:read');
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items.length, 1);
  assert.ok(list.json().next_cursor);
  const next = await request(
    'GET',
    '/v1/local/risk-policies?limit=1&after=' + list.json().next_cursor,
    'policies:read',
  );
  assert.equal(next.json().items.length, 1);
  assert.notEqual(next.json().items[0].policy_version, list.json().items[0].policy_version);
  assert.equal((await request('GET', '/v1/local/risk-policies/events', 'policies:read')).statusCode, 403);
  const events = await request('GET', '/v1/local/risk-policies/events', 'policies:read audit:read');
  assert.equal(events.statusCode, 200);
  assert.ok(events.json().items.some((e) => e.actor_subject === checker));
  for (const query of ['?workspace_key=synthetic_other', '?limit=11', '?limit=1&limit=2', '?after=bad', '?unknown=1'])
    assert.equal((await request('GET', '/v1/local/risk-policies' + query, 'policies:read')).statusCode, 400);
});
test('malformed commands, forged actor, oversized/invalid JSON and foreign writes fail with redacted bilingual errors', async () => {
  const bad = cmd('create', { policy: { ...policy, version: 'synthetic_bad' }, actor_subject: checker });
  assert.equal((await write('drafts', 'policies:write', bad)).statusCode, 400);
  const foreign = await request(
    'POST',
    '/v1/local/risk-policies/drafts',
    'policies:read policies:write',
    cmd('create', { policy }),
    maker,
    'synthetic_other',
  );
  assert.equal(foreign.statusCode, 400);
  for (const payload of ['{"SECRET_SYNTHETIC_CANARY":', JSON.stringify({ note: 'SYNTHETIC_CANARY'.repeat(10000) })]) {
    const result = await app.inject({
      method: 'POST',
      url: '/v1/local/risk-policies/drafts',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'lo',
        authorization: 'Bearer ' + (await auth.token({ scope: 'policies:read policies:write' })),
      },
      payload,
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.json().code, 'POLICY_INVALID_INPUT');
    assert.doesNotMatch(result.body, /CANARY|syntax|position|SELECT/);
    assert.equal(result.headers['content-language'], 'lo');
  }
  const unauth = await app.inject({ method: 'GET', url: '/v1/local/risk-policies' });
  assert.equal(unauth.statusCode, 401);
});
test('write credential is optional and isolated; SQL outage is503 rather than an empty policy page', async () => {
  const result = await request(
    'POST',
    '/v1/local/risk-policies/drafts',
    'policies:read policies:write',
    cmd('create', { policy: { ...policy, version: 'synthetic_readonly' } }),
    maker,
    ws,
    'en',
    readOnlyApp,
  );
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().code, 'POLICY_WRITES_NOT_CONFIGURED');
  assert.throws(() => readConfig({ LMPS_LOCAL_POLICY_DSN: dsn(state, 'policy') }));
  assert.throws(() =>
    readConfig({
      LMPS_LOCAL_AUTH_CONFIG: auth.path,
      LMPS_POSTGRES_DSN: dsn(state),
      LMPS_LOCAL_POLICY_DSN: dsn(state, 'intake'),
    }),
  );
  await stopCluster(state);
  try {
    const outage = await request('GET', '/v1/local/risk-policies', 'policies:read');
    assert.equal(outage.statusCode, 503);
    assert.equal(outage.json().code, 'POLICY_STORAGE_UNAVAILABLE');
  } finally {
    await startCluster(state);
  }
});
