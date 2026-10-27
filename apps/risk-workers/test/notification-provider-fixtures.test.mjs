import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, createFakeProvider, deduplicateIntents, replayNotification } from './fixtures/notifications/fake-provider.mjs';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/notifications/cases.json', import.meta.url), 'utf8'));
function fixture(entry = corpus.cases[0]) {
  return { id: entry.id, behaviors: entry.behaviors, times: [1000, 7000, 13000], expiresAt: 1000 + (entry.ttlMs ?? LIMITS.ttlMs), replays: 3 };
}
function run(input, seed = corpus.seed) {
  let index = 0;
  return replayNotification(input, { seed, clock: () => input.times[index++] });
}
test('bounded deterministic corpus covers all seven failure boundaries without device claims', () => {
  assert.equal(corpus.cases.length, 7);
  assert.ok(corpus.cases.length <= LIMITS.cases);
  for (const entry of corpus.cases) {
    const result = run(fixture(entry));
    assert.deepEqual(result, run(fixture(entry)));
    assert.deepEqual([result.state, result.attempts.length, result.physicalAcceptances.length], entry.expected);
    assert.equal(result.semanticIntents, 1);
    assert.equal(result.duplicateSubmissions, 2);
    for (const key of ['deviceReceipt', 'deviceOpen', 'deviceAck']) assert.equal(result[key], 'unknown');
  }
  const crash = run(fixture(corpus.cases[6]));
  assert.deepEqual(crash.attempts.map(value => value.outcome), ['unknown', 'accepted']);
  assert.equal(crash.physicalAcceptances.length, 2);
});
test('semantic dedup binds identical expiry and rejects changed reuse and oversized input', () => {
  const intent = { id: 'synthetic_intent', expiresAt: 1000 };
  assert.deepEqual(deduplicateIntents(Array(16).fill(intent)), { count: 1, duplicates: 15 });
  assert.throws(() => deduplicateIntents(Array(17).fill(intent)));
  assert.throws(() => deduplicateIntents([intent, { ...intent, expiresAt: 2000 }]), /INTENT_CONFLICT/);
  assert.throws(() => deduplicateIntents([{ ...intent, recipient: 'withheld' }]), /details withheld/);
});
test('attempt cap, expiry on retry, lease and retry timing are enforced', () => {
  const offline = fixture(corpus.cases[1]);
  assert.equal(run(offline).attempts.length, 3);
  assert.equal(run({ ...offline, expiresAt: 7000 }).state, 'expired');
  assert.throws(() => run({ ...offline, times: [1000, 1001, 13000] }));
  assert.throws(() => run({ ...fixture(corpus.cases[6]), times: [1000, 5999, 13000] }));
  assert.equal(run({ ...fixture(corpus.cases[6]), times: [1000, 6000, 13000] }).state, 'accepted');
  const expiredProvider = createFakeProvider({ seed: 1, clock: () => 1000 });
  assert.equal(expiredProvider.send('expired', 1, 1000), 'permanent');
  assert.deepEqual(expiredProvider.evidence(), []);
});
test('seed controls jitter and local bounds reject coercion, unknown fields and oversize', () => {
  const make = seed => createFakeProvider({ seed, clock: () => 1000 });
  const a = make(305); const b = make(305);
  const values = Array.from({ length: 3 }, () => a.jitter());
  assert.deepEqual(values, Array.from({ length: 3 }, () => b.jitter()));
  assert.notEqual(values[0], make(306).jitter());
  assert.ok(values.every(value => value >= 0 && value < 1));
  for (const change of [{ expiresAt: 61001 }, { expiresAt: '61000' }, { replays: 4 }, { behaviors: Array(4).fill('offline') }, { extra: true }, { id: 'synthetic_' + 'a'.repeat(41) }]) {
    assert.throws(() => run({ ...fixture(), ...change }), /details withheld/);
  }
  assert.throws(() => run(fixture(), '305'));
  assert.throws(() => make(1).send('accepted', 4, 1000));
  const provider = make(1);
  provider.send('accepted', 1, 1000);
  const detached = provider.evidence(); detached.length = 0;
  assert.equal(provider.evidence().length, 1);
});
