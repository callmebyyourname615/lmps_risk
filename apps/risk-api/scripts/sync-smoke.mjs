import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../dist/app.js';
import { dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { authFixture } from './auth-fixture.mjs';

let temporary, app;
try {
  localMode(); const capture = process.argv[2];
  if (process.argv.length !== 3 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(capture)) throw new Error();
  temporary = await mkdtemp('/tmp/lmps-sync-smoke-'); const fixture = await authFixture(temporary);
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(await loadState()), LMPS_LOCAL_AUTH_CONFIG: fixture.path }));
  await app.listen(0, '127.0.0.1'); const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const url = origin + '/v1/local/sync/jobs?capture_id=' + capture;
  const missing = await fetch(url); const source = await fetch(url, { headers: { authorization: 'Bearer ' + await fixture.token() } });
  const headers = { authorization: 'Bearer ' + await fixture.token({ scope: 'sync:read' }) };
  const response = await fetch(url, { headers }); const page = await response.json();
  if (missing.status !== 401 || source.status !== 403 || response.status !== 200 || page.items.length !== 1) throw new Error();
  const job = page.items[0]; if (job.capture_id !== capture || job.status !== 'reconciled' || job.last_attempt?.reconciliation_status !== 'PASS') throw new Error();
  const attemptsResponse = await fetch(origin + '/v1/local/sync/jobs/' + job.job_ref + '/attempts?limit=100', { headers });
  const attempts = await attemptsResponse.json();
  if (attemptsResponse.status !== 200 || attempts.next_cursor !== null || attempts.items.at(-1)?.attempt_number !== job.attempt_number) throw new Error();
  console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', unauthorized_status: missing.status,
    wrong_scope_status: source.status, authorized_status: response.status, status: job.status, attempts: attempts.items.length,
    total: job.total, processed: job.last_attempt.processed, inserted: job.last_attempt.inserted, duplicate: job.last_attempt.duplicate,
    reconciliation_status: job.last_attempt.reconciliation_status }));
} catch { console.error('Local sync API smoke failed; data/token/storage diagnostics withheld.'); process.exitCode = 1; }
finally { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); }
