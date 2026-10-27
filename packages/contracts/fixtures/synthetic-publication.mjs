import { publicationTransaction, PUBLISHER_VERSION } from '../dist/synthetic-publication.js';
import { CODEBOOK_VERSION } from '../dist/synthetic-normalization.js';

export function publicationFixture(expected_revision = 0) {
  const capture_id = '11111111-1111-4111-8111-111111111111';
  const publication = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', publisher_version: PUBLISHER_VERSION,
    capture_id, snapshot_sha256: 'a'.repeat(64), evidence_sha256: 'b'.repeat(64),
    source: { workspace_key: 'synthetic_local', source_namespace: 'synthetic_snapshot',
      source_generation: '22222222-2222-4222-8222-222222222222', capture_epoch: capture_id,
      event_key: 'transfer:1', source_table: 'transfer', source_key: { id: '1', requesttime: '2026-01-01 00:00:00' },
      operation: 'snapshot', observed_at: '2026-01-01T00:00:01.000Z' },
    binding: { event_key: 'transfer:1', transaction_id: 'synthetic_payment_001', transaction_revision: 'synthetic_revision_' + (expected_revision + 1),
      expected_revision, currency: { raw: 'SYNTH_CCY_A', code: 'SYN', decimal_places: 2 } },
    normalization_input: { format: 1, provenance: 'local_synthetic', execution_mode: 'test', codebook_version: CODEBOOK_VERSION,
      source_reference: { namespace: 'synthetic_snapshot', record_ref: 'transfer:1' }, observed_at: '2026-01-01T00:00:01.000Z',
      amount: '9999999999999999999999.99', currency: 'SYNTH_CCY_A', source_time: '2026-01-01 00:00:00',
      operation_code: 'SYNTH_PAYMENT', status_code: 'SYNTH_SUCCEEDED', reversal_code: 'SYNTH_REVERSAL_NONE' } };
  const { transaction } = publicationTransaction(publication);
  return { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', expected_revision, transaction, publication };
}
