// Local-only visual review using the existing synthetic API fixture.
// No persistent project database, real source, browser storage, or auth bypass.
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalFixture } from './support/fixture.mjs';

let fixture, browser;
try {
  const modulePath = process.env.LMPS_PLAYWRIGHT_MODULE;
  if (!modulePath || !isAbsolute(modulePath)) throw new Error('PLAYWRIGHT_MODULE_REQUIRED');
  const { chromium } = await import(pathToFileURL(modulePath).href);
  fixture = await portalFixture({ preview: { origin: 'http://127.0.0.1:18505' } });
  await fixture.app.listen(18505, '127.0.0.1');
  browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:18505/portal/');
  await page.locator('.monitor-grid').waitFor();
  console.log('Synthetic local preview ready: http://127.0.0.1:18505/portal/');
  console.log('Overview opens directly in any local tab. Signed five-minute synthetic sessions renew in memory; no manual token, persistence, or production auth change.');
  const close = () => { void browser?.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  await new Promise(resolve => browser.once('disconnected', resolve));
  process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
} catch {
  console.error('Local synthetic preview could not start; private diagnostics withheld. Check the browser module and free loopback port18505.');
  process.exitCode = 1;
} finally {
  await browser?.close(); await fixture?.close();
}
