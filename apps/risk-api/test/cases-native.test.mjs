import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions, createTransactionRisks, createLocalAlerts } from '@lmps/database';
import {
  availablePort,
  dsn,
  initializeCluster,
  startCluster,
  stopCluster,
  loadState,
} from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { alertFixture } from '../../../packages/database/test/fixtures/alert.mjs';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
let temp, state, app, readonly, auth, reader, writer, risks, alerts, f, id, alertId, createCommand;
const ws = 'synthetic_local',
  analyst = 'synthetic_analyst',
  coordinator = 'synthetic_coordinator';
const readScope = 'cases:read',
  writeScope = 'cases:read cases:write alerts:read risk:read',
  workScope = 'cases:read cases:work';
const command = (action, version, extra = {}) => ({
  action,
  request_id: randomUUID(),
  expected_version: version,
  note: 'Synthetic API case evidence',
  ...extra,
});
const dimensions = () =>
  Object.fromEntries(
    ['fraud', 'mule_network', 'aml'].map((k) => [
      k,
      { outcome: 'unknown', rationale: 'Synthetic evidence is inconclusive' },
    ]),
  );
const req = async (method, url, scope, payload, subject = analyst, workspace_key = ws, language = 'en', target = app) =>
  target.inject({
    method,
    url,
    headers: {
      ...(scope ? { authorization: 'Bearer ' + (await auth.token({ scope, sub: subject, workspace_key })) } : {}),
      'accept-language': language,
    },
    ...(payload ? { payload } : {}),
  });
const post = (route, scope, body, subject = analyst, caseId = id) =>
  req('POST', `/v1/local/cases/${caseId}/${route}`, scope, body, subject);
before(async () => {
  temp = await mkdtemp('/tmp/lmps-case-api-');
  state = await initializeCluster(join(temp, 'pg'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  auth = await authFixture(temp);
  reader = createDatabase(dsn(state));
  writer = createTransactionRevisions(dsn(state, 'intake'));
  risks = createTransactionRisks(dsn(state, 'intake'));
  alerts = createLocalAlerts(dsn(state, 'intake'));
  f = alertFixture();
  await writer.append(f.f.revision);
  await risks.evaluate(f.f.request);
  alertId = (await alerts.generate(f.generation)).alert_id;
  id = randomUUID();
  createCommand = command('create', 0, { title: 'Synthetic investigation', alert_id: alertId });
  const env = { LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path };
  ({ app } = await createApp({ ...env, LMPS_LOCAL_CASE_DSN: dsn(state, 'case') }));
  await app.init();
  ({ app: readonly } = await createApp(env));
  await readonly.init();
});
after(async () => {
  await app?.close();
  await readonly?.close();
  for (const r of [reader, alerts, risks, writer]) await r?.close();
  if (temp && !state) {
    try {
      state = await loadState(join(temp, 'pg'));
    } catch {}
  }
  if (state) await stopCluster(state);
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('create/link requires independent case/Alert/risk scopes, uses JWT actor and does not acknowledge the Alert', async () => {
  assert.equal((await post('create', readScope, createCommand, coordinator)).statusCode, 403);
  assert.equal(
    (await post('create', 'cases:read cases:write alerts:read', createCommand, coordinator)).statusCode,
    403,
  );
  const created = await post('create', writeScope, createCommand, coordinator);
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().result.state, 'open');
  assert.equal(created.json().result.version, 1);
  const view = await req('GET', `/v1/local/cases/${id}`, readScope);
  assert.equal(view.json().case.created_by, coordinator);
  assert.equal(view.json().case.current_outcome, null);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_alert_reviews')).rows[0].n, 0);
  const other = await post(
    'create',
    writeScope,
    command('create', 0, { title: 'Duplicate', alert_id: alertId }),
    coordinator,
    randomUUID(),
  );
  assert.equal(other.statusCode, 409);
  assert.equal(other.json().code, 'CASE_ALERT_ALREADY_LINKED');
});
test('assignment scope and server-side assignee restriction protect review actions independently', async () => {
  const assign = command('assign', 1, { assignee_subject: analyst });
  assert.equal((await post('assignment', workScope, assign, coordinator)).statusCode, 403);
  assert.equal((await post('assignment', 'cases:read cases:assign', assign, coordinator)).statusCode, 201);
  const forbidden = await post('start', workScope, command('start', 2), 'synthetic_other');
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().code, 'CASE_NOT_ASSIGNEE');
  assert.equal((await post('start', workScope, command('start', 2))).statusCode, 201);
  assert.equal((await post('close', workScope, command('close', 3))).json().code, 'CASE_OUTCOME_REQUIRED');
});
test('notes, separate unknown outcomes and closure create an audit trail without training labels or payment effects', async () => {
  assert.equal(
    (await post('notes', workScope, command('add_note', 3, { note: '<script>original analyst note</script>' })))
      .statusCode,
    201,
  );
  assert.equal(
    (await post('outcomes', workScope, command('record_outcome', 4, { dimensions: dimensions() }))).statusCode,
    201,
  );
  assert.equal((await post('close', workScope, command('close', 5))).statusCode, 201);
  const view = await req('GET', `/v1/local/cases/${id}`, readScope);
  assert.equal(view.json().case.state, 'closed');
  const opinion = view.json().case.current_outcome;
  assert.equal(opinion.dimensions.aml.outcome, 'unknown');
  assert.equal(opinion.training_eligible, false);
  assert.equal(opinion.maturity, 'unverified');
  assert.equal((await req('GET', `/v1/local/cases/${id}/events`, readScope)).statusCode, 403);
  const events = await req('GET', `/v1/local/cases/${id}/events?limit=10`, readScope + ' audit:read');
  assert.equal(events.statusCode, 200);
  assert.equal(events.json().items.length, 6);
  assert.equal(events.json().items[3].note, '<script>original analyst note</script>');
  assert.equal(events.json().items[3].actor_subject, analyst);
  assert.equal((await reader.pool.query('SELECT count(*)::int AS n FROM platform.local_outbox_intents')).rows[0].n, 0);
});
test('reopen requires explicit scope, invalidates the old outcome and preserves immutable history and exact retries', async () => {
  const reopen = command('reopen', 6);
  assert.equal((await post('reopen', workScope, reopen, coordinator)).statusCode, 403);
  assert.equal((await post('reopen', 'cases:read cases:reopen', reopen, coordinator)).statusCode, 201);
  const view = await req('GET', `/v1/local/cases/${id}`, readScope);
  assert.equal(view.json().case.state, 'open');
  assert.equal(view.json().case.review_cycle, 2);
  assert.equal(view.json().case.current_outcome, null);
  const history = await req('GET', `/v1/local/cases/${id}/outcomes`, readScope);
  assert.equal(history.json().items[0].effective_current, false);
  assert.equal(history.json().items[0].dimensions.fraud.outcome, 'unknown');
  const retry = await post('create', writeScope, createCommand, coordinator);
  assert.equal(retry.json().status, 'duplicate');
  assert.equal(retry.json().result.version, 1);
  assert.equal(
    (await post('create', writeScope, { ...createCommand, note: 'Changed command' }, coordinator)).statusCode,
    409,
  );
});
test('evidence is independently scoped and retains original frozen transaction/policy coordinates in both languages', async () => {
  assert.equal((await req('GET', `/v1/local/cases/${id}/evidence`, readScope)).statusCode, 403);
  const scope = 'cases:read alerts:read risk:read';
  const en = await req('GET', `/v1/local/cases/${id}/evidence`, scope),
    lo = await req('GET', `/v1/local/cases/${id}/evidence`, scope, null, analyst, ws, 'lo');
  assert.equal(en.statusCode, 200);
  assert.deepEqual(en.json().items, lo.json().items);
  assert.equal(en.json().items[0].target.revision_number, 1);
  assert.equal(en.json().items[0].risk_policy.version, f.f.request.policy.version);
  assert.equal(lo.headers['content-language'], 'lo');
  assert.equal(lo.headers['cache-control'], 'no-store');
  assert.ok(lo.headers['x-request-id']);
});
test('bounded metadata/history queries isolate workspaces and reject overrides, duplicate parameters and malformed filters', async () => {
  const page = await req('GET', `/v1/local/cases?state=open&assignee=${analyst}&limit=1`, readScope);
  assert.equal(page.json().items.length, 1);
  assert.equal(page.json().items[0].case_id, id);
  const foreign = await req('GET', `/v1/local/cases/${id}`, readScope, null, analyst, 'synthetic_other');
  assert.equal(foreign.json().case, null);
  const history = await req(
    'GET',
    `/v1/local/cases/${id}/events`,
    readScope + ' audit:read',
    null,
    analyst,
    'synthetic_other',
  );
  assert.equal(history.json().case, null);
  for (const query of [
    '?limit=11',
    '?limit=1&limit=2',
    '?workspace_key=synthetic_other',
    '?state=bad',
    '?after=bad',
    '?assignee=real_account',
  ])
    assert.equal((await req('GET', '/v1/local/cases' + query, readScope)).statusCode, 400);
  for (const query of ['?after=1001', '?after=1&after=2', '?limit=0'])
    assert.equal((await req('GET', `/v1/local/cases/${id}/events` + query, readScope + ' audit:read')).statusCode, 400);
  const events = await req('GET', `/v1/local/cases/${id}/events?limit=2`, readScope + ' audit:read');
  assert.equal(events.json().items.length, 2);
  assert.equal(events.json().next_cursor, 2);
  assert.equal(
    (await req('GET', `/v1/local/cases/${id}/events?limit=2&after=2`, readScope + ' audit:read')).json().items[0]
      .version,
    3,
  );
});
test('invalid/oversized bodies, forged actors and unauthorized requests return fixed localized errors', async () => {
  const forged = { ...command('start', 7), actor_subject: analyst };
  assert.equal((await post('start', workScope, forged)).statusCode, 400);
  for (const payload of ['{"PRIVATE_CASE_CANARY":', JSON.stringify({ note: 'PRIVATE_CASE_CANARY'.repeat(10000) })]) {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/local/cases/${id}/notes`,
      headers: {
        'content-type': 'application/json',
        'accept-language': 'lo',
        authorization: 'Bearer ' + (await auth.token({ scope: workScope })),
      },
      payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'CASE_INVALID_INPUT');
    assert.equal(response.headers['content-language'], 'lo');
    assert.doesNotMatch(response.body, /CANARY|position|syntax|SELECT/);
  }
  assert.equal((await req('GET', '/v1/local/cases', null)).statusCode, 401);
  const spec = (await req('GET', '/openapi.json', null)).json();
  assert.ok(spec.paths['/v1/local/cases/{case_id}/create'].post);
  assert.ok(spec.paths['/v1/local/cases/{case_id}/outcomes'].get);
});
test('optional case write credential fails explicitly when absent; outage never becomes an empty successful case list', async () => {
  const result = await req(
    'POST',
    `/v1/local/cases/${randomUUID()}/create`,
    writeScope,
    command('create', 0, { title: 'Unconfigured writer', alert_id: alertId }),
    coordinator,
    ws,
    'en',
    readonly,
  );
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().code, 'CASE_WRITES_NOT_CONFIGURED');
  assert.throws(() => readConfig({ LMPS_LOCAL_CASE_DSN: dsn(state, 'case') }));
  assert.throws(() =>
    readConfig({
      LMPS_POSTGRES_DSN: dsn(state),
      LMPS_LOCAL_AUTH_CONFIG: auth.path,
      LMPS_LOCAL_CASE_DSN: dsn(state, 'reviewer'),
    }),
  );
  await stopCluster(state);
  try {
    const response = await req('GET', '/v1/local/cases', readScope);
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'CASE_STORAGE_UNAVAILABLE');
  } finally {
    await startCluster(state);
  }
});
