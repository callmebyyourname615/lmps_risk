import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { DATASET_CHUNK_ROWS, DATASET_COLUMNS, DATASET_MAX_ROWS, DATASET_SCOPE, DATASET_UUID, datasetMode, datasetRow,
  validateDatasetInput, validateDatasetValues, OfflineDatasetError, type DatasetManifest, type DatasetValues } from '@lmps/contracts/offline-dataset';
import { riskHash } from '@lmps/risk';
import { createDatabase } from './index.js';

export const datasetRowHash = (values: DatasetValues) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
export function datasetRowsHash(rows: DatasetValues[]) {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}
export function datasetIdentity(manifest: DatasetManifest) {
  const { batch_ref: _alias, ...identity } = manifest;
  return riskHash(identity);
}
export function validateDatasetSnapshot(input: unknown): { manifest: DatasetManifest; rows: DatasetValues[] } {
  try {
    const v = input as { manifest: unknown; rows: unknown };
    if (!v || Object.keys(v).sort().join(',') !== 'manifest,rows') throw new Error();
    const manifest = validateDatasetInput(v.manifest, true);
    if (!Array.isArray(v.rows) || v.rows.length !== manifest.expected_rows) throw new Error();
    const keys = new Set<string>();
    const rows = v.rows.map(row => {
      const values = validateDatasetValues(manifest.source_table, row);
      const key = JSON.stringify(datasetRow(manifest.source_table, values).source_key);
      if (keys.has(key)) throw new Error(); keys.add(key);
      return values;
    });
    if (datasetRowsHash(rows) !== manifest.rows_sha256) throw new Error();
    return { manifest, rows };
  } catch { throw new OfflineDatasetError('DATASET_INVALID_INPUT'); }
}
function reference(workspace: string, batch: string) {
  datasetMode(); if (!DATASET_SCOPE.test(workspace) || !DATASET_UUID.test(batch)) throw new OfflineDatasetError('DATASET_INVALID_INPUT');
}
function evidence(row: Record<string, any>): DatasetManifest {
  try {
    const m = validateDatasetInput(row.manifest, true);
    if (m.batch_ref !== row.batch_ref || m.workspace_key !== row.workspace_key || m.source_table !== row.source_table
      || m.source_namespace !== row.source_namespace || m.expected_rows !== row.expected_rows
      || riskHash(m) !== row.manifest_sha256 || datasetIdentity(m) !== row.identity_sha256) throw new Error();
    return m;
  } catch { throw new OfflineDatasetError('DATASET_STORAGE_UNAVAILABLE'); }
}
function view(row: Record<string, any>) {
  evidence(row);
  if (!Number.isInteger(row.loaded_rows) || row.loaded_rows < 0 || row.loaded_rows > row.expected_rows
    || !['importing', 'complete', 'blocked'].includes(row.status)
    || !['not_checked','incomplete','matched','mismatch'].includes(row.reconciliation_status)) throw new OfflineDatasetError('DATASET_STORAGE_UNAVAILABLE');
  return { batch_ref: row.batch_ref as string, workspace_key: row.workspace_key as string, source_table: row.source_table as string,
    expected_rows: row.expected_rows as number, loaded_rows: row.loaded_rows as number,
    status: row.status as 'importing' | 'complete' | 'blocked', reconciliation_status: row.reconciliation_status as string,
    source_semantics: 'unverified' as const, execution_mode: 'offline_analysis' as const };
}

export function createOfflineDatasets(dsn: string) {
  datasetMode(); const database = createDatabase(dsn, 'intake');
  async function transaction<T>(fn: (client: PoolClient) => Promise<T>, repeatable = false, readOnly = false) {
    let client: PoolClient | undefined, active = false;
    try {
      client = await database.pool.connect(); await client.query(repeatable ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' + (readOnly ? ' READ ONLY' : '') : 'BEGIN'); active = true;
      const value = await fn(client); await client.query('COMMIT'); active = false; return value;
    } catch (error) {
      if (client && active) { try { await client.query('ROLLBACK'); } catch {} }
      if (error instanceof OfflineDatasetError) throw error;
      throw new OfflineDatasetError('DATASET_STORAGE_UNAVAILABLE');
    } finally { client?.release(true); }
  }
  async function locked(client: PoolClient, manifest: DatasetManifest) {
    const row = (await client.query('SELECT * FROM platform.offline_dataset_batches WHERE workspace_key=$1 AND batch_ref=$2 FOR UPDATE', [manifest.workspace_key, manifest.batch_ref])).rows[0];
    if (!row) throw new OfflineDatasetError('DATASET_NOT_FOUND');
    if (!isDeepStrictEqual(evidence(row), manifest)) throw new OfflineDatasetError('DATASET_INPUT_CONFLICT');
    return row;
  }
  return {
    close: database.close,
    async readComplete(workspace: string, batch: string, datasetHash: string) {
      reference(workspace, batch);
      if (typeof datasetHash !== 'string' || datasetHash.length !== 64 || !/^[0-9a-f]{64}$/.test(datasetHash)) throw new OfflineDatasetError('DATASET_INVALID_INPUT');
      return transaction(async client => {
        const record = (await client.query('SELECT * FROM platform.offline_dataset_batches WHERE workspace_key=$1 AND batch_ref=$2', [workspace, batch])).rows[0];
        if (!record) throw new OfflineDatasetError('DATASET_NOT_FOUND');
        const manifest = evidence(record), state = view(record);
        if (state.status !== 'complete' || state.reconciliation_status !== 'matched' || state.loaded_rows !== manifest.expected_rows
          || !record.reconciled_at || record.source_kind !== 'user_supplied_file' || record.execution_mode !== 'offline_analysis'
          || record.source_semantics !== 'unverified') throw new OfflineDatasetError('DATASET_BLOCKED');
        if (manifest.dataset_sha256 !== datasetHash) throw new OfflineDatasetError('DATASET_INPUT_CONFLICT');
        const rows: DatasetValues[] = [];
        while (true) {
          const page = (await client.query(`SELECT row_number,source_table,source_key,fields,row_sha256 FROM platform.offline_dataset_rows
            WHERE workspace_key=$1 AND batch_ref=$2 AND row_number>$3 ORDER BY row_number LIMIT $4`, [workspace, batch, rows.length, DATASET_CHUNK_ROWS])).rows;
          if (!page.length) break;
          for (const row of page) {
            if (rows.length >= manifest.expected_rows || row.row_number !== rows.length + 1 || row.source_table !== manifest.source_table) throw new Error();
            const values = validateDatasetValues(manifest.source_table, DATASET_COLUMNS[manifest.source_table].map(name =>
              Object.hasOwn(row.source_key, name) ? row.source_key[name] : row.fields[name]));
            const shape = datasetRow(manifest.source_table, values);
            if (datasetRowHash(values) !== row.row_sha256 || !isDeepStrictEqual(shape.source_key, row.source_key)
              || !isDeepStrictEqual(shape.fields, row.fields)) throw new Error();
            rows.push(values);
          }
        }
        // Recheck current evidence in one snapshot; a previous matched status alone is insufficient.
        return validateDatasetSnapshot({ manifest, rows });
      }, true, true);
    },
    async register(input: unknown) {
      datasetMode(); const manifest = validateDatasetInput(input, true), identity = datasetIdentity(manifest);
      return transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,352))', [identity]);
        const prior = (await client.query(`SELECT * FROM platform.offline_dataset_batches WHERE batch_ref=$1 OR (workspace_key=$2 AND identity_sha256=$3)`, [manifest.batch_ref, manifest.workspace_key, identity])).rows;
        if (prior.length) {
          if (prior.length !== 1 || prior[0].workspace_key !== manifest.workspace_key || prior[0].identity_sha256 !== identity) throw new OfflineDatasetError('DATASET_INPUT_CONFLICT');
          return { registration: 'duplicate' as const, ...view(prior[0]) };
        }
        const row = (await client.query(`INSERT INTO platform.offline_dataset_batches
          (batch_ref,workspace_key,source_namespace,source_table,identity_sha256,manifest,manifest_sha256,expected_rows)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`,
        [manifest.batch_ref, manifest.workspace_key, manifest.source_namespace, manifest.source_table, identity, JSON.stringify(manifest), riskHash(manifest), manifest.expected_rows])).rows[0];
        if (!row) throw new OfflineDatasetError('DATASET_INPUT_CONFLICT');
        return { registration: 'inserted' as const, ...view(row) };
      });
    },
    async status(workspace: string, batch: string) {
      reference(workspace, batch);
      return transaction(async client => {
        const row = (await client.query('SELECT * FROM platform.offline_dataset_batches WHERE workspace_key=$1 AND batch_ref=$2', [workspace, batch])).rows[0];
        if (!row) throw new OfflineDatasetError('DATASET_NOT_FOUND');
        return view(row);
      });
    },
    async resolve(input: unknown) {
      datasetMode(); const manifest = validateDatasetInput(input, true);
      return transaction(async client => {
        const row = (await client.query('SELECT * FROM platform.offline_dataset_batches WHERE workspace_key=$1 AND identity_sha256=$2', [manifest.workspace_key, datasetIdentity(manifest)])).rows[0];
        if (!row) throw new OfflineDatasetError('DATASET_NOT_FOUND');
        return { ...manifest, batch_ref: evidence(row).batch_ref };
      });
    },
    async append(input: unknown, start: number, inputRows: unknown[]) {
      datasetMode(); const manifest = validateDatasetInput(input, true);
      if (!Number.isInteger(start) || start < 1 || !Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > DATASET_CHUNK_ROWS
        || start + inputRows.length - 1 > manifest.expected_rows) throw new OfflineDatasetError('DATASET_INVALID_INPUT');
      const rows = inputRows.map((v, i) => { const values = validateDatasetValues(manifest.source_table, v); return { row_number: start + i, ...datasetRow(manifest.source_table, values), row_sha256: datasetRowHash(values) }; });
      return transaction(async client => {
        const batch = await locked(client, manifest);
        if (batch.status === 'blocked') throw new OfflineDatasetError('DATASET_BLOCKED');
        if (start + rows.length - 1 <= batch.loaded_rows) {
          const prior = (await client.query(`SELECT row_number,source_key,fields,row_sha256 FROM platform.offline_dataset_rows
            WHERE workspace_key=$1 AND batch_ref=$2 AND row_number BETWEEN $3 AND $4 ORDER BY row_number`, [manifest.workspace_key, manifest.batch_ref, start, start + rows.length - 1])).rows;
          if (!isDeepStrictEqual(prior, rows)) throw new OfflineDatasetError('DATASET_INPUT_CONFLICT');
          return view(batch);
        }
        if (start !== batch.loaded_rows + 1 || batch.status !== 'importing') throw new OfflineDatasetError('DATASET_INPUT_CONFLICT');
        await client.query(`INSERT INTO platform.offline_dataset_rows(workspace_key,batch_ref,source_table,row_number,source_key,fields,row_sha256)
          SELECT $1,$2,$3,x.row_number,x.source_key,x.fields,x.row_sha256 FROM jsonb_to_recordset($4::jsonb)
          AS x(row_number integer,source_key jsonb,fields jsonb,row_sha256 text)`, [manifest.workspace_key, manifest.batch_ref, manifest.source_table, JSON.stringify(rows)]);
        const next = (await client.query(`UPDATE platform.offline_dataset_batches SET loaded_rows=$3,reconciliation_status='not_checked',reconciled_at=NULL,updated_at=clock_timestamp()
          WHERE workspace_key=$1 AND batch_ref=$2 RETURNING *`, [manifest.workspace_key, manifest.batch_ref, start + rows.length - 1])).rows[0];
        return view(next);
      });
    },
    async reconcile(input: unknown) {
      datasetMode(); const { manifest, rows } = validateDatasetSnapshot(input);
      return transaction(async client => {
        const batch = await locked(client, manifest);
        let cursor = 0, observed = 0, matched = 0, mismatched = 0, unexpected = 0, prefix = 0;
        while (true) {
          const page = (await client.query(`SELECT row_number,source_key,fields,row_sha256 FROM platform.offline_dataset_rows
            WHERE workspace_key=$1 AND batch_ref=$2 AND row_number>$3 ORDER BY row_number LIMIT $4`, [manifest.workspace_key, manifest.batch_ref, cursor, DATASET_CHUNK_ROWS])).rows;
          if (!page.length) break;
          for (const record of page) {
            cursor = record.row_number; observed++;
            if (observed > DATASET_MAX_ROWS) throw new OfflineDatasetError('DATASET_STORAGE_UNAVAILABLE');
            if (cursor <= batch.loaded_rows) prefix++;
            const expected = rows[cursor - 1];
            if (!expected) { unexpected++; continue; }
            const shape = datasetRow(manifest.source_table, expected);
            if (record.row_sha256 === datasetRowHash(expected) && isDeepStrictEqual(record.source_key, shape.source_key) && isDeepStrictEqual(record.fields, shape.fields)) matched++;
            else mismatched++;
          }
        }
        const missing = manifest.expected_rows - matched - mismatched;
        const mismatch = mismatched > 0 || unexpected > 0 || observed !== batch.loaded_rows || prefix !== batch.loaded_rows;
        const result = mismatch ? 'mismatch' : missing > 0 ? 'incomplete' : 'matched';
        const status = mismatch ? 'blocked' : result === 'matched' ? 'complete' : 'importing';
        const saved = (await client.query(`UPDATE platform.offline_dataset_batches SET status=$3,reconciliation_status=$4,reconciled_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE workspace_key=$1 AND batch_ref=$2 RETURNING *`, [manifest.workspace_key, manifest.batch_ref, status, result])).rows[0];
        return { ...view(saved), counts: { expected: manifest.expected_rows, observed, matched, missing, mismatched, unexpected } };
      }, true);
    },
  };
}
