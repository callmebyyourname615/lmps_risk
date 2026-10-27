import { createPortalClient, PortalError, tokenIdentity, type Locale } from './client.ts';

export function isLocalPreview(hostname: string, marker: string | null) {
  return (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]') && marker === 'signed-fixture';
}

// The endpoint exists only in the explicitly started synthetic preview fixture.
// A valid signed catalog read is still required before returning a connection.
export async function connectPreview(locale: Locale, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch) {
  let candidate: ReturnType<typeof createPortalClient> | undefined;
  try {
    const response = await fetcher('/__lmps_preview/session', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      signal, headers: { 'Content-Type': 'application/json', 'X-LMPS-Preview': '1' }, body: '{}',
    });
    if (!response.ok) throw new PortalError('PORTAL_NETWORK');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string' || body.token.length > 4000) throw new PortalError('PORTAL_BAD_RESPONSE');
    const parsed = tokenIdentity(body.token);
    candidate = createPortalClient(parsed.token, fetcher);
    const catalog = await candidate.catalog(locale, signal);
    if (signal.aborted || parsed.identity.expires <= Date.now()) throw new PortalError('UNAUTHORIZED', 401);
    return { token: parsed.token, identity: parsed.identity, client: candidate, catalog };
  } catch (error) {
    candidate?.close();
    if (error instanceof PortalError) throw error;
    throw new PortalError('PORTAL_NETWORK');
  }
}
