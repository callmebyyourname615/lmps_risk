import test from 'node:test';
import assert from 'node:assert/strict';
import { PretransferReservationRegistry, SyntheticReservationQueue } from '../dist/index.js';
import { SIMULATION_BOUNDARY as b, isSimulationResult } from '@lmps/contracts/pretransfer-simulation';
const now = '2026-10-25T00:00:00.000Z', expiry = '2026-10-25T01:00:00.000Z';
const caller = { ...b, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' };
const req = (id = 0, extra = {}) => ({ ...b, namespace: 'synthetic_test', payment_id: `synthetic_payment_${id}`,
  attempt_id: 'synthetic_attempt', idempotency_key: `synthetic_key_${id}`, sender: 'synthetic_sender',
  receiver: 'synthetic_receiver', amount: '9007199254740993.01', currency: 'USD', product: 'synthetic_product', expires_at: expiry, ...extra });
const policy = (c = caller, r = req(), extra = {}) => ({ ...b, caller: c, namespace: r.namespace,
  sender: r.sender, currency: r.currency, max_in_flight_count: 1, max_in_flight_amount: r.amount, ...extra });
const outcome = (r, state) => ({ ...b, reference: r.reference, outcome: state });
const fresh = () => new PretransferReservationRegistry([policy()]);

test('aggregate capacity preserves the last cent above the safe integer range', async () => {
  const s = new PretransferReservationRegistry([policy(caller, req(), {
    max_in_flight_count: 3, max_in_flight_amount: '18014398509481986.02',
  })]);
  const results = await Promise.all([0, 1, 2].map(i => s.reserve(caller, req(i), now)));
  assert.deepEqual(results.map(r => r.status), ['reserved', 'reserved', 'rejected']);
  assert.equal(s.usage(caller, req()).pending_cents, 1801439850948198602n);
  await s.reconcile(caller, outcome(results[0], 'failed'), now);
  assert.equal((await s.reserve(caller, req(2, { amount: '9007199254740993.02' }), now)).reason_code,
    'CAPACITY_EXCEEDED');
  assert.equal((await s.reserve(caller, req(2), now)).status, 'reserved');
  assert.equal(s.usage(caller, req()).pending_cents, 1801439850948198602n);
});

test('changed retry conflicts even when its replacement scope has no policy', async () => {
  const s = fresh(), r = await s.reserve(caller, req(), now);
  for (const change of [{ sender: 'synthetic_unconfigured' }, { currency: 'JPY' }]) {
    assert.equal((await s.reserve(caller, req(0, change), now)).reason_code, 'IDEMPOTENCY_CONFLICT');
  }
  assert.equal(s.size, 1);
  assert.equal(s.usage(caller, req()).pending_count, 1);
  assert.equal(await s.reserve(caller, req(), now), r);
});

test('asynchronous throw releases queue and cancelled callbacks leave capacity occupied', async () => {
  const q = new SyntheticReservationQueue();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const failed = q.run(async () => { await gate; throw new Error('synthetic failure'); });
  const abort = new AbortController();
  let ran = false;
  const cancelled = q.run(() => { ran = true; }, abort.signal);
  const next = q.run(() => 'released');
  const settled = Promise.allSettled([failed, cancelled, next]);
  abort.abort();
  release();
  const results = await settled;
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected', 'fulfilled']);
  assert.equal(results[2].value, 'released');
  assert.equal(ran, false);
  const s = fresh(), r = await s.reserve(caller, req(), now);
  assert.equal((await s.reconcile(caller, outcome(r, 'executed'), now, abort.signal)).status, 'rejected');
  assert.equal(s.usage(caller, req()).pending_count, 1);
  assert.equal(s.usage(caller, req()).executed_count, 0);
  assert.equal((await s.reconcile(caller, outcome(r, 'failed'), now)).status, 'failed');
  assert.equal((await s.reserve(caller, req(1), now)).status, 'reserved');
});

test('queued inputs are snapshots and duplicate release cannot free a replacement', async () => {
  const s = fresh(), mutable = req();
  const pending = s.reserve(caller, mutable, now);
  mutable.amount = '0.00';
  mutable.receiver = 'synthetic_changed';
  const r = await pending;
  assert.equal(r.binding.request.amount, req().amount);
  assert.equal(r.binding.request.receiver, req().receiver);
  const results = await Promise.all([
    s.reconcile(caller, outcome(r, 'failed'), now),
    s.reserve(caller, req(1), now),
    s.reconcile(caller, outcome(r, 'failed'), now),
    s.reserve(caller, req(2), now),
  ]);
  assert.deepEqual(results.map(r => r.status), ['failed', 'reserved', 'failed', 'rejected']);
  assert.equal(s.usage(caller, req()).pending_cents, 900719925474099301n);
});

test('actual Promise submissions serialize same-key retries and capacity-one competing keys', async () => {
  const s = fresh();
  const receipts = await Promise.all(Array.from({ length: 50 }, () => s.reserve(caller, req(), now)));
  assert.ok(receipts.every(r => r === receipts[0] && isSimulationResult(r)));
  assert.equal(s.size, 1);
  assert.equal(s.usage(caller, req()).pending_count, 1);
  const t = fresh();
  const competing = await Promise.all(Array.from({ length: 50 }, (_, i) => t.reserve(caller, req(i), now)));
  assert.equal(competing.filter(r => r.status === 'reserved').length, 1);
  assert.equal(competing.filter(r => r.reason_code === 'CAPACITY_EXCEEDED').length, 49);
});

test('timeout-after-record retry and duplicate callbacks contribute and release once', async () => {
  for (const state of ['executed', 'failed', 'cancelled', 'expired']) {
    const s = fresh(), r = await s.reserve(caller, req(), now);
    const at = state === 'expired' ? expiry : now;
    const responses = await Promise.all(Array.from({ length: 20 }, () => s.reconcile(caller, outcome(r, state), at)));
    assert.ok(responses.every(v => v === responses[0] && v.status === state && isSimulationResult(v)));
    assert.equal(await s.reserve(caller, req(), at), r);
    const usage = s.usage(caller, req());
    assert.equal(usage.pending_count, 0);
    assert.equal(usage.pending_cents, 0n);
    assert.equal(usage.executed_count, state === 'executed' ? 1 : 0);
    assert.equal(usage.executed_cents, state === 'executed' ? 900719925474099301n : 0n);
    assert.equal((await s.reconcile(caller, outcome(r, state === 'failed' ? 'executed' : 'failed'), at)).reason_code, 'OUTCOME_CONFLICT');
    assert.equal((await s.reserve(caller, req(0, { receiver: 'synthetic_other' }), at)).reason_code, 'IDEMPOTENCY_CONFLICT');
    assert.ok(Object.isFrozen(r.binding.request));
    assert.equal(r.binding.request.receiver, 'synthetic_receiver');
  }
});

test('exact amount limit, scopes, context and unsupported reversal', async () => {
  const variants = [ [caller, req()], [{ ...caller, client_id: 'synthetic_other' }, req()],
    [{ ...caller, workspace_id: 'synthetic_other' }, req()], [caller, req(1, { currency: 'EUR' })],
    [caller, req(2, { sender: 'synthetic_other' })], [caller, req(0, { namespace: 'synthetic_other' })] ];
  const s = new PretransferReservationRegistry(variants.map(([c, r]) => policy(c, r)));
  const results = await Promise.all(variants.map(([c, r]) => s.reserve(c, r, now)));
  assert.ok(results.every(r => r.status === 'reserved'));
  assert.equal(new Set(results.map(r => r.reference)).size, variants.length);
  for (const [c, r] of variants) assert.equal(s.usage(c, r).pending_count, 1);
  for (const changed of [{ currency: 'EUR' }, { sender: 'synthetic_other' }]) {
    assert.equal((await s.reserve(caller, req(0, changed), now)).reason_code, 'IDEMPOTENCY_CONFLICT');
    for (const [c, r] of variants) assert.equal(s.usage(c, r).pending_count, 1);
  }
  assert.equal((await s.reconcile(variants[1][0], outcome(results[0], 'executed'), now)).reason_code, 'REFERENCE_UNAVAILABLE');
  assert.equal((await s.reconcile(caller, outcome(results[0], 'reversed'), now)).reason_code, 'UNSUPPORTED_STATE');
  assert.equal((await fresh().reserve(caller, req(1, { amount: '9007199254740993.02' }), now)).reason_code, 'CAPACITY_EXCEEDED');
  for (const capacities of [null, [], [policy(), policy()], [policy(caller, req(), { max_in_flight_count: 201 })]]) {
    assert.equal((await new PretransferReservationRegistry(capacities).reserve(caller, req(), now)).reason_code, 'CONTEXT_MISSING');
  }
  assert.equal((await fresh().reserve(null, req(), now)).reason_code, 'CONTEXT_MISSING');
  assert.equal((await fresh().reserve(caller, req(0, { amount: '0.00' }), now)).reason_code, 'UNSUPPORTED_STATE');
});

test('expiry equality releases capacity; early expiry and backwards clocks fail closed', async () => {
  const s = fresh(), r = await s.reserve(caller, req(), now);
  assert.equal((await s.reconcile(caller, outcome(r, 'expired'), now)).reason_code, 'UNSUPPORTED_STATE');
  const later = req(1, { expires_at: '2026-10-25T02:00:00.000Z' });
  assert.equal((await s.reserve(caller, later, expiry)).status, 'reserved');
  assert.equal((await s.reconcile(caller, outcome(r, 'executed'), expiry)).reason_code, 'OUTCOME_CONFLICT');
  assert.equal((await s.reserve(caller, later, now)).reason_code, 'CONTEXT_MISSING');
});

test('queue releases after thrown errors and cancellation; queue and state bounds hold', async () => {
  const q = new SyntheticReservationQueue(), abort = new AbortController();
  let calls = 0;
  const bad = q.run(() => { throw new Error('synthetic failure'); });
  const cancelled = q.run(() => { calls++; }, abort.signal);
  abort.abort();
  const good = q.run(() => ++calls);
  const all = await Promise.allSettled([bad, cancelled, good]);
  assert.deepEqual(all.map(r => r.status), ['rejected', 'rejected', 'fulfilled']);
  assert.equal(calls, 1);
  const queued = Array.from({ length: 201 }, () => q.run(() => 1));
  assert.equal((await Promise.allSettled(queued)).filter(r => r.status === 'rejected').length, 1);
  const s = new PretransferReservationRegistry([policy(caller, req(), { max_in_flight_count: 200, max_in_flight_amount: '9999999999999999999999.99' })]);
  for (let i = 0; i < 200; i++) {
    const r = await s.reserve(caller, req(i), now);
    assert.equal(r.status, 'reserved');
    await s.reconcile(caller, outcome(r, 'failed'), now);
  }
  assert.equal((await s.reserve(caller, req(200), now)).reason_code, 'RESOURCE_LIMIT');
  assert.equal(s.size, 200);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await fresh().reserve(caller, req(), now, aborted.signal)).status, 'rejected');
});

test('independent token model matches all reordered retry/callback interleavings', async () => {
  function permutations(xs) {
    return xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map(t => [x, ...t])) : [[]];
  }
  for (const order of permutations(['retry', 'execute', 'duplicate', 'cancel', 'competitor'])) {
    const s = fresh(), original = await s.reserve(caller, req(), now);
    // Independent model uses occupied tokens and a write-once terminal label.
    let terminal = null, competitor = false;
    const expected = [];
    for (const op of order) {
      if (op === 'retry') expected.push('reserved');
      else if (op === 'competitor') {
        expected.push(terminal === null ? 'rejected' : 'reserved');
        competitor = terminal !== null;
      } else {
        const wanted = op === 'cancel' ? 'cancelled' : 'executed';
        if (terminal === null) terminal = wanted;
        expected.push(terminal === wanted ? terminal : 'rejected');
      }
    }
    const results = await Promise.all(order.map(op => op === 'retry' ? s.reserve(caller, req(), now)
      : op === 'competitor' ? s.reserve(caller, req(1), now)
        : s.reconcile(caller, outcome(original, op === 'cancel' ? 'cancelled' : 'executed'), now)));
    assert.deepEqual(results.map(r => r.status), expected, order.join(','));
    assert.equal(s.usage(caller, req()).pending_count, competitor ? 1 : 0);
    assert.equal(s.usage(caller, req()).executed_count, terminal === 'executed' ? 1 : 0);
  }
});
