import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeFeatureContributions as init, restoreFeatureContributions as restore,
  applyFeatureContribution as apply, evaluateFeatureContributions as evaluate,
  materializeFeatureContributions as materialize, evaluateTransactionRisk,
} from '../dist/index.js';
import { FEATURE_CATALOG_VERSION as version, featureGroupedHash, VECTOR_FIELDS } from '@lmps/contracts/feature-catalog';
import { riskFixture } from '../fixtures/request.mjs';

const clone = x => JSON.parse(JSON.stringify(x));
const policy = () => ({ version, scope: 'local_synthetic', identity: 'synthetic_declared',
  run_id: 'synthetic_run', namespace: 'synthetic_scope', input_identity: 'synthetic_input', semantics: version,
  currencies: ['SYN', 'USD'], anchor: 'occurred_at', window_seconds: 3600,
  watermark: '2026-01-01T12:00:00Z', coverage_start: '2026-01-01T08:00:00Z',
  allowed_lateness_seconds: 3600, active_ttl_seconds: 7200, freshness_seconds: 3600,
  limits: { deliveries: 2000, payments: 2000, attempts: 2000, revisions_per_payment: 2000,
    deliveries_per_key: 2000, queries: 8, bytes: 2097152 } });
const revision = (n = 1, changes = {}) => ({ namespace: 'synthetic_scope', payment_id: 'synthetic_p',
  attempt_id: 'synthetic_a', revision_id: `synthetic_r${n}`, revision_number: n, account_id: 'synthetic_A',
  occurred_at: '2026-01-01T11:30:00Z', available_at: '2026-01-01T11:30:00Z', currency: 'SYN',
  attempt_amount: '10.00', gross_amount: '10.00', reversed_amount: '0.00', lifecycle: 'succeeded',
  identity: 'synthetic_declared', coverage: 'complete', ...changes });
const query = (changes = {}) => ({ id: 'synthetic_q', account_id: 'synthetic_A', currency: 'SYN', as_of: '2026-01-01T12:00:00Z', ...changes });
const feed = (s, r, asof) => apply(s, { position: s.evidence.next_position, revision: r }, asof);
const vector = (s, q = query()) => { const x = evaluate(s, q); assert.equal(x.status, 'available'); return VECTOR_FIELDS.map(k => x.vector[k]); };
const expected = (...xs) => xs.map(String);
const rehash = x => { x.sha256 = featureGroupedHash([{ evidence: x.evidence, frozen_positions: x.frozen_positions }]); return x; };
const conflict = fn => assert.throws(fn, e => e.code === 'CONTRIBUTION_CONFLICT');
const limited = fn => assert.throws(fn, e => e.code === 'FEATURE_LIMIT');

test('independent lifecycle matrix and signed old-to-new corrections', () => {
  let s = init(policy());
  const matrix = [
    [revision(1, { lifecycle: 'pending', gross_amount: '0.00' }), [1, 1000, 0, 0, 0, 0, 0, 0]],
    [revision(2), [1, 1000, 1, 1000, 0, 0, 1, 1000]],
    [revision(3, { gross_amount: '8.00' }), [1, 1000, 1, 800, 0, 0, 1, 800]],
    [revision(4, { gross_amount: '8.00', lifecycle: 'partially_reversed', reversed_amount: '3.00' }), [1, 1000, 1, 800, 1, 300, 1, 500]],
    [revision(5, { gross_amount: '8.00', lifecycle: 'reversed', reversed_amount: '8.00' }), [1, 1000, 1, 800, 1, 800, 0, 0]],
  ];
  let previous = Array(8).fill('0');
  for (const [r, fixed] of matrix) {
    const original = JSON.stringify(s), out = feed(s, r);
    assert.equal(JSON.stringify(s), original);
    assert.deepEqual(vector(out.state), expected(...fixed));
    assert.deepEqual(VECTOR_FIELDS.map(k => out.corrections[0].delta[k]), fixed.map((n, i) => String(BigInt(n) - BigInt(previous[i]))));
    previous = expected(...fixed); s = restore(clone(out.state), policy());
  }
  assert.equal(s.evidence.next_position, 5);
  // Full reversal preserves gross count while retracting net-active count.
  assert.deepEqual(vector(s), expected(1, 1000, 1, 800, 1, 800, 0, 0));
});

test('failed retry uses supplied attempt IDs, duplicate revisions never double execute', () => {
  let s = feed(init(policy()), revision(1, { lifecycle: 'failed', gross_amount: '0.00' })).state;
  s = feed(s, revision(2, { attempt_id: 'synthetic_retry' })).state;
  assert.deepEqual(vector(s), expected(2, 2000, 1, 1000, 0, 0, 1, 1000));
  const duplicate = feed(s, revision(2, { attempt_id: 'synthetic_retry' }));
  assert.deepEqual(Object.values(duplicate.corrections[0].delta), Array(8).fill('0'));
  const replay = apply(duplicate.state, { position: 1, revision: revision(2, { attempt_id: 'synthetic_retry' }) });
  assert.deepEqual(replay.state, duplicate.state); assert.deepEqual(replay.corrections, []);
  const before = JSON.stringify(s);
  conflict(() => feed(s, revision(2, { attempt_id: 'synthetic_retry', gross_amount: '9.00' })));
  conflict(() => feed(s, revision(3, { revision_id: 'synthetic_r1' })));
  conflict(() => apply(s, { position: 0, revision: revision(1) }));
  assert.equal(JSON.stringify(s), before);
});

test('out-of-order and future-available revisions select latest eligible declared revision', () => {
  const old = revision(1), latest = revision(3, { gross_amount: '7.00', available_at: '2026-01-01T11:50:00Z' });
  let s = feed(init(policy()), latest).state;
  s = feed(s, old).state;
  s = feed(s, revision(2, { gross_amount: '8.00', available_at: '2026-01-01T11:40:00Z' })).state;
  assert.deepEqual(vector(s), expected(1, 1000, 1, 700, 0, 0, 1, 700));
  assert.deepEqual(vector(s, query({ as_of: '2026-01-01T11:45:00Z' })), expected(1, 1000, 1, 800, 0, 0, 1, 800));
  assert.deepEqual(vector(s, query({ as_of: '2026-01-01T11:35:00Z' })), expected(1, 1000, 1, 1000, 0, 0, 1, 1000));
  const future = feed(s, revision(4, { gross_amount: '6.00', available_at: '2026-01-01T12:01:00Z' }));
  assert.deepEqual(vector(future.state), vector(s));
  assert.deepEqual(Object.values(future.corrections[0].delta), Array(8).fill('0'));
  assert.throws(() => evaluate(s, query({ as_of: '2026-01-01T12:01:00Z' })), /CONTRIBUTION_TIME/);
  const forward = [old, revision(2, { gross_amount: '8.00', available_at: '2026-01-01T11:40:00Z' }), latest]
    .reduce((x, r) => feed(x, r).state, init(policy()));
  assert.deepEqual(vector(forward), vector(s));
});

test('unknown evidence is typed unavailable; valid zero, mixed buckets and immutable bindings', () => {
  for (const [change, reason] of [[{ lifecycle: 'unknown' }, 'UNKNOWN_LIFECYCLE'],
    [{ reversed_amount: null }, 'UNKNOWN_REVERSAL'], [{ identity: 'unknown' }, 'IDENTITY_UNAVAILABLE'],
    [{ coverage: 'unknown' }, 'COVERAGE_INCOMPLETE']]) {
    const out = feed(init(policy()), revision(1, change));
    assert.deepEqual(evaluate(out.state, query()), { status: 'unavailable', reason });
    assert.equal(out.corrections[0].delta, null);
  }
  let s = feed(init(policy()), revision(1, { attempt_amount: '0.00', gross_amount: '0.00' })).state;
  assert.deepEqual(vector(s), expected(1, 0, 1, 0, 0, 0, 0, 0));
  s = feed(s, revision(1, { payment_id: 'synthetic_usd', attempt_id: 'synthetic_usda', revision_id: 'synthetic_usdr', currency: 'USD' })).state;
  assert.deepEqual(vector(s, query({ currency: 'USD' })), expected(1, 1000, 1, 1000, 0, 0, 1, 1000));
  assert.deepEqual(vector(s), expected(1, 0, 1, 0, 0, 0, 0, 0));
  for (const change of [{ currency: 'USD' }, { account_id: 'synthetic_other' }, { occurred_at: '2026-01-01T11:31:00Z', available_at: '2026-01-01T11:31:00Z' },
    { payment_id: 'synthetic_other' }]) conflict(() => feed(s, revision(2, change)));
  for (const change of [{ reversed_amount: '11.00' }, { payment_id: undefined }, { attempt_id: undefined }, { gross_amount: '10.001' }]) {
    assert.throws(() => feed(s, revision(2, change)));
  }
});

test('frozen prefix survives later corrections and restart; forged results/state fail closed', () => {
  const s = feed(init(policy()), revision()).state;
  const out = materialize(s, query());
  assert.equal(Object.isFrozen(out.state.evidence.deliveries[0].revision), true);
  assert.equal(Object.isFrozen(out.snapshot.result.vector), true);
  assert.throws(() => { out.snapshot.result.vector.net_amount = '0'; }, TypeError);
  const corrected = feed(out.state, revision(2, { gross_amount: '2.00' })).state;
  const restored = restore(clone(corrected), policy());
  assert.deepEqual(materialize(restored, query()).snapshot, out.snapshot);
  assert.equal(evaluate(restored, query()).vector.net_amount, '200');
  conflict(() => materialize(restored, query({ currency: 'USD' })));
  for (const mutate of [x => { x.evidence.snapshots[0].result.vector.net_amount = '999'; },
    x => { x.evidence.snapshots[0].result = { status: 'unavailable', reason: 'UNKNOWN_REVERSAL' }; },
    x => { x.evidence.deliveries[1].revision.revision_number = 1; },
    x => { x.frozen_positions[0] = 2; }, x => { x.evidence.totals = {}; },
    x => { x.evidence.version = 'forged'; }, x => { x.evidence.next_position = 1; }]) {
    const bad = clone(corrected); mutate(bad); rehash(bad);
    assert.throws(() => restore(bad, policy()));
  }
  const bad = clone(corrected); bad.sha256 = '0'.repeat(64); assert.throws(() => restore(bad, policy()));
  assert.throws(() => restore(corrected, { ...policy(), run_id: 'synthetic_changed' }));
  let invoked = false;
  assert.throws(() => evaluate({ get evidence() { invoked = true; return s.evidence; } }, query()));
  assert.equal(invoked, false);
});

test('independent retained delivery/payment/attempt/revision/key/query caps at equality and one over', () => {
  for (const field of ['deliveries', 'payments', 'attempts', 'revisions_per_payment', 'deliveries_per_key']) {
    const p = policy(); p.limits[field] = 2;
    let s = init(p);
    for (let i = 1; i <= 2; i++) {
      const change = ['payments', 'attempts'].includes(field) ? { payment_id: `synthetic_p${i}`, attempt_id: `synthetic_a${i}` } : {};
      s = feed(s, revision(i, change)).state;
    }
    const before = JSON.stringify(s);
    const change = ['payments', 'attempts'].includes(field) ? { payment_id: 'synthetic_p3', attempt_id: 'synthetic_a3' } : {};
    if (field === 'deliveries') assert.throws(() => feed(s, revision(3, change)), e => e.code === 'FEATURE_MALFORMED');
    else limited(() => feed(s, revision(3, change)));
    assert.equal(JSON.stringify(s), before);
  }
  let s = init(policy());
  for (let i = 0; i < 8; i++) s = materialize(s, query({ id: `synthetic_q${i}` })).state;
  assert.equal(s.evidence.snapshots.length, 8);
  limited(() => materialize(s, query({ id: 'synthetic_q8' })));
  assert.deepEqual(restore(clone(s), policy()), s);
});

test('complete envelope byte equality, one-over, and retained delivery duplicates consume limits', () => {
  const p = policy();
  let s = feed(init(p), revision()).state;
  // Solve the self-describing byte limit including its own decimal digits and the hash.
  for (let i = 0; i < 4; i++) { p.limits.bytes = Buffer.byteLength(JSON.stringify(s)); s = feed(init(p), revision()).state; }
  assert.equal(Buffer.byteLength(JSON.stringify(s)), p.limits.bytes);
  assert.deepEqual(restore(clone(s), p), s);
  const small = clone(p); small.limits.bytes--;
  limited(() => feed(init(small), revision()));
  limited(() => feed(s, revision()));
  const bounded = policy(); bounded.limits.deliveries_per_key = 1;
  const one = feed(init(bounded), revision()).state;
  limited(() => feed(one, revision()));
});

test('absolute 2000-record bound and exact maximum money arithmetic on recovery', () => {
  const p = policy(), s = clone(init(p)), max = '9999999999999999999999.99';
  s.evidence.deliveries = Array.from({ length: 2000 }, (_, i) => ({ position: i, revision: revision(i + 1, {
    payment_id: `synthetic_p${i}`, attempt_id: `synthetic_a${i}`, attempt_amount: max, gross_amount: max }) }));
  s.evidence.next_position = 2000; rehash(s);
  const valid = restore(s, p);
  assert.deepEqual(vector(valid), ['2000', '1999999999999999999999998000', '2000', '1999999999999999999999998000', '0', '0', '2000', '1999999999999999999999998000']);
  assert.throws(() => feed(valid, revision(2001)));
  const over = clone(s); over.evidence.deliveries.push({ position: 2000, revision: revision(2001) }); over.evidence.next_position++;
  assert.throws(() => restore(over, p));
});

test('explicit window equality, absent account zero and incomplete coverage', () => {
  const left = feed(init(policy()), revision(1, { occurred_at: '2026-01-01T11:00:00Z' })).state;
  assert.deepEqual(vector(left), Array(8).fill('0'));
  const right = feed(init(policy()), revision(1, { occurred_at: '2026-01-01T12:00:00Z', available_at: '2026-01-01T12:00:00Z' })).state;
  assert.equal(vector(right)[7], '1000');
  assert.deepEqual(vector(right, query({ account_id: 'synthetic_absent' })), Array(8).fill('0'));
  const p = policy(); p.coverage_start = '2026-01-01T11:00:01Z';
  assert.deepEqual(evaluate(init(p), query()), { status: 'unavailable', reason: 'COVERAGE_INCOMPLETE' });
});

test('retraction of execution, attempt correction, forged success and supplied recovery watermark', () => {
  const initial = feed(init(policy()), revision()).state;
  const corrected = feed(initial, revision(2, { lifecycle: 'failed', gross_amount: '0.00', attempt_amount: '4.00' }));
  assert.deepEqual(vector(corrected.state), expected(1, 400, 0, 0, 0, 0, 0, 0));
  assert.deepEqual(VECTOR_FIELDS.map(k => corrected.corrections[0].delta[k]), expected(0, -600, -1, -1000, 0, 0, -1, -1000));
  const unknown = materialize(feed(init(policy()), revision(1, { reversed_amount: null })).state, query()).state;
  const forged = clone(unknown);
  forged.evidence.snapshots[0].result = { status: 'available', vector: Object.fromEntries(VECTOR_FIELDS.map(k => [k, '0'])) };
  rehash(forged); assert.throws(() => restore(forged, policy()));
  const frozen = materialize(initial, query()).state;
  const explicit = clone(frozen); explicit.evidence.watermark = '2026-01-01T12:01:00Z'; rehash(explicit);
  const recovered = restore(explicit, policy());
  assert.deepEqual(materialize(recovered, query()).snapshot, frozen.evidence.snapshots[0]);
  assert.equal(evaluate(recovered, query({ as_of: '2026-01-01T12:01:00Z' })).vector.net_amount, '1000');
  const regressed = clone(frozen); regressed.evidence.watermark = '2026-01-01T11:59:00Z'; rehash(regressed);
  assert.throws(() => restore(regressed, policy()));
});

test('unchanged B06/reference overlap: positive executed-net outgoing count and amount only', () => {
  // import.meta.url keeps fixture resolution independent of the invoking cwd.
  const corpus = JSON.parse(readFileSync(new URL('./fixtures/feature-streams/golden.json', import.meta.url)));
  assert.ok(corpus.events.length > 0);
  const { request, observation } = riskFixture();
  const source = request.context.events.filter(e => e.sender === 'synthetic_A' && e.occurred_at > '2026-01-01T11:00:00.000Z');
  let s = init(policy());
  for (const [i, e] of source.entries()) s = feed(s, revision(1, {
    payment_id: e.transaction_id, attempt_id: `synthetic_attempt${i}`, revision_id: `synthetic_ref${i}`,
    occurred_at: e.occurred_at.replace('.000Z', 'Z'), available_at: e.available_at.replace('.000Z', 'Z'),
    attempt_amount: e.amount, gross_amount: e.amount,
  })).state;
  const out = evaluateTransactionRisk(request, observation), v = evaluate(s, query()).vector;
  assert.equal(v.net_active_count, '3'); assert.equal(v.net_amount, '265000');
  assert.equal(out.findings.find(x => x.code === 'FRAUD_COUNT_VELOCITY').metric.value, v.net_active_count);
  assert.equal(out.findings.find(x => x.code === 'FRAUD_AMOUNT_VELOCITY').metric.value, '2650.00');
  // Gross, attempts, zero executions and full reversal counts are intentionally not reference parity claims.
});
