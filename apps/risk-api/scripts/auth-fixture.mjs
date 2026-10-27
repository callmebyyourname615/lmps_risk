import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { localMode } from '../../../packages/database/scripts/local.mjs';
import { LOCAL_ISSUER, LOCAL_AUDIENCE } from '../dist/local-auth.js';

export async function authFixture(privateDirectory) {
  localMode();
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const kid = randomUUID();
  const config = { format: 1, kind: 'local_synthetic', issuer: LOCAL_ISSUER, audience: LOCAL_AUDIENCE,
    jwks: { keys: [{ ...await exportJWK(publicKey), kid, alg: 'ES256', use: 'sig' }] } };
  const path = join(privateDirectory, 'auth.json');
  await writeFile(path, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  return { path, config, async token(changes = {}, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: LOCAL_ISSUER, aud: LOCAL_AUDIENCE, sub: 'synthetic_analyst', iat: now, nbf: now, exp: now + 300,
      jti: randomUUID(), scope: 'source:read', workspace_key: 'synthetic_local', ...changes })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid, ...header }).sign(privateKey);
  } };
}
