import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ConnectionOptions } from 'node:tls';
import mariadb, { type Connection } from 'mariadb';
import { createSourceIntake, IntakeError, validateSourceEvent, type LocalSourceEvent } from '@lmps/database';

export const TABLES = ['transfer', 'transfer_hist', 'transfer_old', 'member'] as const;
export const BATCH_SIZE = 25;
export const MAX_TABLE_ROWS = 100;
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Table = typeof TABLES[number];
export interface ReaderConfig {
  kind: 'local_synthetic'; host: '127.0.0.1'; port: number;
  database: 'lmps_source_local'; user: 'lmps_snapshot'; password: string;
  caFile: string; sourceGeneration: string;
}
export interface Snapshot { format: 1; capture_id: string; events: LocalSourceEvent[] }
export type ImportReport = { status: 'complete' | 'failed'; total: number; inserted: number; duplicate: number; conflict: number; failed: number; unattempted: number };
export class SnapshotError extends Error {
  constructor(readonly code: 'INVALID_CONFIG' | 'CAPTURE_FAILED' | 'INVALID_SNAPSHOT') {
    super(`Local synthetic snapshot: ${code}; diagnostic details withheld.`);
    this.name = 'SnapshotError';
  }
}

export function localMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local') || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new SnapshotError('INVALID_CONFIG');
}
export function validateConfig(input: unknown): ReaderConfig {
  localMode();
  const value = input as Partial<ReaderConfig> | null;
  const authentication = value?.password;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'caFile,database,host,kind,password,port,sourceGeneration,user'
    || value.kind !== 'local_synthetic' || value.host !== '127.0.0.1' || value.database !== 'lmps_source_local' || value.user !== 'lmps_snapshot'
    || !Number.isInteger(value.port) || value.port! < 1024 || value.port! > 65535
    || typeof authentication !== 'string' || authentication.length < 16 || authentication.length > 128
    || typeof value.caFile !== 'string' || !isAbsolute(value.caFile)
    || typeof value.sourceGeneration !== 'string' || !UUID.test(value.sourceGeneration)) throw new SnapshotError('INVALID_CONFIG');
  return { ...value } as ReaderConfig;
}

function eventFor(table: Table, row: Record<string, unknown>, generation: string, epoch: string, observed: string, ordinal: number): LocalSourceEvent {
  return validateSourceEvent({
    schema_version: 1, provenance: 'local_synthetic', execution_mode: 'test',
    workspace_key: 'synthetic_local', source_namespace: 'synthetic_snapshot', source_generation: generation,
    capture_epoch: epoch, event_key: `${table}:${ordinal}`, source_table: table,
    source_key: table === 'member' ? { code: row.code } : table === 'transfer_old' ? { id: row.id } : { id: row.id, requesttime: row.requesttime },
    operation: 'snapshot', observed_at: observed,
    fields: table === 'member' ? { status: row.status, member_type: row.member_type } : { amount: row.amount, ccy: row.ccy, result: row.result, txtime: row.txtime },
  });
}

// Fixed table/column allowlist; key predicates use the original PK types, never OFFSET or SELECT *.
export function pageQuery(table: Table, cursor?: Record<string, string>) {
  if (!TABLES.includes(table)) throw new SnapshotError('INVALID_CONFIG');
  const keys = table === 'member' ? ['code'] : table === 'transfer_old' ? ['id'] : ['id', 'requesttime'];
  const columns = table === 'member' ? 'code,status,member_type' : `CAST(id AS CHAR) AS id,${table === 'transfer_old' ? '' : 'requesttime,'}amount,ccy,result,txtime`;
  const parameters: string[] = [];
  let where = '';
  if (cursor) {
    where = keys.length === 2 ? ' WHERE (id > ? OR (id = ? AND requesttime > ?))' : ` WHERE ${keys[0]} > ?`;
    parameters.push(cursor[keys[0]!]!);
    if (keys.length === 2) parameters.push(cursor.id!, cursor.requesttime!);
  }
  return { sql: `SELECT ${columns} FROM \`${table}\`${where} ORDER BY ${keys.map(key => `\`${table}\`.${key}`).join(',')} LIMIT ${BATCH_SIZE}`, parameters };
}

export async function captureSnapshot(input: unknown): Promise<Snapshot> {
  const config = validateConfig(input);
  let connection: Connection | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const ssl = { ca: await readFile(config.caFile, 'utf8'), servername: 'localhost', rejectUnauthorized: true, minVersion: 'TLSv1.2' } satisfies ConnectionOptions;
    connection = await mariadb.createConnection({
      host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
      ssl,
      connectTimeout: 1000, socketTimeout: 1500, maxAllowedPacket: 1024 * 1024,
      multipleStatements: false, permitLocalInfile: false, trace: false,
      decimalAsNumber: false, bigIntAsNumber: false, dateStrings: true,
    });
    connection.on('error', () => {});
    const expired = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => { connection?.destroy(); reject(new SnapshotError('CAPTURE_FAILED')); }, 10000);
    });
    const query = (sql: string, parameters: unknown[] = []) => Promise.race([connection!.query({ sql, timeout: 800 }, parameters), expired]);
    const server = await query('SELECT VERSION() AS version, @@port AS port, @@global.read_only AS readonly');
    if (!/^11\.8\.\d+-MariaDB/.test(server[0]?.version) || Number(server[0]?.port) !== config.port || Number(server[0]?.readonly) !== 1) throw new Error();
    await query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const snapshot: Snapshot = { format: 1, capture_id: randomUUID(), events: [] };
    const observed = new Date().toISOString();
    for (const table of TABLES) {
      let cursor: Record<string, string> | undefined;
      let count = 0;
      while (true) {
        const page = pageQuery(table, cursor);
        const rows: unknown = await query(page.sql, page.parameters);
        if (!Array.isArray(rows) || rows.length > BATCH_SIZE) throw new Error();
        for (const row of rows) {
          if (++count > MAX_TABLE_ROWS) throw new Error();
          const event = eventFor(table, row, config.sourceGeneration, snapshot.capture_id, observed, count);
          snapshot.events.push(event);
          cursor = event.source_key;
        }
        if (rows.length < BATCH_SIZE) break;
        await new Promise(accept => setTimeout(accept, 10));
      }
    }
    // All four accessed tables now hold metadata locks; reject a nontransactional engine before publishing.
    const engines = await query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?,?,?,?)', [config.database, ...TABLES]);
    if (engines.length !== 4 || TABLES.some(table => !engines.some((row: Record<string, unknown>) => row.TABLE_NAME === table && row.ENGINE === 'InnoDB'))) throw new Error();
    await query('COMMIT');
    return validateSnapshot(snapshot);
  } catch { throw new SnapshotError('CAPTURE_FAILED'); }
  finally { clearTimeout(watchdog); connection?.destroy(); }
}

export function validateSnapshot(input: unknown): Snapshot {
  localMode();
  try {
    const value = structuredClone(input) as Snapshot;
    if (!value || Object.keys(value).sort().join(',') !== 'capture_id,events,format' || value.format !== 1 || typeof value.capture_id !== 'string' || !UUID.test(value.capture_id)
      || !Array.isArray(value.events) || value.events.length > MAX_TABLE_ROWS * TABLES.length || Buffer.byteLength(JSON.stringify(value)) > MAX_SNAPSHOT_BYTES) throw new Error();
    const counts = new Map<string, number>();
    const records = new Set<string>();
    let generation: string | undefined; let observed: string | undefined; let previousTable = -1;
    for (const inputEvent of value.events) {
      const event = validateSourceEvent(inputEvent);
      const table = TABLES.indexOf(event.source_table);
      const ordinal = (counts.get(event.source_table) ?? 0) + 1;
      generation ??= event.source_generation; observed ??= event.observed_at;
      const identity = JSON.stringify([event.source_table, event.source_key.id ?? event.source_key.code, event.source_key.requesttime]);
      if (event.workspace_key !== 'synthetic_local' || event.source_namespace !== 'synthetic_snapshot' || !UUID.test(event.source_generation)
        || event.source_generation !== generation || event.observed_at !== observed || event.capture_epoch !== value.capture_id || event.operation !== 'snapshot'
        || event.event_key !== `${event.source_table}:${ordinal}` || ordinal > MAX_TABLE_ROWS || table < previousTable || records.has(identity)) throw new Error();
      previousTable = table; counts.set(event.source_table, ordinal); records.add(identity);
    }
    return value;
  } catch { throw new SnapshotError('INVALID_SNAPSHOT'); }
}

export async function importSnapshot(input: unknown, dsn: string): Promise<ImportReport> {
  const snapshot = validateSnapshot(input);
  const intake = createSourceIntake(dsn);
  const report: ImportReport = { status: 'complete', total: snapshot.events.length, inserted: 0, duplicate: 0, conflict: 0, failed: 0, unattempted: snapshot.events.length };
  try {
    for (const event of snapshot.events) {
      report.unattempted--;
      try { report[(await intake.append(event)).status]++; }
      catch (error) {
        report.status = 'failed';
        if (error instanceof IntakeError && error.code === 'EVENT_CONFLICT') report.conflict++;
        else report.failed++;
        break;
      }
    }
    return report;
  } finally { await intake.close(); }
}
