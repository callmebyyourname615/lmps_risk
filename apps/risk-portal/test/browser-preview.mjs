import assert from 'node:assert/strict';
import { portalFixture } from './support/fixture.mjs';

export async function runPreview(page) {
  const origin = 'http://127.0.0.1:18505', fixture = await portalFixture({ preview: { origin, lifetimeSeconds: 4 } });
  const context = page.context(), errors = []; let issued = 0, second;
  const capture = error => errors.push(error.message);
  page.on('pageerror', capture);
  const handle = async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/__lmps_preview/session' && request.method() === 'POST') issued++;
    const response = await fixture.app.inject({ method: request.method(), url: url.pathname + url.search, headers: request.headers(), ...(request.postData() ? { payload: request.postData() } : {}) });
    const headers = { ...response.headers }; delete headers['content-length']; delete headers['transfer-encoding']; delete headers.connection;
    await route.fulfill({ status: response.statusCode, headers, body: response.rawPayload });
  };
  await context.route(origin + '/**', handle);
  try {
    await page.goto(origin + '/portal/'); await page.locator('.monitor-grid').waitFor();
    assert.equal(await page.locator('#access-token').count(), 0);
    assert.equal(await page.locator('.signout').count(), 0);
    await page.reload(); await page.locator('.monitor-grid').waitFor();
    assert.equal(await page.locator('#access-token').count(), 0);
    const initialIssues = issued;
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.locator('nav a[href="#/"]').click(); await page.locator('.alert-link').first().waitFor(); await page.locator('.alert-link').first().click();
    await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).click(); await page.locator('#review-note').waitFor();
    await page.locator('#review-outcome').selectOption('unknown'); await page.locator('#review-note').fill('Draft must survive automatic session renewal.');
    await page.waitForTimeout(5200);
    assert.ok(issued > initialIssues + 1);
    assert.equal(await page.locator('#review-note').inputValue(), 'Draft must survive automatic session renewal.');
    assert.equal(await page.locator('#review-outcome').inputValue(), 'unknown');
    assert.equal(await page.locator('#access-token').count(), 0);
    await page.getByRole('button', { name: 'Save review', exact: true }).click(); await page.getByRole('heading', { name: 'Review recorded', exact: true }).waitFor();
    second = await context.newPage(); await second.goto(origin + '/portal/'); await second.locator('.monitor-grid').waitFor();
    assert.equal(await second.locator('#access-token').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, '']);
    assert.equal(await page.evaluate(async () => (await fetch('/v1/local/alerts?limit=5')).status), 401);
    fixture.state.failed = true; await second.reload(); await second.getByRole('alert').waitFor();
    assert.equal(await second.locator('#access-token').count(), 0); assert.equal(await second.locator('.monitor-grid').count(), 0);
    fixture.state.failed = false; await second.getByRole('alert').getByRole('button', { name: 'ໂຫຼດໃໝ່', exact: true }).click(); await second.locator('.monitor-grid').waitFor();
    assert.deepEqual(errors, []);
    return { autoEntry: true, reload: true, newTab: true, renewalsObserved: issued, draftPreserved: true, reviewSaved: true, noBrowserPersistence: true, unauthenticatedApi: 401, connectionFailureRetry: true };
  } finally { await second?.close(); await context.unroute(origin + '/**', handle); page.off('pageerror', capture); await fixture.close(); }
}
