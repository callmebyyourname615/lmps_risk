import { isTransaction, type Transaction } from '@lmps/contracts';
import type { PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { publicationTransaction, publicationIdentity, type SyntheticPublication } from '@lmps/contracts/synthetic-publication';
import { createDatabase } from './index.js';

export interface LocalTransactionRevision {
  format: 1;
  provenance: 'local_synthetic';
  execution_mode: 'test';
  workspace_key: string;
  expected_revision: number;
  transaction: Transaction;
  publication?: SyntheticPublication;
}
export class TransactionRevisionError extends Error {
  constructor(readonly code: 'INVALID_REVISION' | 'REVISION_CONFLICT' | 'STORAGE_FAILED') {
    super({ INVALID_REVISION: 'Invalid local synthetic transaction revision.',
      REVISION_CONFLICT: 'Transaction revision conflicts with stored evidence or its predecessor.',
      STORAGE_FAILED: 'Local transaction storage failed; details withheld.' }[code]);
    this.name = 'TransactionRevisionError';
  }
}
function localMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
    || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new TransactionRevisionError('INVALID_REVISION');
}
export function validateTransactionRevision(input: unknown): LocalTransactionRevision {
  try {
    localMode();
    const value = structuredClone(input) as LocalTransactionRevision;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== (Object.hasOwn(value, 'publication') ? 'execution_mode,expected_revision,format,provenance,publication,transaction,workspace_key' : 'execution_mode,expected_revision,format,provenance,transaction,workspace_key')
      || value.format !== 1 || value.provenance !== 'local_synthetic' || value.execution_mode !== 'test'
      || typeof value.workspace_key !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(value.workspace_key)
      || !Number.isInteger(value.expected_revision) || value.expected_revision < 0 || value.expected_revision > 2147483646
      || !isTransaction(value.transaction)) throw new Error();
    const tx = value.transaction;
    if (tx.execution_mode !== 'test' || (!value.publication && tx.transaction_status !== 'unknown') || tx.occurred_at !== null
      || !/^synthetic_[a-z0-9_]{1,40}$/.test(tx.source_reference.namespace) || tx.source_reference.mapping_version !== null
      || [tx.source_bank_id, tx.destination_bank_id, tx.transaction_type, tx.channel].some(field => field !== null)
      || [tx.sender, tx.receiver].some(account => account.status !== 'unresolved' || account.source_representation !== 'unknown'
        || account.reason_code !== 'STABLE_IDENTITY_UNVERIFIED')
      || [tx.run_id, tx.correlation_id, tx.transaction_revision, tx.source_reference.record_ref].some(ref => !/^synthetic[_-][A-Za-z0-9._:-]{1,117}$/.test(ref))
      || Buffer.byteLength(JSON.stringify(tx)) > 7000) throw new Error();
    if (Object.hasOwn(value, 'publication')) {
      const normalized = publicationTransaction(value.publication);
      if (normalized.publication.source.workspace_key !== value.workspace_key
        || normalized.publication.binding.expected_revision !== value.expected_revision
        || !isDeepStrictEqual(normalized.transaction, tx)) throw new Error();
    }
    return value;
  } catch { throw new TransactionRevisionError('INVALID_REVISION'); }
}

export function createTransactionRevisions(dsn: string) {
  localMode();
  const database = createDatabase(dsn, 'intake');
  return {
    close: database.close,
    async append(input: unknown): Promise<{ status: 'inserted' | 'duplicate'; revision_number: number }> {
      const value = validateTransactionRevision(input);
      const tx = value.transaction;
      const key = [value.workspace_key, tx.source_reference.namespace, tx.transaction_id, value.expected_revision + 1];
      const payload = JSON.stringify(tx);
      const publication = value.publication ? JSON.stringify(value.publication) : null;
      let client: PoolClient | undefined;
      let active = false, discard = false;
      try {
        client = await database.pool.connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); active = true;
        const inserted = await client.query(`INSERT INTO platform.local_transaction_revisions
          (workspace_key,namespace,transaction_id,revision_number,payload,publication) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
          ON CONFLICT DO NOTHING RETURNING revision_number`, [...key, payload, publication]);
        if (!inserted.rowCount) {
          const stored = (await client.query(`SELECT payload,publication FROM platform.local_transaction_revisions
            WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=$4`, key)).rows[0];
          if (!stored) throw new TransactionRevisionError('REVISION_CONFLICT');
          const previous = validateTransactionRevision({ format: 1, provenance: 'local_synthetic', execution_mode: 'test',
            workspace_key: value.workspace_key, expected_revision: value.expected_revision, transaction: stored.payload,
            ...(stored.publication === null ? {} : { publication: stored.publication }) });
          let matches = isDeepStrictEqual(previous, value);
          if (previous.publication && value.publication) {
            const a = previous.publication, b = value.publication;
            matches = isDeepStrictEqual(publicationIdentity(a), publicationIdentity(b))
              && (a.capture_id !== b.capture_id || (a.snapshot_sha256 === b.snapshot_sha256 && a.evidence_sha256 === b.evidence_sha256));
          }
          if (!matches) throw new TransactionRevisionError('REVISION_CONFLICT');
        }
        await client.query('COMMIT'); active = false;
        return { status: inserted.rowCount ? 'inserted' : 'duplicate', revision_number: value.expected_revision + 1 };
      } catch (error) {
        if (active && client) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
        if (error instanceof TransactionRevisionError) throw error;
        if ((error as { code?: string }).code === '23503') throw new TransactionRevisionError('REVISION_CONFLICT');
        throw new TransactionRevisionError('STORAGE_FAILED');
      } finally { client?.release(discard); }
    },
  };
}
