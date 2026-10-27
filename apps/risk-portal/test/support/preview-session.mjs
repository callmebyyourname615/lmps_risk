import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PORTAL_DIST } from '../../../risk-api/dist/portal.js';

// This module is imported only by test/support/fixture.mjs, never the runtime API.
export function registerPreviewSession(app, auth, { origin, lifetimeSeconds = 300 }) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin || !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 2 || lifetimeSeconds > 300) throw new Error('Invalid loopback fixture configuration');
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' && ['/portal/', '/portal/index.html'].includes(request.url.split('?')[0])) {
      const html = (await readFile(join(PORTAL_DIST, 'index.html'), 'utf8')).replace('<head>', '<head><meta name="lmps-local-preview" content="signed-fixture" />');
      return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html);
    }
  });
  app.post('/__lmps_preview/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
    if (request.headers.origin !== origin || request.headers['x-lmps-preview'] !== '1'
      || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
      || request.headers['content-type'] !== 'application/json' || request.body === null || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length !== 0) {
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    const token = await auth.token({ sub: 'synthetic_reviewer', scope: 'alerts:read alerts:review', exp: Math.floor(Date.now() / 1000) + lifetimeSeconds });
    return { token };
  });
}
