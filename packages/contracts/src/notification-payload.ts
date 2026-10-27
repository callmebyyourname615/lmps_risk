/** Local fixture bounds, not business limits. Handles must be invented opaque
 * values, never encoded account/amount/evidence/risk/label details. */
export const NOTIFICATION_PAYLOAD_LIMITS = Object.freeze({ handleSuffix: 64, originCharacters: 253, urlCharacters: 512 });
export interface NotificationPayload {
  provenance: 'local_synthetic'; execution_mode: 'test';
  intent_handle: string; detail_handle: string;
}
function reject(): never { throw new Error('Local notification payload rejected; details withheld.'); }
/** Exact data properties only; no lock-screen text, sensitive fields or URL.
 * Returned values are detached from the untrusted input. */
export function parseNotificationPayload(input: unknown): NotificationPayload {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) reject();
  const d = Object.getOwnPropertyDescriptors(input);
  const keys = ['provenance', 'execution_mode', 'intent_handle', 'detail_handle'];
  if (Reflect.ownKeys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d, k) || !('value' in d[k]!))) reject();
  const provenance: unknown = d.provenance!.value, execution_mode: unknown = d.execution_mode!.value;
  const intent_handle: unknown = d.intent_handle!.value, detail_handle: unknown = d.detail_handle!.value;
  if (provenance !== 'local_synthetic' || execution_mode !== 'test') reject();
  for (const h of [intent_handle, detail_handle]) {
    if (typeof h !== 'string' || h.length > 74 || !/^synthetic_[A-Za-z0-9_-]{1,64}$/.test(h) || /\s/.test(h)) reject();
  }
  return { provenance, execution_mode, intent_handle: intent_handle as string, detail_handle: detail_handle as string };
}
/** Caller supplies a separately trusted allowlisted synthetic HTTPS origin.
 * Only reserved .invalid hosts and one canonical path are supported. This is
 * navigation metadata, never an authorization grant. Detail retrieval MUST
 * authenticate and independently authorize caller/tenant/owner/environment;
 * opaque handles are never credentials. No retrieval or network IO occurs. */
export function resolveNotificationLink(input: unknown, allowlistedSyntheticOrigin: unknown, destination: unknown): {
  payload: NotificationPayload; url: string; requires_authenticated_retrieval: true; authorization_grant: false;
} {
  const payload = parseNotificationPayload(input);
  if (typeof allowlistedSyntheticOrigin !== 'string' || allowlistedSyntheticOrigin.length > NOTIFICATION_PAYLOAD_LIMITS.originCharacters ||
      !/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+invalid$/.test(allowlistedSyntheticOrigin)) reject();
  let origin: URL;
  try { origin = new URL(allowlistedSyntheticOrigin); } catch { return reject(); }
  if (origin.origin !== allowlistedSyntheticOrigin) reject();
  const expected = `${allowlistedSyntheticOrigin}/notifications/intents/${payload.intent_handle}/details/${payload.detail_handle}`;
  if (typeof destination !== 'string' || destination.length > NOTIFICATION_PAYLOAD_LIMITS.urlCharacters || destination !== expected) reject();
  const parsed = new URL(destination);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin.origin || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.href !== expected) reject();
  return { payload, url: expected, requires_authenticated_retrieval: true, authorization_grant: false };
}
