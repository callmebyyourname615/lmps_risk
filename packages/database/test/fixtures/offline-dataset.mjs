import { randomUUID, createHash } from 'node:crypto';
import { DATASET_PROFILE_VERSION, DATASET_COLUMNS } from '../../../contracts/dist/offline-dataset.js';
import { datasetRowsHash } from '../../dist/index.js';

export function datasetFixture(count = 3, source_table = 'transfer') {
  const rows = Array.from({ length: count }, (_, i) => {
    const values = { id: String(i + 1), requesttime: '2026-10-01 12:00:00', amount: '9999999999999999999999.99',
      ccy: 'SYNTHETIC_CCY', result: null, txtime: '2026-10-01 12:00:00', code: String(i + 1).padStart(6, '0'), status: 'SIM', member_type: null };
    return DATASET_COLUMNS[source_table].map(n => values[n]);
  });
  const content = JSON.stringify(rows);
  return { manifest: { format: 1, execution_mode: 'offline_analysis', batch_ref: randomUUID(), workspace_key: 'offline_local', source_namespace: 'offline_fixture', source_table,
    profile_version: DATASET_PROFILE_VERSION, dataset_sha256: createHash('sha256').update(content).digest('hex'), input_bytes: Buffer.byteLength(content), expected_rows: rows.length,
    rows_sha256: datasetRowsHash(rows) }, rows };
}
