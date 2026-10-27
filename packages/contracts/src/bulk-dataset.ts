import { DATASET_DIGEST, datasetMode, validateDatasetInput, type DatasetInput } from './offline-dataset.js';

export const BULK_PLAN_VERSION = 'lmps-bulk-plan-1';
export interface BulkPlan {
  format: typeof BULK_PLAN_VERSION; execution_mode: 'offline_analysis'; source_semantics: 'unverified';
  source_manifest_sha256: string; source_format: string; source_rows: number; source_windows: number;
  requested_rows: number; selected_rows: number; unique_rows: number; duplicate_rows: number; conflicting_rows: 0;
  selection: 'source_file_order_prefix_not_random';
  chunks: { number: number; csv: string; lineage: string; lineage_sha256: string; input: DatasetInput }[];
}
export function validateBulkPlan(input: unknown): BulkPlan {
  try {
    datasetMode(); const v = structuredClone(input) as BulkPlan;
    const exact = (value: object, keys: string[]) => !!value && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
    if (!exact(v, ['format','execution_mode','source_semantics','source_manifest_sha256','source_format','source_rows','source_windows',
      'requested_rows','selected_rows','unique_rows','duplicate_rows','conflicting_rows','selection','chunks'])
      || v.format !== BULK_PLAN_VERSION || v.execution_mode !== 'offline_analysis' || v.source_semantics !== 'unverified'
      || typeof v.source_manifest_sha256 !== 'string' || v.source_manifest_sha256.length !== 64 || !DATASET_DIGEST.test(v.source_manifest_sha256)
      || !['lmps-transfer-escaped-tsv-gzip-1','lmps-transfer-pilot-tsv-gzip-2'].includes(v.source_format)
      || !Number.isSafeInteger(v.source_rows) || v.source_rows < 1 || v.source_rows > 100_000_000
      || !Number.isInteger(v.source_windows) || v.source_windows < 1 || v.source_windows > 1000
      || !Number.isInteger(v.requested_rows) || v.requested_rows < 1 || v.requested_rows > 1_000_000
      || !Number.isInteger(v.selected_rows) || v.selected_rows !== Math.min(v.requested_rows, v.source_rows)
      || !Number.isInteger(v.unique_rows) || v.unique_rows < 1 || v.unique_rows > v.selected_rows
      || !Number.isInteger(v.duplicate_rows) || v.duplicate_rows !== v.selected_rows - v.unique_rows || v.conflicting_rows !== 0
      || v.selection !== 'source_file_order_prefix_not_random' || !Array.isArray(v.chunks) || v.chunks.length < 1 || v.chunks.length > 40
      || Buffer.byteLength(JSON.stringify(v)) > 512 * 1024) throw new Error();
    const refs = new Set<string>(); let total = 0;
    for (const [i, chunk] of v.chunks.entries()) {
      const name = 'chunk-' + String(i).padStart(5, '0');
      if (!exact(chunk, ['number','csv','lineage','lineage_sha256','input']) || chunk.number !== i
        || chunk.csv !== name + '.csv' || chunk.lineage !== name + '.jsonl' || typeof chunk.lineage_sha256 !== 'string'
        || chunk.lineage_sha256.length !== 64 || !DATASET_DIGEST.test(chunk.lineage_sha256)) throw new Error();
      chunk.input = validateDatasetInput(chunk.input);
      if (chunk.input.workspace_key !== 'offline_bulk_trial' || !/^offline_bulk_[0-9a-f]{16}$/.test(chunk.input.source_namespace)
        || chunk.input.source_table !== 'transfer' || chunk.input.expected_rows > 25000
        || refs.has(chunk.input.batch_ref) || (i < v.chunks.length - 1 && chunk.input.expected_rows !== 25000)) throw new Error();
      refs.add(chunk.input.batch_ref); total += chunk.input.expected_rows;
    }
    if (total !== v.unique_rows || new Set(v.chunks.map(c => c.input.source_namespace)).size !== 1) throw new Error();
    return v;
  } catch { throw new Error('BULK_INVALID_PLAN; private diagnostics withheld.'); }
}
