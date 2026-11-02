import { isAbsolute, resolve } from 'node:path';
import { LOCAL, ROOT } from '../packages/database/scripts/local.mjs';

const port = (raw, fallback) => {
  const value = raw ?? String(fallback);
  if (!/^[1-9]\d{3,4}$/.test(value) || Number(value) > 65535) throw new Error('Invalid runtime profile port.');
  return Number(value);
};

// One source tree; explicit owned database state and matching API/session pair.
// Production has a separate trusted bootstrap; a local test issuer cannot become production by renaming a profile.
export function runtimeProfile(env = process.env) {
  const profile = env.LMPS_RUNTIME_PROFILE ?? 'local';
  if (!['local', 'intake'].includes(profile) || env.NODE_ENV === 'production') throw new Error('Unsupported local runtime profile.');
  const expected = profile === 'intake' ? resolve(ROOT, '.local/environments/intake/postgres') : LOCAL;
  const stateDirectory = env.LMPS_POSTGRES_STATE_DIR ?? expected;
  if (!isAbsolute(stateDirectory) || resolve(stateDirectory) !== expected) throw new Error('Runtime profile database state does not match its environment.');
  const apiPort = port(env.LMPS_API_PORT, profile === 'intake' ? 18511 : 18501);
  const issuerPort = port(env.LMPS_ALERT_SESSION_PORT, profile === 'intake' ? 18517 : 18507);
  if (apiPort === issuerPort || profile === 'intake' && [apiPort, issuerPort].some(p => [18501, 18503, 18507].includes(p))) throw new Error('Runtime profile ports overlap the existing environment.');
  if (profile === 'intake' && (env.LMPS_WEB_PUSH_CONFIG || env.LMPS_WEB_PUSH_WORKER === '1')) throw new Error('Intake profile does not send external Web Push.');
  return { profile, stateDirectory, apiPort, issuerPort, apiOrigin: `http://127.0.0.1:${apiPort}`, sessionOrigin: `http://127.0.0.1:${issuerPort}` };
}
