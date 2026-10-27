import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIMULATION_BOUNDARY as boundary, PRETRANSFER_SIMULATION_VERSION as version,
  isSimulationCaller, isSimulationRequest, isSimulationRequestAt, isSimulationBinding,
  isSimulationOutcome, isSimulationCapacity, isSimulationResult, isSimulationScenario, parseSimulationScenario,
  SimulationContractError, MAX_SIMULATION_INPUT_BYTES,
} from '../dist/pretransfer-simulation.js';

const now = '2026-10-25T00:00:00.000Z';
const expiry = '2026-10-25T00:01:00.000Z';
const caller = { ...boundary, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' };
const request = { ...boundary, namespace: 'synthetic_test', payment_id: 'synthetic_payment',
  attempt_id: 'synthetic_attempt', idempotency_key: 'synthetic_key', sender: 'synthetic_sender',
  receiver: 'synthetic_receiver', amount: '9007199254740993.01', currency: 'LAK',
  product: 'synthetic_transfer', expires_at: expiry };
const binding = { ...boundary, caller, request };
const scenario = () => ({ ...boundary, contract_version: version, scenario_id: 'synthetic_scenario',
  run_id: 'synthetic_run', now, capacities: [{ ...boundary, caller, namespace: request.namespace,
    sender: request.sender, currency: 'LAK', max_in_flight_count: 1, max_in_flight_amount: '9999999999999999999999.99' }],
  commands: [{ kind: 'request', request: { ...request } }] });

test('typed envelopes preserve all explicit synthetic boundaries and separate caller', () => {
  for (const [check, value] of [[isSimulationCaller, caller], [isSimulationRequest, request],
    [isSimulationBinding, binding], [isSimulationOutcome, { ...boundary, reference: 'synthetic_ref', outcome: 'executed' }],
    [isSimulationResult, { ...boundary, contract_version: version, status: 'reserved', reason_code: 'RESERVED',
      reference: 'synthetic_ref', binding }], [isSimulationScenario, scenario()]]) {
    assert.equal(check(value), true);
    for (const key of Object.keys(boundary)) {
      const missing = { ...value }; delete missing[key];
      assert.equal(check(missing), false, key);
      assert.equal(check({ ...value, [key]: key === 'enforcement' || key === 'production_ready' ? true : null }), false);
    }
    assert.equal(check({ ...value, extra: true }), false);
  }
  assert.equal(isSimulationRequest({ ...request, caller }), false);
  assert.equal(isSimulationRequest({ ...request, workspace_id: caller.workspace_id }), false);
  assert.equal(isSimulationCaller({ ...caller, client_id: 'real_client' }), false);
  assert.equal(isSimulationOutcome({ ...boundary, reference: 'synthetic_ref', outcome: 'reversed' }), false);
  assert.equal(isSimulationResult({ ...boundary, contract_version: version, status: 'allow', reason_code: 'RESERVED',
    reference: null, binding: null }), false);
});

test('strict IDs, decimals and booleans reject unknown and coerced fields', () => {
  for (const key of ['namespace', 'payment_id', 'attempt_id', 'idempotency_key', 'sender', 'receiver', 'product']) {
    for (const value of ['real_account', '', 123, 'synthetic_x\n']) assert.equal(isSimulationRequest({ ...request, [key]: value }), false);
  }
  for (const value of [1, null, '01.00', '1', '1.0', '1.000', '-1.00', '+1.00', '1e2', ' 1.00', '1.00\n',
    '10000000000000000000000.00']) assert.equal(isSimulationRequest({ ...request, amount: value }), false);
  assert.equal(isSimulationRequest({ ...request, enforcement: 'false' }), false);
  assert.equal(isSimulationRequest({ ...request, currency: 'lak' }), false);
  const s = scenario(); s.capacities[0].max_in_flight_count = '1';
  assert.equal(isSimulationScenario(s), false);
});

test('money round trips exactly above safe integer through maximum existing decimal bound', () => {
  for (const amount of ['0.00', '0.01', '9007199254740993.01', '9999999999999999999999.99']) {
    const s = scenario(); s.commands[0].request.amount = amount;
    const result = parseSimulationScenario(JSON.stringify(s));
    assert.equal(result.commands[0].request.amount, amount);
    const units = BigInt(amount.replace('.', ''));
    assert.equal(`${units / 100n}.${(units % 100n).toString().padStart(2, '0')}`, amount);
  }
});

test('dates and explicit expiry use supplied clock and reject equality and backward movement', () => {
  assert.equal(isSimulationRequestAt(request, now), true);
  assert.equal(isSimulationRequestAt(request, expiry), false);
  assert.equal(isSimulationRequestAt(request, '2026-10-25T00:02:00.000Z'), false);
  for (const expires_at of ['2026-02-30T00:00:00.000Z', '2026-13-01T00:00:00.000Z',
    '2026-10-25', '2026-10-25T00:00:00+07:00', '2026-10-25T23:59:60.000Z',
    '2026-10-25T24:00:00.000Z', 'invalid']) {
    assert.equal(isSimulationRequest({ ...request, expires_at }), false);
  }
  const s = scenario(); s.commands.unshift({ kind: 'advance_clock', now: expiry });
  assert.equal(isSimulationScenario(s), false);
  s.commands = [{ kind: 'advance_clock', now }]; assert.equal(isSimulationScenario(s), false);
  s.commands = [{ kind: 'advance_clock', now: expiry }]; assert.equal(isSimulationScenario(s), true);
});

test('original UTF-8 input is capped at 64 KiB and commands at 200', () => {
  const s = scenario(); s.commands = Array.from({ length: 200 }, () => ({ kind: 'outcome',
    outcome: { ...boundary, reference: 'synthetic_ref', outcome: 'failed' } }));
  assert.equal(isSimulationScenario(s), true);
  s.commands.push(s.commands[0]); assert.equal(isSimulationScenario(s), false);
  const json = JSON.stringify(scenario());
  assert.doesNotThrow(() => parseSimulationScenario(json.padEnd(MAX_SIMULATION_INPUT_BYTES, ' ')));
  assert.throws(() => parseSimulationScenario(json.padEnd(MAX_SIMULATION_INPUT_BYTES + 1, ' ')), SimulationContractError);
  assert.throws(() => parseSimulationScenario(json + ' '.repeat(65536)), /SIMULATION_INVALID_INPUT/);
  assert.throws(() => parseSimulationScenario('{"private":"withheld"'), error => !error.message.includes('withheld"'));
  assert.equal(isSimulationScenario({ ...scenario(), commands: Array(200).fill({ kind: 'request',
    request: { ...request, payment_id: 'synthetic_' + 'a'.repeat(70), receiver: 'synthetic_' + 'a'.repeat(70) } }) }), false);
});

test('validation is repeatable, does not mutate inputs or admit source/score/identity fields', () => {
  const s = scenario(); const before = JSON.stringify(s);
  for (let i = 0; i < 3; i++) assert.equal(isSimulationScenario(s), true);
  assert.equal(JSON.stringify(s), before);
  for (const key of ['source_export', 'risk_score', 'identity_link', 'production_authorization']) {
    assert.equal(isSimulationScenario({ ...s, [key]: true }), false);
  }
  assert.equal(isSimulationScenario({ source_kind: 'user_supplied_file', rows: [] }), false);
});

test('capacity fixtures are explicit, bounded and strict at nested boundaries', () => {
  const capacity = scenario().capacities[0];
  assert.equal(isSimulationCapacity(capacity), true);
  for (const max_in_flight_count of [-1, 201, 1.5, '1', null]) {
    assert.equal(isSimulationCapacity({ ...capacity, max_in_flight_count }), false);
  }
  assert.equal(isSimulationCapacity({ ...capacity, max_in_flight_count: 0 }), true);
  const missing = { ...capacity }; delete missing.max_in_flight_amount;
  assert.equal(isSimulationCapacity(missing), false);
  assert.equal(isSimulationCapacity({ ...capacity, caller: { ...caller, authority: true } }), false);
  assert.equal(isSimulationBinding({ ...binding, request: { ...request, client_id: 'synthetic_other' } }), false);
  const s = scenario(); s.capacities = Array(201).fill(capacity);
  assert.equal(isSimulationScenario(s), false);
});

test('byte limit measures UTF-8 rather than character count and errors withhold input', () => {
  const json = JSON.stringify(scenario());
  const oversized = json + ' '.repeat(MAX_SIMULATION_INPUT_BYTES - Buffer.byteLength(json) - 1) + 'é';
  assert.equal(oversized.length, MAX_SIMULATION_INPUT_BYTES);
  assert.throws(() => parseSimulationScenario(oversized), SimulationContractError);
  for (const value of [null, [], 1, 'scenario', undefined]) {
    assert.equal(isSimulationScenario(value), false);
    assert.equal(isSimulationRequest(value), false);
  }
});
