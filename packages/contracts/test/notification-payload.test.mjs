import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotificationPayload as parse, resolveNotificationLink as resolve, NOTIFICATION_PAYLOAD_LIMITS as limits } from '../dist/notification-payload.js';
const fixture = () => ({ provenance: 'local_synthetic', execution_mode: 'test', intent_handle: 'synthetic_i', detail_handle: 'synthetic_d' });
const origin = 'https://notifications.invalid';
const link = (p = fixture(), base = origin) => `${base}/notifications/intents/${p.intent_handle}/details/${p.detail_handle}`;
const error = { message: 'Local notification payload rejected; details withheld.' };

test('minimal detached payload; navigation requires authenticated authorized retrieval', () => {
  const input = fixture(), copy = parse(input), result = resolve(input, origin, link());
  assert.deepEqual(copy, input);
  assert.equal(result.requires_authenticated_retrieval, true);
  assert.equal(result.authorization_grant, false);
  input.detail_handle = 'synthetic_changed'; copy.intent_handle = 'synthetic_changed';
  assert.deepEqual(result.payload, fixture());
  result.payload.detail_handle = 'synthetic_changed';
  assert.deepEqual(resolve(fixture(), origin, link()).payload, fixture());
});

test('unknown and sensitive fields, malformed and oversized handles, non-data objects', () => {
  for (const key of ['account', 'amount', 'evidence', 'risk', 'label', 'title', 'body', 'url', 'token']) assert.throws(() => parse({ ...fixture(), [key]: 'withheld' }), error);
  for (const h of ['', 'synthetic_', 1, null, {}, 'account', 'synthetic_a/b', 'synthetic_a%2fb', 'synthetic_a?x', 'synthetic_a#x', 'synthetic_a\\b', 'synthetic_a\n', 'synthetic_é', 'synthetic_' + 'a'.repeat(limits.handleSuffix + 1)]) {
    for (const key of ['intent_handle', 'detail_handle']) assert.throws(() => parse({ ...fixture(), [key]: h }), error);
  }
  const max = { ...fixture(), intent_handle: 'synthetic_' + 'a'.repeat(64), detail_handle: 'synthetic_' + 'b'.repeat(64) };
  assert.deepEqual(parse(max), max); assert.equal(resolve(max, origin, link(max)).url, link(max));
  for (const value of [null, [], new Date(), { ...fixture(), provenance: 'real' }, { ...fixture(), execution_mode: 'production' }, { ...fixture(), [Symbol('extra')]: true }, Object.assign(Object.create({}), fixture())]) assert.throws(() => parse(value), error);
  const missing = fixture(); delete missing.detail_handle; assert.throws(() => parse(missing), error);
  let invoked = false;
  const getter = fixture(); Object.defineProperty(getter, 'detail_handle', { get() { invoked = true; return 'synthetic_d'; } });
  assert.throws(() => parse(getter), error); assert.equal(invoked, false);
  assert.deepEqual(parse(Object.assign(Object.create(null), fixture())), fixture());
});

test('unsafe schemes, cross-origin destinations and path normalization/injection', () => {
  for (const base of ['http://notifications.invalid', 'javascript:alert(1)', 'data:text/plain,x', 'file:///x', '//notifications.invalid', 'https://example.com', origin + '/', origin + ':443', 'https://user@notifications.invalid', origin + '/path', origin + '?x', origin + '#x', 'https://NOTIFICATIONS.invalid', 'https://-bad.invalid', 'https://' + 'a'.repeat(254) + '.invalid', null]) assert.throws(() => resolve(fixture(), base, link()), error);
  for (const destination of ['javascript:alert(1)', 'data:text/plain,x', 'http://notifications.invalid', link(fixture(), 'https://other.invalid'), link().replace('https:', ''), link() + '?account=x', link() + '#x', link() + '/', link().replace('/details/', '/other/'), link().replace('/details/', '/x/../details/'), link().replace('synthetic_d', '%73ynthetic_d'), link().replace('/details/', '/%2e%2e/details/'), link().replace('/details/', '\\details\\'), 'x'.repeat(limits.urlCharacters + 1), null]) assert.throws(() => resolve(fixture(), origin, destination), error);
});
