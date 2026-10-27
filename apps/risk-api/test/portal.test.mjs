import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { portalFixture } from '../../risk-portal/test/support/fixture.mjs';
let fixture;
before(async () => { fixture = await portalFixture(); });
after(async () => { await fixture?.close(); });
test('portal serves only built public assets with strict CSP, no-store and no credential material', async () => {
  const redirect = await fixture.app.inject('/portal'); assert.equal(redirect.statusCode, 302); assert.equal(redirect.headers.location, '/portal/');
  const html = await fixture.app.inject('/portal/'); assert.equal(html.statusCode, 200); assert.match(html.headers['content-type'], /text\/html/);
  assert.equal(html.headers['cache-control'], 'no-store'); assert.equal(html.headers['referrer-policy'], 'no-referrer'); assert.equal(html.headers['x-content-type-options'], 'nosniff');
  assert.match(html.headers['content-security-policy'], /connect-src 'self'/); assert.match(html.headers['content-security-policy'], /frame-ancestors 'none'/); assert.ok(!html.headers['content-security-policy'].includes('unsafe-'));
  const assets = [...html.body.matchAll(/(?:src|href)="(\/portal\/assets\/[^"]+)"/g)].map(m => m[1]); assert.ok(assets.length >= 2);
  for (const path of assets) {
    const response = await fixture.app.inject(path); assert.equal(response.statusCode, 200); assert.match(response.headers['content-type'], path.endsWith('.js') ? /javascript/ : /css/);
    assert.equal(response.headers['cache-control'], 'no-store'); assert.ok(!response.body.includes('postgresql://')); assert.ok(!response.body.includes('PRIVATE KEY'));
  }
  for (const path of ['/portal/.env', '/portal/package.json', '/portal/src/client.ts', '/portal/assets/app.js.map', '/portal/auth.json', '/portal/../.env']) assert.equal((await fixture.app.inject(path)).statusCode, 404);
  assert.equal((await fixture.app.inject('/health/ready')).statusCode, 503);
});
test('alert read scope supplies all 15 bilingual detector definitions without risk scope escalation', async () => {
  for (const locale of ['lo', 'en']) {
    const response = await fixture.request('/v1/local/alerts/catalog', { locale }); assert.equal(response.statusCode, 200); const body = response.json();
    assert.equal(body.locale, locale); assert.equal(body.risk_types.length, 15); assert.equal(new Set(body.risk_types.map(r => r.code)).size, 15);
    assert.ok(body.statuses.length > 0); assert.ok(body.units.length > 0);
    for (const item of body.risk_types) for (const key of ['title', 'definition', 'condition', 'limitation']) { assert.ok(item[key]); if (locale === 'lo') assert.match(item[key], /[\u0e80-\u0eff]/); }
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal((await fixture.app.inject('/v1/local/alerts/catalog')).statusCode, 401);
  assert.equal((await fixture.request('/v1/local/alerts/catalog', { token: await fixture.token({ scope: 'alerts:review' }) })).statusCode, 403);
});
