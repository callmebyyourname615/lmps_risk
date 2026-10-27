import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CODEBOOK_VERSION } from '../../dist/normalization.js';
import { snapshotIdentity } from '../../dist/sync-job.js';

const source = JSON.parse(readFileSync(new URL('../../../../packages/database/fixtures/source-event.json', import.meta.url), 'utf8'));
export function normalizationFixture() {
  const capture_id = randomUUID(), generation = randomUUID();
  const specs = [
    ['transfer', '1', '42.50'], ['transfer', '2', '0.00'], ['transfer', '3', '100.00'], ['transfer', '4', '-1.00'],
    ['transfer_hist', '1', '42.50'], ['transfer_old', '1', '42.50'], ['member', '1', null],
  ];
  const snapshot = { format: 1, capture_id, events: specs.map(([table, id, amount]) => ({ ...structuredClone(source),
    source_namespace: 'synthetic_snapshot', source_generation: generation, capture_epoch: capture_id, event_key: `${table}:${id}`, source_table: table,
    source_key: table === 'member' ? { code: 'SYNTHETIC_MEMBER_001' } : table === 'transfer_old' ? { id } : { id, requesttime: source.source_key.requesttime },
    fields: table === 'member' ? { status: null, member_type: null } : { amount, ccy: 'SYNTH_CCY_A', result: 'SYNTH_SUCCEEDED', txtime: source.fields.txtime },
  })) };
  const codes = { operation_code: 'SYNTH_PAYMENT', status_code: 'SYNTH_SUCCEEDED', reversal_code: 'SYNTH_REVERSAL_NONE' };
  const evidence = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', codebook_version: CODEBOOK_VERSION,
    capture_id, snapshot_sha256: snapshotIdentity(snapshot).snapshot_sha256,
    entries: [
      { event_key: 'transfer:1', ...codes },
      { event_key: 'transfer:2', ...codes, operation_code: 'SYNTH_LOOKUP' },
      { event_key: 'transfer:3', ...codes, reversal_code: 'SYNTH_REVERSAL_FULL_COMPLETED', synthetic_payment_ref: 'synthetic_original_003',
        reversal_evidence: { original_payment_ref: 'synthetic_original_003', events: [
          { event_ref: 'synthetic_reversal_001', amount: '30.00', currency: 'SYNTH_CCY_A', completed: true },
          { event_ref: 'synthetic_reversal_002', amount: '70.00', currency: 'SYNTH_CCY_A', completed: true },
          { event_ref: 'synthetic_reversal_001', amount: '30.00', currency: 'SYNTH_CCY_A', completed: true },
        ] } },
      { event_key: 'transfer:4', ...codes },
      { event_key: 'transfer_old:1', ...codes, status_code: 'SYNTH_PENDING' },
    ] };
  return { snapshot, evidence };
}
