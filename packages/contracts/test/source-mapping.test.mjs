import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isTransaction } from '../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/source-mapping.json', import.meta.url), 'utf8'));

for (const fixture of corpus.cases) {
  test(fixture.id, () => {
    assert.equal(corpus.synthetic_only, true);
    assert.equal(corpus.production_mapping_approved, false);
    const candidate = structuredClone(corpus.canonical_example);
    Object.assign(candidate, fixture.canonical_set);
    const before = structuredClone(candidate);
    assert.equal(isTransaction(candidate), fixture.wire_valid);
    assert.deepEqual(candidate, before);
    if (fixture.wire_valid) {
      const source = { ...corpus.source_example, ...fixture.source_set };
      assert.equal(candidate.amount, source.amount);
      assert.equal(candidate.occurred_at, null);
      assert.equal(candidate.transaction_status, 'unknown');
      assert.equal(candidate.sender.status, 'unresolved');
      assert.equal(candidate.receiver.status, 'unresolved');
      assert.equal(candidate.source_bank_id, null);
      assert.equal(candidate.destination_bank_id, null);
      assert.equal(source.frommember, '0001');
      assert.equal(source.tomember, '0002');
    }
  });
}
