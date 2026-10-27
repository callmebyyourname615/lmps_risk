import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { portalFixture } from './support/fixture.mjs';

export async function runOverview(page) {
  const fixture = await portalFixture(), origin = 'http://127.0.0.1:18505';
  const screenshots = fileURLToPath(new URL('../../../.local/portal-checks/', import.meta.url));
  const errors = [], captureError = error => errors.push(error.message);
  page.on('pageerror', captureError);
  const handle = async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await fixture.app.inject({ method: request.method(), url: url.pathname + url.search, headers: request.headers(), ...(request.postData() ? { payload: request.postData() } : {}) });
    const headers = { ...response.headers }; delete headers['content-length']; delete headers['transfer-encoding']; delete headers.connection;
    await route.fulfill({ status: response.statusCode, headers, body: response.rawPayload });
  };
  const checks = [];
  await page.route(origin + '/**', handle);
  await mkdir(screenshots, { recursive: true, mode: 0o700 });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(origin + '/portal/');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.locator('#access-token').fill(await fixture.token({ scope: 'alerts:read' }));
    await page.locator('.login-form button[type=submit]').click(); await page.locator('.monitor-grid').waitFor();
    assert.equal(await page.locator('.app').count(), 1); assert.equal(await page.locator('.portal-header').count(), 1);
    assert.equal(await page.locator('nav a[href="#/overview"]').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.snapshot-total > strong').textContent(), '5');
    assert.equal(await page.locator('[data-dimension="mule_network"] small').last().textContent(), 'Unavailable indices 1');
    checks.push('Default overview after authenticated connection; five returned alerts, one unavailable mule index');
    const dimensions = [];
    for (const width of [320, 375, 414, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(geometry.scrollWidth <= width); dimensions.push(geometry);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: screenshots + 'overview-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({ path: screenshots + 'overview-mobile.png', fullPage: true });
    checks.push('No horizontal overflow at six viewport widths');
    await page.getByRole('button', { name: 'ລາວ', exact: true }).click();
    await page.getByRole('heading', { name: 'ຕິດຕາມຄວາມສ່ຽງ', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.loading'));
    assert.equal(await page.locator('.snapshot-total > strong').textContent(), '5');
    await page.screenshot({ path: screenshots + 'overview-lo-mobile.png', fullPage: true });
    checks.push('Lao overview keeps the same returned-data counts');
    await page.getByRole('button', { name: 'EN', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.loading'));
    fixture.state.failed = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.monitor-grid').count(), 0);
    fixture.state.failed = false; await page.getByRole('alert').getByRole('button', { name: 'Refresh', exact: true }).click(); await page.locator('.monitor-grid').waitFor();
    checks.push('Storage failure hides previous snapshot; explicit retry recovers');
    fixture.state.rows.length = 0; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('No alerts returned for this snapshot.', { exact: true }).waitFor();
    assert.equal(await page.locator('.snapshot-total > strong').textContent(), '0');
    assert.deepEqual(await page.locator('.dimension-value').allTextContents(), ['—', '—', '—']);
    checks.push('Empty returned page shows no-data indices rather than safe zero scores');
    assert.deepEqual(errors, []);
    return { checks, dimensions, screenshots, transport: 'real scoped API via Fastify inject, synthetic storage only' };
  } finally { await page.unroute(origin + '/**', handle); page.off('pageerror', captureError); await fixture.close(); }
}
