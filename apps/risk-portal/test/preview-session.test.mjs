import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectPreview, isLocalPreview } from '../src/preview-session.ts';
import { createPortalClient, PortalError } from '../src/client.ts';
import { portalFixture } from './support/fixture.mjs';
const origin = 'http://127.0.0.1:18505';
const headers = { origin, 'x-lmps-preview': '1', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
function transport(fixture, mutateToken) {
  return async (url, options) => {
    const response = await fixture.app.inject({ method: options.method, url, headers: { ...options.headers, origin, 'sec-fetch-site': 'same-origin' }, ...(options.body ? { payload: options.body } : {}) });
    const body = url === '/__lmps_preview/session' && mutateToken ? JSON.stringify({ token: mutateToken(response.json().token) }) : response.rawPayload;
    return new Response(body, { status: response.statusCode, headers: response.headers });
  };
}
test('preview auto-connect requires both loopback hostname and the fixture HTML marker', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(isLocalPreview(host, 'signed-fixture'), true);
  for (const host of ['example.com', '127.0.0.1.example.com', '192.168.1.2']) assert.equal(isLocalPreview(host, 'signed-fixture'), false);
  assert.equal(isLocalPreview('127.0.0.1', null), false);
});
test('normal Portal has neither the auto-connect marker nor a token-issuing route', async () => {
  const fixture = await portalFixture();
  try {
    const html = await fixture.app.inject({ method: 'GET', url: '/portal/' });
    assert.ok(!html.body.includes('lmps-local-preview'));
    assert.equal((await fixture.app.inject({ method: 'POST', url: '/__lmps_preview/session', headers, payload: {} })).statusCode, 404);
  } finally { await fixture.close(); }
});
test('synthetic preview issuer accepts only an empty same-origin POST and keeps CSP/no-store', async () => {
  const fixture = await portalFixture({ preview: { origin } });
  try {
    const html = await fixture.app.inject({ method: 'GET', url: '/portal/' });
    assert.match(html.body, /name="lmps-local-preview" content="signed-fixture"/);
    assert.match(html.headers['content-security-policy'], /connect-src 'self'/);
    for (const changes of [{ origin: 'http://other.test' }, { origin: '' }, { 'x-lmps-preview': '' }, { 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await fixture.app.inject({ method: 'POST', url: '/__lmps_preview/session', headers: { ...headers, ...changes }, payload: {} })).statusCode, 403);
    }
    assert.equal((await fixture.app.inject({ method: 'POST', url: '/__lmps_preview/session', headers, payload: { scope: 'admin' } })).statusCode, 403);
    const issued = await fixture.app.inject({ method: 'POST', url: '/__lmps_preview/session', headers, payload: {} });
    assert.equal(issued.statusCode, 200); assert.equal(issued.headers['cache-control'], 'no-store');
    const catalog = await fixture.request('/v1/local/alerts/catalog', { token: issued.json().token });
    assert.equal(catalog.statusCode, 200);
    const unauthenticated = await fixture.app.inject({ method: 'GET', url: '/v1/local/alerts?limit=5' });
    assert.equal(unauthenticated.statusCode, 401);
  } finally { await fixture.close(); }
});
test('auto-connect requires a server-authenticated catalog; forged tokens cannot enter', async () => {
  const fixture = await portalFixture({ preview: { origin } });
  try {
    const connection = await connectPreview('en', new AbortController().signal, transport(fixture));
    assert.equal(connection.identity.workspace, 'synthetic_local'); assert.equal(connection.catalog.risk_types.length, 15); connection.client.close();
    await assert.rejects(connectPreview('en', new AbortController().signal, transport(fixture, token => {
      const parts = token.split('.'); parts[2] = 'x'.repeat(parts[2].length); return parts.join('.');
    })), error => error instanceof PortalError && error.code === 'UNAUTHORIZED');
  } finally { await fixture.close(); }
});
test('renewal preserves subject/workspace/permission scope and cannot reopen a closed client', async () => {
  const fixture = await portalFixture();
  try {
    const client = createPortalClient(await fixture.token(), transport(fixture));
    client.renewToken(await fixture.token()); assert.equal((await client.catalog('en')).risk_types.length, 15);
    for (const changes of [{ sub: 'synthetic_other' }, { workspace_key: 'synthetic_other' }, { scope: 'alerts:read' }]) {
      const awaitToken = await fixture.token(changes);
      assert.throws(() => client.renewToken(awaitToken), error => error instanceof PortalError && error.code === 'FORBIDDEN');
    }
    client.close(); const renewed = await fixture.token();
    assert.throws(() => client.renewToken(renewed), error => error instanceof PortalError && error.code === 'UNAUTHORIZED');
  } finally { await fixture.close(); }
});
