import { readFileSync } from 'node:fs';
const original = JSON.parse(readFileSync(new URL('../../../contracts/fixtures/corpus.json', import.meta.url), 'utf8')).examples.transaction;

export function revision(expected = 0) {
  const transaction = structuredClone(original);
  transaction.source_reference.namespace = 'synthetic_transactions';
  transaction.source_reference.record_ref = 'synthetic_record_1';
  transaction.transaction_revision = 'synthetic_revision_' + (expected + 1);
  for (const account of [transaction.sender, transaction.receiver]) account.source_representation = 'unknown';
  return { format: 1, provenance: 'local_synthetic', execution_mode: 'test',
    workspace_key: 'synthetic_local', expected_revision: expected, transaction };
}
