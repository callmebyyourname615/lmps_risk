import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicationTransaction, publicationIdentity } from '../dist/synthetic-publication.js';
import { publicationFixture } from '../fixtures/synthetic-publication.mjs';

test('publication recomputes exact known lifecycle with explicit local currency mapping and unresolved time/accounts', () => {
  const input = publicationFixture(); const result = publicationTransaction(input.publication);
  assert.deepEqual(result.transaction, input.transaction); assert.equal(result.transaction.amount, '9999999999999999999999.99');
  assert.equal(result.transaction.transaction_status, 'succeeded'); assert.equal(result.transaction.currency, 'SYN');
  assert.equal(result.transaction.occurred_at, null); assert.equal(result.transaction.sender.status, 'unresolved');
  assert.equal(result.transaction.source_reference.mapping_version, null);
  result.publication.binding.currency.code = 'BAD'; assert.equal(input.publication.binding.currency.code, 'SYN');
});

test('publication rejects unknown/lookup, guessed identity/units, malformed context, missing evidence and unsafe lineage', () => {
  const changes = [p => p.normalization_input.status_code = 'UNKNOWN', p => p.normalization_input.operation_code = 'SYNTH_LOOKUP',
    p => p.binding.currency.decimal_places = 0, p => p.binding.currency.raw = 'OTHER', p => p.binding.currency.code = '840',
    p => p.binding.transaction_id = 'real_account', p => p.normalization_input.synthetic_payment_ref = 'synthetic_other',
    p => p.source.observed_at = '2026-01-02T00:00:01.000Z', p => p.source.source_key.requesttime = '2026-02-30 00:00:00',
    p => p.source.source_key.id = '9007199254740993', p => p.source.extra = 'SYNTHETIC_PRIVATE_VALUE',
    p => p.normalization_input.reversal_code = 'SYNTH_REVERSAL_FULL_COMPLETED', p => p.snapshot_sha256 = 'fake',
    p => p.binding.expected_revision = 2147483647, p => p.execution_mode = 'live', p => p.normalization_input.synthetic_payment_ref = undefined];
  for (const change of changes) { const p = publicationFixture().publication; change(p); assert.throws(() => publicationTransaction(p), /details withheld/); }
  for (const value of [null, {}, [], 'SYNTHETIC_PRIVATE_VALUE']) assert.throws(() => publicationTransaction(value), /details withheld/);
});

test('semantic replay identity ignores capture coordinates and observation time but preserves amount, units, raw semantics and source generation', () => {
  const a = publicationFixture().publication, b = structuredClone(a);
  b.capture_id = '33333333-3333-4333-8333-333333333333'; b.source.capture_epoch = b.capture_id;
  b.source.observed_at = b.normalization_input.observed_at = '2026-01-02T00:00:01.000Z';
  b.snapshot_sha256 = 'c'.repeat(64); publicationTransaction(b);
  assert.deepEqual(publicationIdentity(a), publicationIdentity(b));
  b.normalization_input.amount = '1.00'; assert.notDeepEqual(publicationIdentity(a), publicationIdentity(b));
});
