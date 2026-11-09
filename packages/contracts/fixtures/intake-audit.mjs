import { randomUUID } from 'node:crypto';
import { makeSourcePublication, makeJointSourcePublication, sourceEvidenceHash } from '../dist/source-publication.js';

export function auditFixture() {
  const workspace = 'synthetic_local', namespace = 'synthetic_csv';
  const rows = [], generation = randomUUID(), batch = randomUUID();
  for (const [index, result] of ['OK', 'ERROR', 'OK', 'OK'].entries()) {
    const original = makeSourcePublication({ workspace, namespace, generation, batch,
      dataset_sha256: 'a'.repeat(64), rows_sha256: 'b'.repeat(64), source_namespace: 'lmps_transfer', row_number: index + 1,
      values: [String(index + 1723456780), '2026-11-03 00:00:00', '123456789.12', index === 3 ? 'THB' : 'LAK', result, '2026-11-03 00:00:01'],
      observed_at: '2026-11-04T00:00:00.000Z', expected_revision: 0 });
    const stored = value => ({ workspace_key: workspace, namespace, transaction_id: value.transaction.transaction_id,
      revision_number: value.publication.binding.expected_revision + 1, provenance: 'user_supplied_file', payload: value.transaction, publication: value.publication });
    rows.push(stored(original));
    if (index === 1 || index === 2) rows.push(stored(makeJointSourcePublication(original.publication, {
      manifest_sha256: 'c'.repeat(64), review_sha256: 'd'.repeat(64), review_row_sha256: 'e'.repeat(64), binding_sha256: 'f'.repeat(64),
      previous_publication_sha256: sourceEvidenceHash(original.publication), previous_payload_sha256: sourceEvidenceHash(original.transaction),
      review_row_number: index + 1, shouldrevert: index === 1 ? '1' : null,
    })));
  }
  return rows;
}
