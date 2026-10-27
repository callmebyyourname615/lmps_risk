// Run on a host permitting loopback listeners and the pinned native PostgreSQL runtime.
// Only a disposable synthetic cluster is initialized; project .local/postgres is never used.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTransactionRevisions, createTransactionRisks, createLocalAlerts, createAlertReviews, createDatabase, readLocalAlert } from '../../../packages/database/dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { alertFixture } from '../../../packages/database/test/fixtures/alert.mjs';
import { authFixture } from '../../risk-api/scripts/auth-fixture.mjs';
import { createApp } from '../../risk-api/dist/app.js';

let temporary, state, app, browser, revisions, risks, alerts, reviews, reader;
try {
  temporary = await mkdtemp('/tmp/lmps-portal-native-');
  state = await initializeCluster(join(temporary, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  revisions = createTransactionRevisions(dsn(state, 'intake')); risks = createTransactionRisks(dsn(state, 'intake'));
  alerts = createLocalAlerts(dsn(state, 'intake')); reviews = createAlertReviews(dsn(state, 'reviewer')); reader = createDatabase(dsn(state));
  const f = alertFixture(); await revisions.append(f.f.revision); await risks.evaluate(f.f.request);
  const generated = await alerts.generate(f.generation), auth = await authFixture(temporary);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_REVIEW_DSN: dsn(state, 'reviewer'), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
  await app.listen(0, '127.0.0.1');
  const modulePath = process.env.LMPS_PLAYWRIGHT_MODULE;
  if (!modulePath || !isAbsolute(modulePath)) throw new Error('PLAYWRIGHT_MODULE_REQUIRED');
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const baseURL = await app.getUrl(); await page.goto(baseURL + '/portal/#/'); await page.getByRole('button', { name: 'EN', exact: true }).click();
  const connect = async scope => { await page.evaluate(() => location.hash = '#/'); await page.locator('#access-token').fill(await auth.token({ scope, sub: 'synthetic_reviewer' })); await page.locator('.login-form button[type=submit]').click(); await page.locator('.alert-link').first().waitFor(); await page.locator('.alert-link').first().click(); await page.locator('.finding').first().waitFor(); };
  await connect('alerts:read'); assert.ok(await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await connect('alerts:read alerts:review');
  assert.equal(await page.locator('.finding').count(), 15); const hashes = await page.locator('.provenance code').allTextContents();
  await page.getByRole('button', { name: 'ລາວ', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.loading')); assert.deepEqual(await page.locator('.provenance code').allTextContents(), hashes);
  await page.getByRole('button', { name: 'EN', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.loading'));
  await page.getByRole('button', { name: 'Acknowledge alert', exact: true }).click(); await page.locator('#review-outcome').waitFor();
  await page.locator('#review-outcome').selectOption('unknown'); const note = '  ຫຼັກຖານ <script>throw 1</script>\nNative synthetic review.  '; await page.locator('#review-note').fill(note);
  await page.getByRole('button', { name: 'Save review', exact: true }).click(); await page.getByRole('heading', { name: 'Review recorded', exact: true }).waitFor();
  const stored = await readLocalAlert(reader.pool, 'synthetic_local', generated.alert_id);
  assert.equal(stored.version, 2); assert.equal(stored.outcome, 'unknown'); assert.equal(stored.history[1].note, note); assert.equal(await page.locator('.history-note').textContent(), note);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, '']);
  console.log('PASS native PostgreSQL + TCP API + Chrome portal: authorization, bilingual evidence, acknowledge/review and stored history.');
} catch (error) {
  console.error(error?.code === 'EPERM' ? 'BLOCKED native portal acceptance: loopback listener EPERM; no acceptance claimed.' : error?.message === 'PLAYWRIGHT_MODULE_REQUIRED' ? 'BLOCKED native portal acceptance: set LMPS_PLAYWRIGHT_MODULE to the absolute installed playwright-core entry module.' : 'FAIL native portal acceptance; private diagnostics withheld.');
  process.exitCode = 1;
} finally {
  await browser?.close(); await app?.close();
  for (const repository of [reader, reviews, alerts, risks, revisions]) await repository?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch {} }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
