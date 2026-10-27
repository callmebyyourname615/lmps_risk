import test from 'node:test';
import assert from 'node:assert/strict';
import { SIMULATION_BOUNDARY as b, PRETRANSFER_SIMULATION_VERSION as version, isSimulationScenario } from '@lmps/contracts/pretransfer-simulation';
import { PretransferReservationRegistry, PretransferSimulationRegistry, riskHash } from '@lmps/risk';
import { simulatePretransfer } from '../dist/pretransfer-simulator.js';

const caller = { ...b, workspace_id: 'synthetic_acceptance', client_id: 'synthetic_client' };
const now = '2026-10-25T00:00:00.000Z', expiry = '2026-10-25T01:00:00.000Z';
const request = { ...b, namespace: 'synthetic_acceptance', payment_id: 'synthetic_payment', attempt_id: 'synthetic_attempt',
  idempotency_key: 'synthetic_key', sender: 'synthetic_sender', receiver: 'synthetic_receiver', amount: '9007199254740993.01',
  currency: 'USD', product: 'synthetic_product', expires_at: expiry };
const capacity = { ...b, caller, namespace: request.namespace, sender: request.sender, currency: request.currency,
  max_in_flight_count: 1, max_in_flight_amount: request.amount };
const binding = { ...b, caller, request };
const reference = `synthetic_${riskHash({ contract_version: version, binding })}`;
const outcome = state => ({ ...b, reference, outcome: state });

test('acceptance: concurrent binding/retry, denied scopes and expiry equality preserve exact accounting', async () => {
  const ledger = new PretransferReservationRegistry([capacity]);
  const registry = new PretransferSimulationRegistry();
  const receipts = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(caller, request, now)));
  assert.ok(receipts.every(r => r === receipts[0]));
  assert.equal(receipts[0].reference, reference);
  registry.register(caller, request, now);
  for (const change of [{ amount: '9007199254740993.02' }, { receiver: 'synthetic_changed' }]) {
    assert.equal((await ledger.reserve(caller, { ...request, ...change }, now)).reason_code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(registry.lookup(caller, reference, { ...binding, request: { ...request, ...change } }, now).reason_code, 'REFERENCE_UNAVAILABLE');
  }
  for (const foreign of [{ ...caller, client_id: 'synthetic_other' }, { ...caller, workspace_id: 'synthetic_other' }]) {
    assert.equal(registry.lookup(foreign, reference, binding, now).reason_code, 'REFERENCE_UNAVAILABLE');
    assert.equal((await ledger.reconcile(foreign, outcome('executed'), now)).reason_code, 'REFERENCE_UNAVAILABLE');
  }
  assert.equal((await ledger.reserve(caller, { ...request, idempotency_key: 'synthetic_competitor' }, now)).reason_code, 'CAPACITY_EXCEEDED');
  assert.equal(ledger.usage(caller, request).pending_cents, 900719925474099301n);
  assert.equal(registry.lookup(caller, reference, binding, expiry).reason_code, 'REFERENCE_UNAVAILABLE');
  assert.equal((await ledger.reconcile(caller, outcome('executed'), expiry)).reason_code, 'OUTCOME_CONFLICT');
  for (let i = 0; i < 2; i++) assert.equal((await ledger.reconcile(caller, outcome('expired'), expiry)).status, 'expired');
  assert.equal(ledger.usage(caller, request).pending_cents, 0n);
  assert.equal(ledger.usage(caller, request).executed_count, 0);
  assert.equal(ledger.size, 1);
});

test('acceptance: out-of-order and conflicting callbacks produce reproducible count-only reports', async () => {
  const scenario = { ...b, contract_version: version, scenario_id: 'synthetic_acceptance', run_id: 'synthetic_run', now,
    capacities: [capacity], commands: [
      { kind: 'outcome', outcome: outcome('executed') },
      { kind: 'request', request }, { kind: 'request', request },
      { kind: 'request', request: { ...request, amount: '9007199254740993.02' } },
      { kind: 'request', request: { ...request, receiver: 'synthetic_changed' } },
      { kind: 'lookup', reference, binding },
      { kind: 'outcome', outcome: outcome('failed') },
      { kind: 'outcome', outcome: outcome('failed') },
      { kind: 'outcome', outcome: outcome('executed') },
      { kind: 'advance_clock', now: expiry },
      { kind: 'lookup', reference, binding },
    ] };
  assert.equal(isSimulationScenario(scenario), true);
  const report = await simulatePretransfer(scenario, caller, 'a'.repeat(64));
  assert.deepEqual(report, await simulatePretransfer(structuredClone(scenario), caller, 'a'.repeat(64)));
  assert.deepEqual(report.counts, { commands: 11, clock_advances: 1, unique_reservations: 1, pending: 0, executed: 0, released: 1 });
  assert.equal(report.reasons.REFERENCE_UNAVAILABLE, 2);
  assert.equal(report.reasons.IDEMPOTENCY_CONFLICT, 2);
  assert.equal(report.reasons.OUTCOME_CONFLICT, 1);
  for (const value of [request.sender, request.receiver, request.amount, reference, scenario.run_id]) assert.ok(!JSON.stringify(report).includes(value));
  for (const commands of [Array(201).fill(scenario.commands[1]), [{ kind: 'unsupported_command' }]]) {
    await assert.rejects(simulatePretransfer({ ...scenario, commands }, caller, 'a'.repeat(64)), /SIMULATION_INVALID_INPUT/);
  }
});
