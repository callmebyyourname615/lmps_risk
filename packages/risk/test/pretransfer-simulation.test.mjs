import test from 'node:test';
import assert from 'node:assert/strict';
import { PretransferSimulationRegistry } from '../dist/index.js';
import { SIMULATION_BOUNDARY as boundary, isSimulationResult } from '@lmps/contracts/pretransfer-simulation';

const now = '2026-10-25T00:00:00.000Z', expiry = '2026-10-25T01:00:00.000Z';
const caller = { ...boundary, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' };
const request = { ...boundary, namespace: 'synthetic_test', payment_id: 'synthetic_payment',
  attempt_id: 'synthetic_attempt', idempotency_key: 'synthetic_key', sender: 'synthetic_sender',
  receiver: 'synthetic_receiver', amount: '9007199254740993.01', currency: 'USD',
  product: 'synthetic_product', expires_at: expiry };
const binding = (c = caller, r = request) => ({ ...boundary, caller: c, request: r });
function denied(value) {
  assert.ok(isSimulationResult(value));
  assert.equal(value.reason_code, 'REFERENCE_UNAVAILABLE');
  assert.equal(value.reference, null);
  assert.equal(value.binding, null);
}

test('deterministic deeply frozen retries preserve exact money and input isolation', () => {
  const registry = new PretransferSimulationRegistry();
  const r = structuredClone(request), c = structuredClone(caller);
  const receipt = registry.register(c, r, now);
  assert.ok(isSimulationResult(receipt));
  assert.equal(receipt.reason_code, 'REFERENCE_VALID');
  assert.equal(receipt.status, 'unavailable');
  for (const value of [receipt, receipt.binding, receipt.binding.caller, receipt.binding.request]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { receipt.binding.request.amount = '1.00'; }, TypeError);
  r.amount = '2.00'; c.client_id = 'synthetic_changed';
  assert.equal(receipt.binding.request.amount, request.amount);
  assert.equal(registry.register(caller, Object.fromEntries(Object.entries(request).reverse()), now), receipt);
  assert.equal(registry.size, 1);
  assert.deepEqual(new PretransferSimulationRegistry().register(caller, request, now), receipt);
});

test('all request fields bind references; same scoped key conflicts without partial mutation', () => {
  const registry = new PretransferSimulationRegistry();
  const original = registry.register(caller, request, now);
  for (const [field, value] of Object.entries({ payment_id: 'synthetic_other', attempt_id: 'synthetic_other',
    sender: 'synthetic_other', receiver: 'synthetic_other', amount: '9007199254740993.02', currency: 'EUR',
    product: 'synthetic_other', expires_at: '2026-10-25T02:00:00.000Z' })) {
    const changed = { ...request, [field]: value };
    assert.equal(registry.register(caller, changed, now).reason_code, 'IDEMPOTENCY_CONFLICT', field);
    assert.equal(registry.size, 1);
    denied(registry.lookup(caller, original.reference, binding(caller, changed), now));
    assert.notEqual(new PretransferSimulationRegistry().register(caller, changed, now).reference, original.reference);
  }
  assert.equal(registry.register(caller, request, now), original);
});

test('caller/workspace/namespace/key isolate state and cross-scope lookups disclose nothing', () => {
  const registry = new PretransferSimulationRegistry();
  const original = registry.register(caller, request, now);
  for (const field of ['client_id', 'workspace_id']) {
    const other = { ...caller, [field]: 'synthetic_other' };
    denied(registry.lookup(other, original.reference, binding(), now));
    denied(registry.lookup(other, original.reference, binding(other), now));
    assert.notEqual(registry.register(other, request, now).reference, original.reference);
  }
  for (const field of ['namespace', 'idempotency_key']) {
    const other = { ...request, [field]: 'synthetic_other' };
    denied(registry.lookup(caller, original.reference, binding(caller, other), now));
    assert.notEqual(registry.register(caller, other, now).reference, original.reference);
  }
  assert.equal(registry.size, 5);
  denied(registry.lookup(caller, `synthetic_${'0'.repeat(64)}`, binding(), now));
});

test('supplied clock enforces expiry equality; retry cannot renew the original expiry', () => {
  const registry = new PretransferSimulationRegistry();
  const original = registry.register(caller, request, now);
  assert.equal(registry.lookup(caller, original.reference, binding(), '2026-10-25T00:59:59.999Z'), original);
  denied(registry.lookup(caller, original.reference, binding(), expiry));
  assert.equal(registry.register(caller, request, expiry), original);
  denied(registry.lookup(caller, original.reference, binding(), expiry));
  assert.equal(registry.register(caller, { ...request, expires_at: '2026-10-25T02:00:00.000Z' }, expiry).reason_code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(registry.register(caller, request, now).reason_code, 'CONTEXT_MISSING');
  const empty = new PretransferSimulationRegistry();
  assert.equal(empty.register(caller, request, expiry).reason_code, 'EXPIRED');
  assert.equal(empty.size, 0);
});

test('missing, unknown and unsupported context fails closed without state', () => {
  const registry = new PretransferSimulationRegistry();
  for (const value of [null, undefined, {}, { ...caller, extra: true }, { ...caller, enforcement: true }]) {
    assert.equal(registry.register(value, request, now).reason_code, 'CONTEXT_MISSING');
  }
  for (const value of [null, {}, { ...request, caller }, { ...request, amount: 1 },
    { ...request, amount: '01.00' }, { ...request, sender: 'real_party' },
    { ...request, expires_at: '2026-02-30T00:00:00.000Z' }, { ...request, production_ready: true }]) {
    assert.equal(registry.register(caller, value, now).reason_code, 'CONTEXT_MISSING');
  }
  for (const clock of [undefined, 'invalid', 123]) assert.equal(registry.register(caller, request, clock).reason_code, 'CONTEXT_MISSING');
  assert.equal(registry.register(caller, { ...request, amount: '0.00' }, now).reason_code, 'UNSUPPORTED_STATE');
  denied(registry.lookup(null, 'secret', null, now));
  assert.equal(registry.size, 0);
});

test('bounded state still permits existing retries at capacity', () => {
  const registry = new PretransferSimulationRegistry();
  const original = registry.register(caller, request, now);
  for (let i = 1; i < 200; i++) assert.equal(registry.register(caller,
    { ...request, idempotency_key: `synthetic_key_${i}` }, now).reason_code, 'REFERENCE_VALID');
  assert.equal(registry.register(caller, { ...request, idempotency_key: 'synthetic_overflow' }, now).reason_code, 'RESOURCE_LIMIT');
  assert.equal(registry.register(caller, request, now), original);
  assert.equal(registry.size, 200);
});
