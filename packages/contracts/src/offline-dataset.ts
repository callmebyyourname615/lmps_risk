export const DATASET_PROFILE_VERSION = 'offline-dataset-profile-1';
export const DATASET_MAX_ROWS = 100_000;
export const DATASET_MAX_BYTES = 64 * 1024 * 1024;
export const DATASET_CHUNK_ROWS = 500;
export const DATASET_COLUMNS = {
  transfer: ['id', 'requesttime', 'amount', 'ccy', 'result', 'txtime'],
  transfer_hist: ['id', 'requesttime', 'amount', 'ccy', 'result', 'txtime'],
  transfer_old: ['id', 'amount', 'ccy', 'result', 'txtime'],
  member: ['code', 'status', 'member_type'],
} as const;
export type DatasetTable = keyof typeof DATASET_COLUMNS;
export type DatasetValues = (string | null)[];
export interface DatasetInput {
  format: 1; execution_mode: 'offline_analysis'; batch_ref: string; workspace_key: string; source_namespace: string;
  source_table: DatasetTable; profile_version: typeof DATASET_PROFILE_VERSION; dataset_sha256: string; input_bytes: number; expected_rows: number;
}
export interface DatasetManifest extends DatasetInput { rows_sha256: string }
export const DATASET_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const DATASET_SCOPE = /^offline_[a-z0-9_]{1,40}$/;
export const DATASET_DIGEST = /^[0-9a-f]{64}$/;
export const DATASET_ERRORS = ['DATASET_INVALID_INPUT', 'DATASET_INPUT_CONFLICT', 'DATASET_NOT_FOUND', 'DATASET_BLOCKED', 'DATASET_STORAGE_UNAVAILABLE', 'DATASET_FILE_REJECTED'] as const;
export type DatasetErrorCode = typeof DATASET_ERRORS[number];
export class OfflineDatasetError extends Error {
  constructor(readonly code: DatasetErrorCode) { super(code + '; private diagnostics withheld.'); this.name = 'OfflineDatasetError'; }
}
export function datasetMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
    || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new OfflineDatasetError('DATASET_INVALID_INPUT');
}
export function validateDatasetInput(input: unknown, manifest: true): DatasetManifest;
export function validateDatasetInput(input: unknown, manifest?: false): DatasetInput;
export function validateDatasetInput(input: unknown, manifest = false): DatasetInput | DatasetManifest {
  try {
    const v = structuredClone(input) as DatasetManifest;
    const names = ['format','execution_mode','batch_ref','workspace_key','source_namespace','source_table','profile_version','dataset_sha256','input_bytes','expected_rows', ...(manifest ? ['rows_sha256'] : [])];
    if (!v || Object.keys(v).sort().join(',') !== names.sort().join(',') || v.format !== 1 || v.execution_mode !== 'offline_analysis'
      || !DATASET_UUID.test(v.batch_ref) || !DATASET_SCOPE.test(v.workspace_key) || !DATASET_SCOPE.test(v.source_namespace)
      || !Object.hasOwn(DATASET_COLUMNS, v.source_table) || v.profile_version !== DATASET_PROFILE_VERSION
      || typeof v.dataset_sha256 !== 'string' || !DATASET_DIGEST.test(v.dataset_sha256)
      || !Number.isInteger(v.input_bytes) || v.input_bytes < 1 || v.input_bytes > DATASET_MAX_BYTES
      || !Number.isInteger(v.expected_rows) || v.expected_rows < 1 || v.expected_rows > DATASET_MAX_ROWS
      || (manifest && (typeof v.rows_sha256 !== 'string' || !DATASET_DIGEST.test(v.rows_sha256)))) throw new Error();
    return v;
  } catch { throw new OfflineDatasetError('DATASET_INVALID_INPUT'); }
}
export function validateDatasetValues(table: DatasetTable, input: unknown): DatasetValues {
  try {
    const columns = DATASET_COLUMNS[table];
    if (!columns || !Array.isArray(input) || input.length !== columns.length) throw new Error();
    const values: DatasetValues = input.map((v: unknown, i: number) => {
      const name = columns[i]!;
      if (v === null && ['result', 'status', 'member_type'].includes(name)) return null;
      if (typeof v !== 'string' || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v)) throw new Error();
      if (name === 'id') {
        if (!/^(0|-?[1-9][0-9]{0,9})$/.test(v) || BigInt(v) < -2147483648n || BigInt(v) > 2147483647n) throw new Error();
      } else if (name === 'amount') {
        if (!/^-?(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(v)) throw new Error();
      } else if (name === 'txtime' || name === 'requesttime') {
        if (!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(v)) throw new Error();
        // UTC validates the calendar only; the original naive source string is preserved.
        if (new Date(v.replace(' ', 'T') + 'Z').toISOString().slice(0, 19).replace('T', ' ') !== v) throw new Error();
      } else {
        const maximum = { code: 100, status: 16, member_type: 20, ccy: 200, result: 200 }[name];
        if (maximum === undefined || [...v].length > maximum || (['code', 'ccy'].includes(name) && v.length === 0)) throw new Error();
      }
      return v;
    });
    return values;
  } catch { throw new OfflineDatasetError('DATASET_INVALID_INPUT'); }
}
export function datasetRow(table: DatasetTable, values: DatasetValues) {
  const source_key: Record<string, string> = {}, fields: Record<string, string | null> = {};
  DATASET_COLUMNS[table].forEach((name, i) => {
    if (name === 'id' || name === 'code' || name === 'requesttime') source_key[name] = values[i]!;
    else fields[name] = values[i]!;
  });
  return { source_key, fields };
}
