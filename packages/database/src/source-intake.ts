import type { PoolClient } from 'pg';
import { createDatabase } from './index.js';

type SourceTable = 'transfer' | 'transfer_hist' | 'transfer_old' | 'member';
export interface LocalSourceEvent {
  schema_version: 1;
  provenance: 'local_synthetic';
  execution_mode: 'test';
  workspace_key: string;
  source_namespace: string;
  source_generation: string;
  capture_epoch: string;
  event_key: string;
  source_table: SourceTable;
  source_key: Record<string, string>;
  operation: 'snapshot' | 'insert' | 'update' | 'delete';
  observed_at: string;
  fields: Record<string, string | null> | null;
}

export class IntakeError extends Error {
  constructor(readonly code: 'INVALID_EVENT' | 'EVENT_CONFLICT' | 'STORAGE_FAILED') {
    super({ INVALID_EVENT: 'Invalid local synthetic source event.', EVENT_CONFLICT: 'Source event identity conflicts with stored evidence.', STORAGE_FAILED: 'Local source intake failed; storage details withheld.' }[code]);
    this.name = 'IntakeError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function text(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value);
}
function naive(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value.replace(' ', 'T') + 'Z');
  // UTC is used only for calendar validation, never to interpret source DATETIME.
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 19).replace('T', ' ') === value;
}

export function validateSourceEvent(input: unknown): LocalSourceEvent {
  try {
    const value: unknown = structuredClone(input);
    if (!exact(value, ['schema_version', 'provenance', 'execution_mode', 'workspace_key', 'source_namespace', 'source_generation', 'capture_epoch', 'event_key', 'source_table', 'source_key', 'operation', 'observed_at', 'fields'])) throw new Error();
    if (value.schema_version !== 1 || value.provenance !== 'local_synthetic' || value.execution_mode !== 'test') throw new Error();
    for (const name of ['workspace_key', 'source_namespace']) if (typeof value[name] !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(value[name])) throw new Error();
    for (const name of ['source_generation', 'capture_epoch', 'event_key']) if (typeof value[name] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(value[name])) throw new Error();
    if (typeof value.source_table !== 'string' || !['transfer', 'transfer_hist', 'transfer_old', 'member'].includes(value.source_table)) throw new Error();
    const keys = value.source_table === 'member' ? ['code'] : value.source_table === 'transfer_old' ? ['id'] : ['id', 'requesttime'];
    if (!exact(value.source_key, keys)) throw new Error();
    if (value.source_table === 'member') { if (!text(value.source_key.code, 100)) throw new Error(); }
    else {
      const id = value.source_key.id;
      if (typeof id !== 'string' || !/^(0|-?[1-9]\d{0,9})$/.test(id) || BigInt(id) < -2147483648n || BigInt(id) > 2147483647n) throw new Error();
      if (value.source_table !== 'transfer_old' && !naive(value.source_key.requesttime)) throw new Error();
    }
    if (typeof value.operation !== 'string' || !['snapshot', 'insert', 'update', 'delete'].includes(value.operation)) throw new Error();
    if (typeof value.observed_at !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observed_at) || new Date(value.observed_at).toISOString() !== value.observed_at) throw new Error();
    if (value.operation === 'delete') { if (value.fields !== null) throw new Error(); }
    else if (value.source_table === 'member') {
      if (!exact(value.fields, ['status', 'member_type'])) throw new Error();
      for (const [key, max] of [['status', 16], ['member_type', 20]] as const) if (value.fields[key] !== null && !text(value.fields[key], max, 0)) throw new Error();
    } else {
      if (!exact(value.fields, ['amount', 'ccy', 'result', 'txtime'])) throw new Error();
      if (typeof value.fields.amount !== 'string' || !/^-?(0|[1-9]\d{0,21})\.\d{2}$/.test(value.fields.amount) || !text(value.fields.ccy, 200)) throw new Error();
      if (value.fields.result !== null && !text(value.fields.result, 200, 0)) throw new Error();
      if (value.fields.txtime !== null && !naive(value.fields.txtime)) throw new Error();
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) throw new Error();
    return value as unknown as LocalSourceEvent;
  } catch { throw new IntakeError('INVALID_EVENT'); }
}

export function createSourceIntake(dsn: string) {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local') || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new Error('Synthetic intake supports local/test mode only.');
  const database = createDatabase(dsn, 'intake');
  return {
    close: database.close,
    async append(input: unknown): Promise<{ status: 'inserted' | 'duplicate'; record_id: string; event_id: string }> {
      const event = validateSourceEvent(input);
      let client: PoolClient | undefined;
      let active = false;
      let discard = false;
      try {
        client = await database.pool.connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        active = true;
        const result = await appendSourceEvent(client, event);
        await client.query('COMMIT');
        active = false;
        return result;
      } catch (error) {
        if (active && client) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
        if (error instanceof IntakeError) throw error;
        throw new IntakeError('STORAGE_FAILED');
      } finally { client?.release(discard); }
    },
  };
}

// Caller owns the transaction, including any progress/checkpoint updates.
export async function appendSourceEvent(client: PoolClient, input: unknown): Promise<{ status: 'inserted' | 'duplicate'; record_id: string; event_id: string }> {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local') || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new IntakeError('INVALID_EVENT');
  const event = validateSourceEvent(input);
  const identity = [event.workspace_key, event.source_namespace, event.source_generation, event.source_table, JSON.stringify(event.source_key)];
  const inserted = await client.query('INSERT INTO platform.source_records (workspace_key, source_namespace, source_generation, source_table, source_key) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (workspace_key, source_namespace, source_generation, source_table, source_key) DO NOTHING RETURNING record_id', identity);
  // A separate READ COMMITTED statement sees the committed conflict winner.
  const record = inserted.rows[0] ?? (await client.query('SELECT record_id FROM platform.source_records WHERE workspace_key=$1 AND source_namespace=$2 AND source_generation=$3 AND source_table=$4 AND source_key=$5::jsonb', identity)).rows[0];
  if (!record) throw new Error();
  const scope = [event.workspace_key, event.source_namespace, event.source_generation, event.capture_epoch, event.event_key];
  const evidence = [record.record_id, event.operation, event.observed_at, event.fields === null ? null : JSON.stringify(event.fields)];
  const result = await client.query('INSERT INTO platform.source_events (workspace_key, source_namespace, source_generation, capture_epoch, event_key, record_id, operation, observed_at, fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (workspace_key, source_namespace, source_generation, capture_epoch, event_key) DO NOTHING RETURNING event_id', [...scope, ...evidence]);
  let stored = result.rows[0];
  if (!stored) {
    stored = (await client.query('SELECT event_id, (record_id=$6 AND operation=$7 AND observed_at=$8::timestamptz AND fields IS NOT DISTINCT FROM $9::jsonb) AS matches FROM platform.source_events WHERE workspace_key=$1 AND source_namespace=$2 AND source_generation=$3 AND capture_epoch=$4 AND event_key=$5', [...scope, ...evidence])).rows[0];
    if (!stored?.matches) throw new IntakeError('EVENT_CONFLICT');
  }
  return { status: result.rowCount === 1 ? 'inserted' : 'duplicate', record_id: record.record_id, event_id: stored.event_id };
}
