import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isTransaction } from '../dist/index.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const book = read('../../../docs/data-dictionary/synthetic-lifecycle-codebook.v1.json');
const corpus = read('../fixtures/synthetic-lifecycle.json');
const source = read('../fixtures/source-mapping.json');

test('synthetic codebook is versioned independently and leaves all real-source gates unverified', () => {
  assert.equal(book.codebook_version, corpus.codebook_version);
  assert.match(book.codebook_version, /^synthetic-lifecycle-\d+\.\d+\.\d+-draft\.\d+$/);
  assert.equal(book.canonical_schema_version, source.canonical_example.schema_version);
  for (const item of [book, corpus]) {
    assert.equal(item.synthetic_only, true);
    assert.equal(item.production_mapping_approved, false);
  }
  assert.equal(book.execution_mode, 'test');
  assert.equal(book.source_field_mapping, null);
  assert.equal(book.policies.live_capture_enabled, false);
  assert.equal(book.policies.account_identity_resolved, false);
  const mapping = read('../../../docs/data-dictionary/source-mapping.json');
  assert.equal(Object.keys(mapping.gates).length, 13);
  assert.ok(Object.values(mapping.gates).every(gate => gate.status === 'UNVERIFIED'));
});

test('raw code tables are explicit and cannot turn null, numeric codes or existing raw statuses into success', () => {
  assert.equal(book.policies.matching, 'exact_string');
  assert.equal(book.policies.coerce, false);
  assert.equal(book.policies.trim, false);
  assert.equal(book.policies.case_fold, false);
  assert.equal(book.policies.missing_null_empty_or_unrecognized_code, 'unknown');
  assert.equal(book.policies.non_string_non_null_code, 'invalid');
  for (const codes of Object.values(book.codes)) {
    for (const key of Object.keys(codes)) assert.match(key, /^SYNTH_[A-Z_]+$/);
    for (const raw of corpus.unrecognized_codes) assert.equal(Object.hasOwn(codes, raw), false);
    assert.equal(Object.hasOwn(codes, null), false);
    assert.equal(Object.hasOwn(codes, undefined), false);
  }
  for (const raw of corpus.invalid_code_values) assert.notEqual(typeof raw, 'string');
  assert.equal(Object.hasOwn(book.codes.status, source.source_example.result), false);
});

test('lookup and uncompleted reversals cannot be reclassified as an executed or reversed payment', () => {
  assert.equal(book.policies.lookup_emits_payment, false);
  assert.equal(book.policies.lookup_allows_reversal, false);
  assert.equal(book.policies.source_table_or_row_identity_proves_payment, false);
  assert.equal(book.policies.requested_or_failed_reversal_changes_original_status, false);
  assert.deepEqual(Object.keys(book.reversal_status_overrides).sort(), ['full_completed', 'partial_completed']);
  assert.equal(book.policies.non_none_reversal_requires_original_status, 'succeeded');
  assert.equal(book.policies.unmet_completion_requirements, 'unknown_withhold_candidate');
  assert.ok(book.completion_requirements.includes('original_synthetic_payment_link'));
  assert.ok(book.completion_requirements.includes('completed_reversal_evidence'));
  assert.ok(book.completion_requirements.includes('same_currency'));
  assert.ok(book.completion_requirements.includes('reversal_event_deduplication'));
  for (const field of ['originalreference', 'shouldrevert', 'isreconciled', 'issettled', 'negative_amount', 'source_delete', 'history_table_membership']) {
    assert.ok(book.not_reversal_completion_evidence.includes(field));
  }
});

for (const fixture of corpus.cases) {
  test(`codebook definition: ${fixture.id}`, () => {
    // Definition/wire consistency only; applying this book to source rows belongs to the normalizer.
    assert.equal(book.codes.operation[fixture.operation_code], fixture.kind);
    assert.equal(book.codes.status[fixture.status_code], fixture.base_status);
    assert.equal(book.codes.reversal[fixture.reversal_code], fixture.reversal);
    if (fixture.kind === 'lookup') {
      assert.equal(fixture.candidate_status, null);
      assert.equal(book.policies.lookup_emits_payment, false);
      return;
    }
    const override = book.reversal_status_overrides[fixture.reversal];
    assert.equal(fixture.candidate_status, override ?? fixture.base_status);
    if (override) assert.ok(book.completion_requirements.length > 0);
    const candidate = structuredClone(source.canonical_example);
    candidate.transaction_status = fixture.candidate_status;
    assert.equal(isTransaction(candidate), true);
    assert.equal(candidate.sender.status, 'unresolved');
    assert.equal(candidate.receiver.status, 'unresolved');
    assert.equal(candidate.source_reference.mapping_version, null);
    assert.equal(source.canonical_example.transaction_status, 'unknown');
  });
}

for (const fixture of corpus.completion_boundaries) {
  test(`codebook amount example: ${fixture.id}`, () => {
    // Fixed-two-decimal fixture oracle, not a runtime source-money converter.
    for (const value of [fixture.original, fixture.cumulative_reversed]) assert.match(value, /^(0|[1-9]\d*)\.\d{2}$/);
    const original = BigInt(fixture.original.replace('.', ''));
    const cumulative = BigInt(fixture.cumulative_reversed.replace('.', ''));
    const valid = original > 0n && cumulative > 0n && (fixture.meaning === 'partial_completed' ? cumulative < original : cumulative === original);
    assert.equal(valid, fixture.amount_condition_met);
    assert.equal(book.policies.completed_amount_semantics, 'cumulative_per_original_payment_not_per_observation');
    assert.equal(book.policies.amount_representation, 'exact_decimal_strings_no_rounding_or_abs');
  });
}
