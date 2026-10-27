import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createPortalClient, PortalError, tokenIdentity } from '../src/client.ts';
import { copy, errorText } from '../src/copy.ts';
import { portalFixture } from './support/fixture.mjs';
let fixture, token;
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const reject = (promise, code, status) => assert.rejects(promise, e => e instanceof PortalError && e.code === code && (status === undefined || e.status === status));
before(async () => { fixture = await portalFixture(); token = await fixture.token(); });
after(async () => { await fixture?.close(); });
function transport(calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const response = await fixture.app.inject({ method: options.method, url, headers: options.headers, ...(options.body ? { payload: options.body } : {}) });
    return new Response(response.rawPayload, { status: response.statusCode, headers: response.headers });
  };
}
test('API client uses fixed same-origin paths, bearer only in headers, no cookie/cache/referrer and bounded UUID pages', async () => {
  const calls = [], client = createPortalClient(token, transport(calls));
  const catalog = await client.catalog('lo'), page = await client.inbox({ state: 'open', severity: 'high', risk_code: 'FRAUD_HIGH_AMOUNT' }, 'lo');
  assert.equal(catalog.risk_types.length, 15); assert.equal(page.items.length, 5); assert.ok(page.next_cursor);
  const second = await client.inbox({ after: page.next_cursor }, 'en'); assert.equal(second.items.length, 1); assert.equal(second.next_cursor, null);
  for (const { url, options } of calls) {
    assert.ok(url.startsWith('/v1/local/alerts')); assert.ok(!url.includes(token)); assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
  }
  assert.match(calls[1].url, /limit=5/); assert.match(calls[1].url, /state=open/);
  client.close(); await reject(client.catalog('en'), 'UNAUTHORIZED', 401); assert.equal(calls.length, 3);
});
test('partial/null scores, original precision, all findings and evidence survive Lao/English responses', async () => {
  const client = createPortalClient(token, transport()), id = fixture.state.rows[0].alert_id;
  const lo = await client.detail(id, 'lo'), en = await client.detail(id, 'en');
  assert.equal(lo.assessment_status, 'partial'); assert.equal(lo.mule_network_score.value, null); assert.equal(lo.assessment.findings.length, 15);
  assert.equal(lo.core_sha256, en.core_sha256); assert.deepEqual(lo.fraud_score, en.fraud_score);
  assert.deepEqual(lo.assessment.findings.map(f => f.evidence_refs), en.assessment.findings.map(f => f.evidence_refs)); assert.notEqual(lo.response_message, en.response_message);
  assert.equal(await client.detail('ffffffff-ffff-4fff-8fff-ffffffffffff', 'en'), null); client.close();
});
test('malformed, duplicate, inconsistent and oversized responses fail closed', async () => {
  const page = (await fixture.request('/v1/local/alerts?limit=5')).json();
  for (const mutate of [b => b.locale = 'lo', b => b.items[0].fraud_score.value = 2, b => b.items[0].mule_network_score.value = 0,
    b => b.items[0].state = ['open'], b => b.items[0].version = '0', b => b.items.push(b.items[0]), b => b.next_cursor = 'bad', b => b.pagination = 'snapshot']) {
    const body = structuredClone(page); mutate(body); await reject(createPortalClient(token, async () => json(body)).inbox({}, 'en'), 'PORTAL_BAD_RESPONSE');
  }
  await reject(createPortalClient(token, async () => new Response('{bad')).catalog('en'), 'PORTAL_BAD_RESPONSE');
  await reject(createPortalClient(token, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))).catalog('en'), 'PORTAL_BAD_RESPONSE');
  const detail = (await fixture.request('/v1/local/alerts/' + fixture.state.rows[0].alert_id)).json(); detail.alert.assessment.findings[1].code = detail.alert.assessment.findings[0].code;
  await reject(createPortalClient(token, async () => json(detail)).detail(detail.alert.alert_id, 'en'), 'PORTAL_BAD_RESPONSE');
});
test('arbitrary server diagnostics and fetch errors never become visible error messages', async () => {
  for (const status of [401, 403, 503]) {
    const client = createPortalClient(token, async () => new Response(JSON.stringify({ code: 'SYNTHETIC_PRIVATE_VALUE', message: 'SYNTHETIC_PRIVATE_VALUE' }), { status }));
    await assert.rejects(client.catalog('en'), e => e instanceof PortalError && !e.message.includes('PRIVATE'));
  }
  await reject(createPortalClient(token, async () => { throw new Error('SYNTHETIC_PRIVATE_VALUE'); }).catalog('en'), 'PORTAL_NETWORK');
  assert.ok(!errorText('SYNTHETIC_PRIVATE_VALUE', 'en').includes('PRIVATE'));
  let fetched = false; await reject(createPortalClient(token, async () => { fetched = true; }).detail('../private', 'en'), 'INVALID_ALERT_INPUT', 400); assert.equal(fetched, false);
});
test('uncertain writes can retry exact command identity and content across locale changes', async () => {
  const id = fixture.state.rows[1].alert_id, calls = [], fetcher = transport(calls); let dropped = false;
  const client = createPortalClient(token, async (url, options) => {
    const response = await fetcher(url, options);
    if (options.method === 'POST' && !dropped) { dropped = true; throw new Error('connection lost after commit'); }
    return response;
  });
  const command = { request_id: crypto.randomUUID(), expected_version: 0, action: 'acknowledge', outcome: null, note: null };
  await reject(client.review(id, command, 'en'), 'PORTAL_NETWORK');
  const retry = await client.review(id, command, 'lo'); assert.equal(retry.status, 'duplicate'); assert.equal(retry.alert.version, 1);
  assert.equal(calls[0].options.body, calls[1].options.body); assert.equal(fixture.state.rows[1].history.length, 1);
  const readOnly = createPortalClient(await fixture.token({ scope: 'alerts:read' }), transport());
  await reject(readOnly.review(id, { ...command, request_id: crypto.randomUUID() }, 'en'), 'FORBIDDEN', 403);
});
test('display claims reject invalid or expired tokens; server must authenticate signatures before login', async () => {
  const claims = tokenIdentity('Bearer ' + token); assert.equal(claims.identity.canReview, true); assert.equal(claims.identity.workspace, 'synthetic_local');
  for (const value of ['', 'bad', token + '!', await fixture.token({ exp: 1 }), await fixture.token({ sub: 'real_identity' })]) assert.throws(() => tokenIdentity(value), PortalError);
  const parts = token.split('.'); parts[2] = 'x'.repeat(parts[2].length); const forged = parts.join('.');
  assert.ok(tokenIdentity(forged)); await reject(createPortalClient(forged, transport()).catalog('en'), 'UNAUTHORIZED', 401);
});
test('every portal copy key is present in Lao and English, including sanitized failures', () => {
  assert.deepEqual(Object.keys(copy('lo')).sort(), Object.keys(copy('en')).sort());
  for (const [key, value] of Object.entries(copy('lo'))) { assert.match(value, /[\u0e80-\u0eff]/, key); assert.ok(copy('en')[key].trim()); }
  for (const code of ['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_ALERT_INPUT', 'ALERT_REVIEW_CONFLICT', 'PORTAL_BAD_RESPONSE', 'PORTAL_TIMEOUT']) assert.match(errorText(code, 'lo'), /[\u0e80-\u0eff]/);
});
