import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import net from 'node:net';
import mariadb from 'mariadb';
import { CODEBOOK_VERSION, NORMALIZER_VERSION, normalizeSynthetic } from '../dist/normalization.js';

const corpus = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/synthetic-lifecycle.json', import.meta.url), 'utf8'));
const base = () => ({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', codebook_version: CODEBOOK_VERSION,
  source_reference: { namespace: 'synthetic_normalization', record_ref: '00000001' }, observed_at: '2026-01-02T03:04:05.006Z',
  operation_code: 'SYNTH_PAYMENT', status_code: 'SYNTH_SUCCEEDED', reversal_code: 'SYNTH_REVERSAL_NONE',
  amount: '42.50', currency: 'SYNTH_CCY_A', source_time: '2026-01-01 03:04:05', synthetic_payment_ref: 'synthetic_payment_001' });
const event = (amount = '10.00', event_ref = 'synthetic_reversal_001') => ({ event_ref, amount, currency: 'SYNTH_CCY_A', completed: true });
const reversal = (full = false) => ({ ...base(), reversal_code: full ? 'SYNTH_REVERSAL_FULL_COMPLETED' : 'SYNTH_REVERSAL_PARTIAL_COMPLETED',
  reversal_evidence: { original_payment_ref: 'synthetic_payment_001', events: [event(full ? '42.50' : '10.00')] } });
const expect = (input, state, reason) => {
  const outcome = normalizeSynthetic(input);
  assert.equal(outcome.state, state);
  assert.ok(outcome.reason_codes.includes(reason), JSON.stringify(outcome.reason_codes));
  assert.equal(outcome.canonical_emission, false);
  if (state !== 'known') assert.equal(outcome.candidate, null);
  return outcome;
};

for (const fixture of corpus.cases) {
  test(`synthetic normalization: ${fixture.id}`, () => {
    const input = { ...(fixture.reversal === 'partial_completed' ? reversal() : fixture.reversal === 'full_completed' ? reversal(true) : base()),
      operation_code: fixture.operation_code, status_code: fixture.status_code, reversal_code: fixture.reversal_code };
    const outcome = normalizeSynthetic(input);
    assert.equal(outcome.state, fixture.base_status === 'unknown' ? 'unknown' : 'known');
    assert.equal(outcome.record_kind, fixture.kind);
    assert.equal(outcome.candidate?.transaction_status ?? null, fixture.base_status === 'unknown' ? null : fixture.candidate_status);
    assert.equal(outcome.codebook_version, corpus.codebook_version);
    assert.equal(outcome.normalizer_version, NORMALIZER_VERSION);
    assert.equal(outcome.canonical_emission, false);
    assert.deepEqual(outcome.raw, input);
    if (outcome.candidate) assert.equal(outcome.candidate.account_identity, 'unresolved');
  });
}

test('successful lookup needs no payment amount/currency and never emits a payment candidate', () => {
  const input = { ...base(), operation_code: 'SYNTH_LOOKUP' };
  delete input.amount; delete input.currency; delete input.synthetic_payment_ref;
  const outcome = expect(input, 'known', 'NON_PAYMENT_LOOKUP');
  assert.equal(outcome.candidate, null);
  assert.equal(outcome.record_kind, 'lookup');
});

test('missing/null/blank/unrecognized and prototype-like codes stay unknown without trim/case/coercion', () => {
  for (const field of ['operation_code', 'status_code', 'reversal_code']) {
    const reason = { operation_code: 'UNKNOWN_OPERATION_CODE', status_code: 'UNKNOWN_STATUS_CODE', reversal_code: 'UNKNOWN_REVERSAL_CODE' }[field];
    const absent = base(); delete absent[field]; expect(absent, 'unknown', reason);
    for (const value of [null, ...corpus.unrecognized_codes]) {
      const outcome = expect({ ...base(), [field]: value }, 'unknown', reason);
      assert.equal(outcome.raw[field], value);
    }
    for (const value of [...corpus.invalid_code_values, 'X'.repeat(201)]) expect({ ...base(), [field]: value }, 'invalid', 'INVALID_CODE_TYPE');
  }
});

test('bad envelopes/context/references cannot echo arbitrary account fields or exceptions', () => {
  for (const input of [null, [], 1, 'SYNTHETIC_PRIVATE_VALUE', { ...base(), fromaccount: 'SYNTHETIC_PRIVATE_VALUE' }]) {
    const outcome = expect(input, 'invalid', 'INVALID_INPUT');
    assert.equal(outcome.raw, null);
    assert.ok(!JSON.stringify(outcome).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
  for (const change of [{ format: 2 }, { provenance: 'real' }, { execution_mode: 'live' }, { codebook_version: 'unknown' }]) {
    assert.equal(expect({ ...base(), ...change }, 'invalid', 'INVALID_CONTEXT').raw, null);
  }
  for (const source_reference of [null, {}, { namespace: 'actual', record_ref: '1' }, { namespace: 'synthetic_test', record_ref: 1 }, { ...base().source_reference, account: 'SYNTHETIC_PRIVATE_VALUE' }]) {
    expect({ ...base(), source_reference }, 'invalid', 'INVALID_SOURCE_REFERENCE');
  }
  const cyclic = base(); cyclic.extra = cyclic;
  expect(cyclic, 'invalid', 'INVALID_INPUT');
  expect({ ...base(), source_time: () => {} }, 'invalid', 'INVALID_INPUT');
});

test('production/nonlocal/live process contexts fail before consuming input', () => {
  for (const [name, value] of [['NODE_ENV', 'production'], ['LMPS_ENVIRONMENT', 'staging'], ['LMPS_EXECUTION_MODE', 'live']]) {
    const previous = process.env[name];
    try {
      process.env[name] = value;
      assert.equal(expect(base(), 'invalid', 'INVALID_CONTEXT').raw, null);
    } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
  }
});

test('exact fixed-two-decimal money preserves maximum precision and never rounds, abs or coerces', () => {
  const maximum = '9999999999999999999999.99';
  assert.equal(normalizeSynthetic({ ...base(), amount: maximum }).candidate.amount, maximum);
  assert.equal(normalizeSynthetic({ ...base(), amount: '0.00' }).candidate.amount, '0.00');
  for (const amount of ['-1.00', '-0.00', '01.00', '1.001', '1', '1.0', '1e2', ' 1.00', '10000000000000000000000.00', '']) expect({ ...base(), amount }, 'invalid', 'INVALID_AMOUNT');
  for (const change of [{ amount: 42.5 }, { currency: 1 }, { source_time: {} }]) expect({ ...base(), ...change }, 'invalid', 'INVALID_FIELD_TYPE');
  for (const value of [null, undefined]) {
    expect({ ...base(), amount: value }, 'unknown', 'MISSING_AMOUNT');
    expect({ ...base(), currency: value }, 'unknown', 'MISSING_CURRENCY');
  }
  expect({ ...base(), currency: '' }, 'unknown', 'MISSING_CURRENCY');
  expect({ ...base(), currency: ' SYNTH_CCY_A' }, 'invalid', 'INVALID_CURRENCY');
  assert.equal(normalizeSynthetic({ ...base(), currency: '0001' }).candidate.raw_currency, '0001');
});

test('calendar validation preserves naive time/leading-zero reference and never invents UTC occurrence time', () => {
  const input = { ...base(), source_time: '2024-02-29 23:59:59' };
  const outcome = normalizeSynthetic(input);
  assert.deepEqual(outcome.source_reference, input.source_reference);
  assert.equal(outcome.time.source_time, input.source_time);
  assert.equal(outcome.time.observed_at, input.observed_at);
  assert.equal(outcome.time.source_timezone, 'unverified');
  assert.equal(outcome.time.occurred_at, null);
  assert.equal(outcome.time.quality, 'naive_unverified');
  const absent = base(); delete absent.source_time;
  assert.equal(normalizeSynthetic(absent).time.quality, 'missing');
  for (const source_time of ['2026-02-29 00:00:00', '2026-01-01 24:00:00', '2026-01-01T00:00:00', '', '2026-01-01 00:00:60']) expect({ ...base(), source_time }, 'invalid', 'INVALID_SOURCE_TIME');
  for (const observed_at of [null, '2026-02-30T00:00:00.000Z', '2026-01-01T00:00:00Z', '2026-01-01 00:00:00', '2026-01-01T00:00:00.000+07:00']) expect({ ...base(), observed_at }, 'invalid', 'INVALID_OBSERVED_AT');
});

test('known contradictions are rejected and flags/references cannot manufacture completion evidence', () => {
  for (const reversal_code of ['SYNTH_REVERSAL_REQUESTED', 'SYNTH_REVERSAL_FAILED', 'SYNTH_REVERSAL_FULL_COMPLETED']) {
    expect({ ...base(), operation_code: 'SYNTH_LOOKUP', reversal_code }, 'invalid', 'LOOKUP_REVERSAL_CONFLICT');
    expect({ ...base(), operation_code: 'SYNTH_LOOKUP', status_code: null, reversal_code }, 'invalid', 'LOOKUP_REVERSAL_CONFLICT');
    for (const status_code of ['SYNTH_PENDING', 'SYNTH_FAILED']) expect({ ...base(), status_code, reversal_code }, 'invalid', 'REVERSAL_REQUIRES_SUCCEEDED_ORIGINAL');
  }
  for (const field of ['originalreference', 'shouldrevert', 'isreconciled', 'issettled']) expect({ ...reversal(), reversal_evidence: null, [field]: '1' }, 'invalid', 'INVALID_INPUT');
  expect({ ...base(), reversal_evidence: reversal().reversal_evidence }, 'invalid', 'UNEXPECTED_REVERSAL_EVIDENCE');
  for (const reversal_code of ['SYNTH_REVERSAL_REQUESTED', 'SYNTH_REVERSAL_FAILED']) {
    const outcome = normalizeSynthetic({ ...base(), reversal_code });
    assert.equal(outcome.candidate.transaction_status, 'succeeded');
    assert.equal(outcome.candidate.cumulative_reversed_amount, null);
    expect({ ...base(), reversal_code, synthetic_payment_ref: null }, 'unknown', 'MISSING_ORIGINAL_PAYMENT_LINK');
  }
});

test('completed code alone never passes missing original link, evidence, confirmation or currency/link mismatch', () => {
  expect({ ...reversal(), synthetic_payment_ref: null }, 'unknown', 'MISSING_ORIGINAL_PAYMENT_LINK');
  expect({ ...reversal(), reversal_evidence: null }, 'unknown', 'MISSING_REVERSAL_EVIDENCE');
  expect({ ...reversal(), reversal_evidence: { ...reversal().reversal_evidence, events: [] } }, 'unknown', 'MISSING_REVERSAL_EVIDENCE');
  expect({ ...reversal(), reversal_evidence: { original_payment_ref: 'synthetic_other', events: [event()] } }, 'invalid', 'REVERSAL_ORIGINAL_MISMATCH');
  expect({ ...reversal(), reversal_evidence: { original_payment_ref: 'synthetic_payment_001', events: [{ ...event(), currency: 'SYNTH_CCY_B' }] } }, 'invalid', 'REVERSAL_CURRENCY_MISMATCH');
  for (const completed of [false, null]) expect({ ...reversal(), reversal_evidence: { original_payment_ref: 'synthetic_payment_001', events: [{ ...event(), completed }] } }, 'unknown', 'REVERSAL_NOT_CONFIRMED');
});

for (const fixture of corpus.completion_boundaries) {
  test(`normalizer reversal amount: ${fixture.id}`, () => {
    const input = { ...reversal(fixture.meaning === 'full_completed'), amount: fixture.original,
      reversal_evidence: { original_payment_ref: 'synthetic_payment_001', events: [event(fixture.cumulative_reversed)] } };
    const outcome = normalizeSynthetic(input);
    assert.equal(outcome.state, fixture.amount_condition_met ? 'known' : 'invalid');
    assert.equal(outcome.candidate?.cumulative_reversed_amount ?? null, fixture.amount_condition_met ? fixture.cumulative_reversed : null);
  });
}

test('event-local deduplication sums exact unique completed amounts, retains raw duplicates and rejects changed reuse', () => {
  const input = reversal(true);
  input.reversal_evidence.events = [event('10.00'), event('32.50', 'synthetic_reversal_002'), event('10.00')];
  const outcome = normalizeSynthetic(input);
  assert.equal(outcome.state, 'known');
  assert.equal(outcome.candidate.transaction_status, 'reversed');
  assert.equal(outcome.candidate.cumulative_reversed_amount, '42.50');
  assert.equal(outcome.raw.reversal_evidence.events.length, 3);
  for (const change of [{ amount: '10.01' }, { currency: 'SYNTH_CCY_B' }, { completed: false }]) {
    const changed = structuredClone(input); Object.assign(changed.reversal_evidence.events[2], change);
    expect(changed, 'invalid', 'REVERSAL_EVENT_CONFLICT');
  }
  const reordered = structuredClone(input); reordered.reversal_evidence.events.reverse();
  assert.deepEqual(normalizeSynthetic(reordered).candidate, outcome.candidate);
});

test('evidence shape/type/size and nonpositive event amounts fail closed without partial candidates', () => {
  for (const evidence of [{}, { original_payment_ref: 'synthetic_payment_001', events: {} }, { original_payment_ref: 'synthetic_payment_001', events: Array(101).fill(event()) },
    { original_payment_ref: 'synthetic_payment_001', events: [{ ...event(), completed: 'true' }] }, { original_payment_ref: 'synthetic_payment_001', events: [{ ...event(), fromaccount: 'SYNTHETIC_PRIVATE_VALUE' }] }]) {
    const outcome = expect({ ...reversal(), reversal_evidence: evidence }, 'invalid', 'INVALID_REVERSAL_EVIDENCE');
    assert.equal(outcome.raw, null);
    assert.ok(!JSON.stringify(outcome).includes('SYNTHETIC_PRIVATE_VALUE'));
  }
  for (const amount of ['0.00', '-0.01', '1.001', '1e2']) expect({ ...reversal(), reversal_evidence: { original_payment_ref: 'synthetic_payment_001', events: [event(amount)] } }, 'invalid', 'INVALID_REVERSAL_AMOUNT');
  const large = reversal(); large.currency = 'X'.repeat(200);
  large.reversal_evidence.events = Array.from({ length: 100 }, (_, i) => ({ ...event('0.01', `synthetic_${String(i).padStart(60, '0')}`), currency: large.currency }));
  expect(large, 'invalid', 'INPUT_TOO_LARGE');
});

test('normalization is replayable, detached from frozen input and performs no source or network calls', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const input = freeze(reversal()); const before = structuredClone(input);
  const maria = mock.method(mariadb, 'createConnection', () => { throw new Error('Unexpected source connection'); });
  const socket = mock.method(net.Socket.prototype, 'connect', () => { throw new Error('Unexpected network connection'); });
  try {
    const outcome = normalizeSynthetic(input);
    assert.equal(outcome.state, 'known');
    assert.deepEqual(normalizeSynthetic(input), outcome);
    assert.deepEqual(input, before);
    outcome.raw.reversal_evidence.events[0].amount = '1.00';
    outcome.source_reference.record_ref = 'changed';
    assert.deepEqual(input, before);
    assert.equal(outcome.raw.source_reference.record_ref, '00000001');
    assert.equal(normalizeSynthetic(input).candidate.cumulative_reversed_amount, '10.00');
    assert.equal(maria.mock.callCount(), 0);
    assert.equal(socket.mock.callCount(), 0);
  } finally { maria.mock.restore(); socket.mock.restore(); }
});
