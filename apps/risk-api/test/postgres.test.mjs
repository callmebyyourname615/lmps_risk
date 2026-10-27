import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@lmps/database';
import { createApp } from '../dist/app.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';

let temporary;
let state;
let app;
let observer;
let origin;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'lmps-api-db-test-'));
  state = await initializeCluster(join(temporary, 'cluster'), await availablePort());
  await startCluster(state);
  observer = createDatabase(dsn(state, 'migration'), 'migration');
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state) }));
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});

after(async () => {
  await app?.close();
  await observer?.close();
  if (temporary && !state) {
    try { state = await loadState(join(temporary, 'cluster')); }
    catch { return; }
  }
  if (state) await stopCluster(state);
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('configured database is available while payment readiness remains 503', async () => {
  const response = await fetch(origin + '/health/ready');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body.dependencies, { postgres: 'available', source_sync: 'not_implemented', risk_engine: 'not_implemented' });
  assert.equal(body.reason, 'bootstrap_only');
  const document = await (await fetch(origin + '/openapi.json')).json();
  assert.deepEqual(document.components.schemas.BootstrapDependencies.properties.postgres.enum, ['not_configured', 'available', 'unavailable']);
});

test('database outage is bounded, does not echo credentials and leaves liveness available', async () => {
  await stopCluster(state);
  const started = Date.now();
  const response = await fetch(origin + '/health/ready');
  assert.ok(Date.now() - started < 3000);
  assert.equal(response.status, 503);
  const text = await response.text();
  if (text.includes(state.passwords.app)) throw new Error('Credential echoed in readiness response.');
  assert.equal(JSON.parse(text).dependencies.postgres, 'unavailable');
  assert.equal((await fetch(origin + '/health/live')).status, 200);
  await startCluster(state);
  assert.equal((await (await fetch(origin + '/health/ready')).json()).dependencies.postgres, 'available');
});

test('invalid external/admin DSNs fail before starting API and redact the supplied value', async () => {
  const external = new URL(dsn(state));
  external.hostname = 'external.invalid';
  for (const value of [dsn(state, 'migration'), external.href]) {
    await assert.rejects(createApp({ LMPS_POSTGRES_DSN: value }), error => error.message === 'Invalid local PostgreSQL configuration.');
  }
});

test('real API entrypoint closes its DB sessions on SIGTERM', async () => {
  await app.close();
  app = undefined;
  const port = await availablePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/main.js', import.meta.url))], {
    env: { ...process.env, LMPS_ENVIRONMENT: 'test', LMPS_EXECUTION_MODE: 'test', LMPS_API_PORT: String(port), LMPS_POSTGRES_DSN: dsn(state) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');
  try {
    let ready = false;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
        ready = (await response.json()).dependencies.postgres === 'available';
        if (ready) break;
      } catch {}
      await new Promise(accept => setTimeout(accept, 30));
    }
    assert.equal(ready, true);
    assert.equal((await observer.pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'lmps-local-app'")).rows[0].count, 1);
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('API shutdown deadline exceeded.')), 5000).unref())]);
    assert.equal((await observer.pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'lmps-local-app'")).rows[0].count, 0);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health/live`));
    if (output.includes(state.passwords.app)) throw new Error('Credential appeared in entrypoint output.');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
});
