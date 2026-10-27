import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { authFixture } from './auth-fixture.mjs';

let temporary, app;
try {
  localMode();
  const capture = process.argv[2];
  if (process.argv.length !== 3 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(capture)) throw new Error();
  temporary = await mkdtemp(join(tmpdir(), 'lmps-source-http-'));
  const fixture = await authFixture(temporary);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(await loadState()), LMPS_LOCAL_AUTH_CONFIG: fixture.path }));
  await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/v1/local/source/captures/${capture}/events`;
  const denied = await fetch(url);
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + await fixture.token() } });
  if (denied.status !== 401 || response.status !== 200) throw new Error();
  const page = await response.json();
  const operations = await fetch(url.split('/v1/local/')[0] + '/v1/local/operations', { headers: { authorization: 'Bearer ' + await fixture.token({ scope: 'operations:read' }) } });
  const health = await operations.json();
  if (operations.status !== 200 || health.status !== 'available') throw new Error();
  console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', unauthorized_status: denied.status,
    authorized_status: response.status, items_in_first_page: page.items.length, next_cursor: page.next_cursor,
    request_id_present: Boolean(response.headers.get('x-request-id')), operations_status: health.status, outbox: health.outbox }));
} catch { console.error('Local source API smoke failed; token/configuration/payload diagnostics withheld.'); process.exitCode = 1; }
finally { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); }
