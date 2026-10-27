// In-memory synthetic test support. No queue, recipient or network.
// Outcomes, attempt cap, lease and backoff mirror packages/database/src/outbox.ts.
export const LIMITS = Object.freeze({ attempts: 3, ttlMs: 60000, cases: 16 });
const behaviors = ['accepted', 'offline', 'expired', 'revoked', 'rate-limited', 'invalid-subscription', 'crash-after-acceptance'];
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - LIMITS.ttlMs;
function invalid() { throw new Error('Invalid synthetic fixture; details withheld.'); }

// Bounded evidence of semantic binding, not a delivery queue.
export function deduplicateIntents(submissions) {
  if (!Array.isArray(submissions) || submissions.length < 1 || submissions.length > LIMITS.cases) invalid();
  const intents = new Map(); let duplicates = 0;
  for (const input of submissions) {
    if (!input || Object.keys(input).sort().join(',') !== 'expiresAt,id'
      || typeof input.id !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(input.id) || !validTime(input.expiresAt)) invalid();
    if (intents.has(input.id)) {
      if (intents.get(input.id) !== input.expiresAt) throw new Error('INTENT_CONFLICT');
      duplicates++;
    } else intents.set(input.id, input.expiresAt);
  }
  return { count: intents.size, duplicates };
}

export function createFakeProvider({ clock, seed }) {
  if (typeof clock !== 'function' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) invalid();
  let random = seed;
  const evidence = [];
  return {
    now() { const at = clock(); if (!validTime(at)) invalid(); return at; },
    jitter() { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 0x100000000; },
    send(behavior, attempt, at) {
      if (!behaviors.includes(behavior) || !Number.isInteger(attempt) || attempt < 1 || attempt > 3 || !validTime(at)) invalid();
      if (behavior === 'accepted' || behavior === 'crash-after-acceptance') {
        evidence.push({ attempt, at, acceptance: 'fake-provider-only' });
        if (behavior === 'crash-after-acceptance') throw new Error('SIMULATED_CRASH_AFTER_ACCEPTANCE');
        return 'accepted';
      }
      return ['offline', 'rate-limited'].includes(behavior) ? 'retry' : 'permanent';
    },
    evidence() { return structuredClone(evidence); },
  };
}

// Single-intent replay only: submissions are exact duplicates of the same fixture.
// This is not a second queue and makes no production deduplication claim.
export function replayNotification(input, { clock, seed }) {
  if (!input || Object.keys(input).sort().join(',') !== 'behaviors,expiresAt,id,replays,times'
    || typeof input.id !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(input.id)
    || !Array.isArray(input.behaviors) || input.behaviors.length < 1 || input.behaviors.length > 3
    || !input.behaviors.every(value => behaviors.includes(value))
    || !Array.isArray(input.times) || input.times.length !== 3 || !input.times.every(validTime)
    || input.times.some((value, index) => index > 0 && value < input.times[index - 1])
    || !validTime(input.expiresAt) || input.expiresAt < input.times[0] || input.expiresAt > input.times[0] + LIMITS.ttlMs
    || !Number.isInteger(input.replays) || input.replays < 1 || input.replays > 3) invalid();
  const fixture = structuredClone(input);
  const semantic = deduplicateIntents(Array.from({ length: fixture.replays }, () => ({ id: fixture.id, expiresAt: fixture.expiresAt })));
  const provider = createFakeProvider({ clock, seed });
  const attempts = [];
  let state = 'pending'; let availableAt = fixture.times[0];
  for (let index = 0; index < LIMITS.attempts && state === 'pending'; index++) {
    const at = provider.now();
    if (at !== fixture.times[index] || at < availableAt) invalid();
    if (at >= fixture.expiresAt) { state = 'expired'; break; }
    const behavior = fixture.behaviors[Math.min(index, fixture.behaviors.length - 1)];
    let outcome;
    try { outcome = provider.send(behavior, index + 1, at); }
    catch (error) {
      if (error.message !== 'SIMULATED_CRASH_AFTER_ACCEPTANCE') throw error;
      outcome = 'unknown';
    }
    attempts.push({ attempt: index + 1, at, outcome });
    if (outcome === 'accepted') state = 'accepted';
    else if (outcome === 'permanent' || index + 1 === 3) state = 'dead';
    else availableAt = at + (outcome === 'unknown' ? 5000 : (2 ** index + provider.jitter()) * 1000);
  }
  return { provenance: 'local_synthetic', execution_mode: 'test', semanticIntents: semantic.count,
    duplicateSubmissions: semantic.duplicates, state, attempts, physicalAcceptances: provider.evidence(),
    deviceReceipt: 'unknown', deviceOpen: 'unknown', deviceAck: 'unknown' };
}
