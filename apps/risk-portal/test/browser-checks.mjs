import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { portalFixture } from './support/fixture.mjs';

// No listener: the real browser loads built assets through actual Fastify/Nest inject responses.
// This checks UI/API behavior; it does not claim PostgreSQL or TCP acceptance.
export async function runInProcess(page) {
  const fixture = await portalFixture(), origin = 'http://127.0.0.1:18505', screenshots = fileURLToPath(new URL('../../../.local/portal-checks/', import.meta.url));
  const failures = [], errors = []; let dropNextWrite = false, lastCommand;
  const handle = async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await fixture.app.inject({ method: request.method(), url: url.pathname + url.search, headers: request.headers(), ...(request.postData() ? { payload: request.postData() } : {}) });
    if (request.method() === 'POST') { lastCommand = JSON.parse(request.postData()); if (dropNextWrite) { dropNextWrite = false; await route.abort('connectionfailed'); return; } }
    const headers = { ...response.headers }; delete headers['content-length']; delete headers['transfer-encoding']; delete headers.connection;
    await route.fulfill({ status: response.statusCode, headers, body: response.rawPayload });
  };
  const errorListener = error => errors.push(error.message);
  page.on('pageerror', errorListener);
  await page.route(origin + '/**', handle);
  await mkdir(screenshots, { recursive: true, mode: 0o700 });
  const checks = [];
  const check = async (label, fn) => { try { await fn(); checks.push(label); } catch (error) { failures.push(label); throw new Error('Portal browser check failed: ' + label + '\n' + error.message.slice(0, 1600)); } };
  const connect = async changes => { await page.evaluate(() => location.hash = '#/'); await page.locator('#access-token').fill(await fixture.token(changes)); await page.locator('.login-form button[type=submit]').click(); await page.locator('.table-wrap tbody tr').first().waitFor(); };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(origin + '/portal/#/');
    await check('Lao default, keyboard entry and no persistent credentials', async () => {
      assert.equal(await page.locator('html').getAttribute('lang'), 'lo');
      await page.keyboard.press('Tab'); assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
      await page.getByRole('button', { name: 'EN', exact: true }).click(); await page.waitForFunction(() => document.documentElement.lang === 'en');
      await connect({ scope: 'alerts:read' });
      assert.equal(await page.locator('tbody tr').count(), 5);
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, '']);
      assert.ok(!page.url().includes('eyJ')); await page.screenshot({ path: screenshots + 'inbox-en.png', fullPage: true });
    });
    await check('Midnight overview uses only the returned page and routes to evidence and definitions', async () => {
      await page.locator('nav a[href="#/overview"]').click(); await page.locator('.snapshot-total > strong').waitFor();
      assert.equal(await page.locator('.snapshot-total > strong').textContent(), '5');
      assert.equal(await page.locator('.dimension-card').count(), 3);
      assert.match(await page.locator('.scope-note').textContent(), /not a network-wide total/);
      assert.equal(await page.locator('.overview-alert-link').count(), 5);
      assert.match(await page.locator('.library-count').textContent(), /15/);
      await page.locator('.overview-alert-link').first().click(); await page.locator('.finding').first().waitFor();
      await page.locator('nav a[href="#/definitions"]').click(); await page.locator('.definition').first().waitFor();
      assert.equal(await page.locator('.definition').count(), 15);
      await page.locator('nav a[href="#/overview"]').click(); await page.locator('.dimension-card').first().waitFor();
      for (const width of [320, 375, 414, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'overview width ' + width);
      }
      await page.screenshot({ path: screenshots + 'overview-en.png', fullPage: true });
      await page.locator('nav a[href="#/"]').click(); await page.locator('.table-wrap tbody tr').first().waitFor();
    });
    await check('UUID next/previous, server filters and honest empty state', async () => {
      await page.getByRole('button', { name: 'Next →', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
      await page.getByRole('button', { name: '← Previous', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);
      await page.getByLabel('Severity', { exact: true }).selectOption('critical'); await page.getByRole('heading', { name: 'No alerts in this view.' }).waitFor();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await page.locator('tbody tr').first().waitFor();
    });
    await check('read-only detail preserves partial/null indices and all 15 findings', async () => {
      await page.locator('.alert-link').first().click(); await page.locator('.finding').first().waitFor();
      assert.equal(await page.locator('.finding').count(), 15); assert.equal(await page.locator('.index-number').nth(1).textContent(), '—');
      assert.ok(await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).isDisabled());
      await page.locator('.finding summary').first().click(); assert.ok((await page.locator('.finding[open] .finding-body').textContent()).length > 100);
      const before = await page.locator('.provenance code').allTextContents();
      await page.getByRole('button', { name: 'ລາວ', exact: true }).click(); await page.waitForFunction(() => document.documentElement.lang === 'lo' && /[\u0e80-\u0eff]/.test(document.querySelector('.finding strong')?.textContent ?? ''));
      await page.waitForFunction(() => !document.querySelector('.loading'));
      assert.deepEqual(await page.locator('.provenance code').allTextContents(), before); await page.screenshot({ path: screenshots + 'detail-lo.png', fullPage: true });
      await page.getByRole('button', { name: 'EN', exact: true }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    });
    await check('uncertain write retry uses exact identity once and renders immutable history', async () => {
      await connect(); await page.locator('.alert-link').first().click(); await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).waitFor();
      dropNextWrite = true; await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).click();
      await page.getByRole('button', { name: 'Retry the same action', exact: true }).waitFor(); const original = structuredClone(lastCommand);
      await page.getByRole('button', { name: 'Retry the same action', exact: true }).click(); await page.locator('#review-outcome').waitFor();
      assert.deepEqual(lastCommand, original); assert.equal(fixture.state.rows[0].history.length, 1); assert.equal(await page.locator('.history-panel li').count(), 1);
    });
    await check('stale evidence blocks writes and a concurrent review preserves the draft', async () => {
      await page.locator('#review-outcome').selectOption('unknown'); await page.locator('#review-note').fill('  ຫຼັກຖານ <img src=x onerror=alert(1)>\nDraft as entered.  ');
      fixture.state.failed = true; await page.getByRole('button', { name: 'Reload current evidence', exact: true }).first().click();
      await page.getByText('Earlier evidence is still visible.', { exact: false }).waitFor(); assert.ok(await page.getByRole('button', { name: 'Save review', exact: true }).isDisabled());
      fixture.state.failed = false; await page.getByRole('button', { name: 'Reload current evidence', exact: true }).first().click();
      await page.waitForFunction(() => !document.querySelector('.loading'));
      const row = fixture.state.rows[0]; await fixture.review('synthetic_local', row.alert_id, 'synthetic_other', { request_id: crypto.randomUUID(), expected_version: 1, action: 'review', outcome: 'suspicious', note: 'Synthetic concurrent review.' });
      const draft = await page.locator('#review-note').inputValue(); await page.getByRole('button', { name: 'Save review', exact: true }).click();
      await page.getByText('This alert changed.', { exact: true }).waitFor(); assert.equal(await page.locator('#review-note').inputValue(), draft);
      assert.ok(await page.getByRole('button', { name: 'Save review', exact: true }).isDisabled());
      await page.getByRole('button', { name: 'Reload current evidence', exact: true }).first().click(); await page.getByRole('heading', { name: 'Review recorded', exact: true }).waitFor();
      assert.equal(await page.locator('.unsaved-draft .history-note').textContent(), draft); assert.equal(await page.locator('.unsaved-draft img').count(), 0);
    });
    await check('review note is saved as entered, escaped, and unknown is terminal', async () => {
      await page.locator('.back-link').click(); await page.locator('tbody tr').nth(1).waitFor(); await page.locator('.alert-link').nth(1).click();
      await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).click(); await page.locator('#review-outcome').waitFor();
      const note = '  ຂໍ້ມູນບໍ່ພໍ <script>throw 1</script>\nSynthetic review.  ';
      await page.locator('#review-outcome').selectOption('unknown'); await page.locator('#review-note').fill(note); await page.getByRole('button', { name: 'Save review', exact: true }).click();
      await page.getByRole('heading', { name: 'Review recorded', exact: true }).waitFor(); assert.equal(await page.locator('.history-note').textContent(), note);
      assert.equal(fixture.state.rows[1].history[1].note, note); assert.equal(fixture.state.rows[1].history[1].outcome, 'unknown'); assert.equal(await page.locator('.history-note script').count(), 0);
      await page.screenshot({ path: screenshots + 'review-en.png', fullPage: true });
    });
    await check('mobile layout, missing alert and logout clear evidence and drafts', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: screenshots + 'mobile-en.png', fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => location.hash = '#/alerts/ffffffff-ffff-4fff-8fff-ffffffffffff'); await page.getByText('Alert unavailable in this workspace.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.locator('#access-token').waitFor();
      assert.equal(await page.locator('#review-note').count(), 0); assert.equal(await page.locator('.history-note').count(), 0); assert.equal(await page.locator('#access-token').inputValue(), '');
    });
    await check('forged signature rejected and expiry clears the active session', async () => {
      const parts = (await fixture.token()).split('.'); parts[2] = 'x'.repeat(parts[2].length);
      await page.locator('#access-token').fill(parts.join('.')); await page.locator('.login-form button[type=submit]').click(); await page.getByRole('alert').waitFor(); assert.equal(await page.locator('tbody tr').count(), 0);
      await connect({ exp: Math.floor(Date.now() / 1000) + 4 }); await page.locator('#access-token').waitFor({ timeout: 7000 }); assert.equal(await page.locator('tbody tr').count(), 0);
    });
    assert.deepEqual(errors, []); return { passed: checks.length, checks, screenshots, transport: 'Fastify inject; synthetic storage driver; no listener or native PostgreSQL' };
  } finally { await page.unroute(origin + '/**', handle); page.off('pageerror', errorListener); await fixture.close(); }
}
