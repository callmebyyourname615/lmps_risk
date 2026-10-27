import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isTransaction, isRiskAssessment, isAlert } from '../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/corpus.json', import.meta.url), 'utf8'));
const validators = { transaction: isTransaction, 'risk-assessment': isRiskAssessment, alert: isAlert };

for (const fixture of corpus.cases) {
  test(fixture.id, () => {
    assert.equal(corpus.synthetic_only, true);
    const value = structuredClone(corpus.examples[fixture.contract]);
    Object.assign(value, fixture.set);
    for (const field of fixture.omit) delete value[field];
    const before = structuredClone(value);
    assert.equal(validators[fixture.contract](value), fixture.valid);
    assert.deepEqual(value, before, 'Validation must not coerce, strip or fill fields');
  });
}

test('amount precision and identifier leading zeros survive JSON round trip', () => {
  const value = JSON.parse(JSON.stringify(corpus.examples.transaction));
  assert.equal(isTransaction(value), true);
  assert.equal(value.transaction_id, '0009007199254740993');
  assert.equal(value.amount, '9007199254740993.123456789012345678');
});

test('all validators reject non-object inputs and arrays', () => {
  for (const validate of Object.values(validators)) {
    for (const value of [null, [], true, 1, 'synthetic-private-canary']) {
      assert.equal(validate(value), false);
    }
  }
});
