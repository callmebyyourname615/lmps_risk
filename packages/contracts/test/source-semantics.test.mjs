import assert from 'node:assert/strict';
import { test } from 'node:test';
import { semanticSelectorKey, validateSourceSemantics } from '../dist/source-semantics.js';

const source = { result: null, txtype: '', totype: '0001', shouldrevert: null, isreconciled: '0', issettled: '0' };
const mapping = () => ({ format: 1, execution_mode: 'offline_analysis', version: 'lmps_semantics_synthetic_v1',
  source_manifest_sha256: 'a'.repeat(64), status: 'draft', evidence: null,
  lifecycle: [{ source: { ...source }, operation: 'unknown', state: 'unknown' }],
  currencies: [{ source_ccy: '001', currency: null, amount_unit: null, fee_unit: null }], time: null });
const reject = value => assert.throws(() => validateSourceSemantics(value), /^Error: SEMANTICS_INVALID_MAPPING; private diagnostics withheld\.$/);

test('draft preserves literal source codes, NULL/empty and detached values without promoting semantics', () => {
  const input = mapping(), result = validateSourceSemantics(input);
  assert.deepEqual(result, input);
  result.lifecycle[0].source.result = 'changed';
  assert.equal(input.lifecycle[0].source.result, null);
  assert.notEqual(semanticSelectorKey(source), semanticSelectorKey({ ...source, result: '' }));
  const unicode = mapping(); unicode.lifecycle[0].source.totype = 'ທົດລອງ';
  assert.equal(validateSourceSemantics(unicode).lifecycle[0].source.totype, 'ທົດລອງ');
});

test('owner declarations require an opaque source-owner evidence reference and digest', () => {
  const input = mapping(); input.status = 'owner_declared'; reject(input);
  input.evidence = { reference: 'synthetic-owner/review-1', sha256: 'b'.repeat(64), owner_role: 'lmps_source_owner' };
  assert.equal(validateSourceSemantics(input).status, 'owner_declared');
  for (const value of [null, {}, { ...input.evidence, owner_role: 'operator' }, { ...input.evidence, sha256: 'bad' }]) {
    reject({ ...input, evidence: value });
  }
  reject({ ...input, status: 'draft' });
});

test('ambiguous selectors, duplicate currencies and invented execution states are rejected', () => {
  const input = mapping(); input.lifecycle.push(structuredClone(input.lifecycle[0])); reject(input);
  const duplicateCurrency = mapping(); duplicateCurrency.currencies.push({ ...duplicateCurrency.currencies[0] }); reject(duplicateCurrency);
  const contradictory = mapping(); contradictory.lifecycle[0].state = 'succeeded'; reject(contradictory);
  for (const state of ['settled','net_executed','legitimate']) {
    const changed = mapping(); changed.lifecycle[0].state = state; reject(changed);
  }
});

test('time declarations accept explicit offsets/IANA and reject field, meaning and zone guesses', () => {
  for (const timezone of ['+07:00','-05:30','UTC','Asia/Vientiane']) {
    assert.equal(validateSourceSemantics({ ...mapping(), time: { field: 'txtime', meaning: 'business_occurrence', timezone } }).time.timezone, timezone);
  }
  for (const timezone of ['SYSTEM','+14:01','+07','Invalid/Nowhere',' Asia/Vientiane']) {
    reject({ ...mapping(), time: { field: 'txtime', meaning: 'business_occurrence', timezone } });
  }
  reject({ ...mapping(), time: { field: 'requesttime', meaning: 'business_occurrence', timezone: '+07:00' } });
  reject({ ...mapping(), time: { field: 'settletime', meaning: 'business_occurrence', timezone: '+07:00' } });
});

test('currency/amount/fee declarations are exact, explicit and never introduce FX or rounding', () => {
  const currency = { source_ccy: '001', currency: 'XXX', amount_unit: 'minor', fee_unit: 'major' };
  assert.deepEqual(validateSourceSemantics({ ...mapping(), currencies: [currency] }).currencies[0], currency);
  for (const changed of [{ currency: 'xxx' }, { amount_unit: 'guess' }, { fee_unit: 100 }, { fx: 1 }]) {
    reject({ ...mapping(), currencies: [{ ...currency, ...changed }] });
  }
});

test('strict shape, limits, malformed primitives and arbitrary DSL fail with fixed diagnostics', () => {
  for (const input of [null, [], true, { ...mapping(), script: 'PRIVATE_MARKER' }, { ...mapping(), status: 'verified' },
    { ...mapping(), source_manifest_sha256: 'bad' }, { ...mapping(), source_manifest_sha256: 'a'.repeat(64) + '\n' },
    { ...mapping(), lifecycle: Array(1001).fill(mapping().lifecycle[0]) }]) reject(input);
  const fields = mapping(); fields.lifecycle[0].source.issettled = 0; reject(fields);
  const missing = mapping(); delete missing.lifecycle[0].source.txtype; reject(missing);
});

test('canonical ordering is stable and production/live execution is rejected', () => {
  const input = mapping(); input.lifecycle.push({ source: { ...source, result: '000' }, operation: 'payment', state: 'pending' });
  assert.deepEqual(validateSourceSemantics(input), validateSourceSemantics({ ...input, lifecycle: [...input.lifecycle].reverse() }));
  const before = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; reject(input); }
  finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
});
