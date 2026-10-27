import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const PORTAL_DIST = fileURLToPath(new URL('../../risk-portal/dist/', import.meta.url));
export function registerPortal(app: FastifyInstance) {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.split('?')[0] === '/portal' || request.url.startsWith('/portal/')) {
      reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        .header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-store');
    }
    return payload;
  });
  app.get('/portal', async (_request, reply) => reply.redirect('/portal/'));
  app.register(fastifyStatic, { root: PORTAL_DIST, prefix: '/portal/', decorateReply: false, index: ['index.html'], dotfiles: 'deny', etag: false, lastModified: false,
    allowedPath(pathname) { const path = pathname.replace(/^\/+/, ''); return path === '' || path === 'index.html' || /^assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(path); },
  });
}
