import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../dist/app.js';
import { authFixture } from './auth-fixture.mjs';
import { dsn, identify, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';

export const CORE_ROLES = {
  detection_operator: { sub: 'synthetic_detection_operator', scope: 'alerts:read risk-jobs:read risk-jobs:retry' },
  case_manager: { sub:'synthetic_case_manager', scope:'alerts:read risk:read cases:read cases:write cases:assign audit:read' },
  adjudicator: {sub:'synthetic_core_adjudicator',scope:'labels:read labels:adjudicate cases:read risk:read alerts:read'},
  reader: { sub: 'synthetic_core_reader', scope: 'source:read operations:read sync:read transactions:read rules:read assessments:read risk:read alerts:read risk-jobs:read policies:read cases:read audit:read labels:read' },
  author: { sub: 'synthetic_core_author', scope: 'policies:read policies:write cases:read cases:write cases:assign cases:reopen alerts:read risk:read' },
  checker: { sub: 'synthetic_core_checker', scope: 'policies:read policies:approve policies:activate' },
  analyst: { sub: 'synthetic_core_analyst', scope: 'cases:read cases:work alerts:read alerts:review risk:read audit:read' },
};

// Explicit local fixture launcher; it never prepares roles, migrates or seeds on startup.
export async function openCoreApi(state, port, options = {}) {
  localMode();
  let directory, app;
  const close = async () => {
    try { await app?.close(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  };
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error();
    const probe = await identify(state, 'lmps_risk_local');
    await probe.end();
    if ((await migrations(dsn(state, 'migration'))).some(row => row.status !== 'applied')) throw new Error();
    directory = await mkdtemp('/tmp/lmps-core-auth-');
    const auth = await authFixture(directory);
    ({ app } = await createApp({ LMPS_ENVIRONMENT: 'local', LMPS_EXECUTION_MODE: 'test', LMPS_API_PORT: String(port),
      LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path, ...(options.modelPublicKeyFile ? {LMPS_ML_PUBLIC_KEY_FILE: options.modelPublicKeyFile} : {}),
      LMPS_LOCAL_REVIEW_DSN: dsn(state, 'reviewer'), LMPS_LOCAL_POLICY_DSN: dsn(state, 'policy'), LMPS_LOCAL_CASE_DSN: dsn(state, 'case'),
      LMPS_LOCAL_DETECTION_DSN: dsn(state, 'intake'), LMPS_DETECTION_WORKER: options.detectionWorker === true ? '1' : '0' }));
    await app.listen(port, '127.0.0.1');
    const url = `http://127.0.0.1:${port}`;
    const token = role => {
      if (!Object.hasOwn(CORE_ROLES, role)) throw new Error('Unknown local core role.');
      return auth.token(CORE_ROLES[role]);
    };
    return { app, url, directory, token, close,
      async request(role, method, path, body, expected = 200) {
        if (typeof path !== 'string' || !path.startsWith('/v1/local/')) throw new Error('Invalid local core API path.');
        const response = await fetch(url + path, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
          headers: { authorization: 'Bearer ' + await token(role), 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.status !== expected) throw new Error('Local core API returned an unexpected status.');
        return response.json();
      },
    };
  } catch {
    await close();
    throw new Error('Local core startup failed; verify owned database, prepared roles, migrations and free loopback port.');
  }
}

export async function startCore(state, port) {
  localMode();
  const raw = process.env.LMPS_API_PORT ?? '18501';
  if (!/^\d+$/.test(raw)) throw new Error('Invalid local core port.');
  const runtime = await openCoreApi(state ?? await loadState(), port ?? Number(raw));
  try {
    const expires = new Date(Date.now() + 300_000).toISOString();
    for (const role of Object.keys(CORE_ROLES)) {
      await writeFile(join(runtime.directory, role + '.json'), JSON.stringify({ authorization: 'Bearer ' + await runtime.token(role), expires_at: expires }), { mode: 0o600, flag: 'wx' });
    }
    return runtime;
  } catch { await runtime.close(); throw new Error('Local core token publication failed.'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error();
    const runtime = await startCore();
    console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', docs: runtime.url + '/docs', token_directory: runtime.directory, token_lifetime_seconds: 300 }));
    let closing = false;
    const stop = async () => { if (closing) return; closing = true; await runtime.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('Local core startup failed; credentials and diagnostics withheld.'); process.exitCode = 1; }
}
