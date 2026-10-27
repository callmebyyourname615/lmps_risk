import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ConnectionOptions } from 'node:tls';
import mariadb, { type Connection } from 'mariadb';

type Row = Record<string, unknown>;
export type Reason = 'PERMISSION_DENIED' | 'TIMEOUT' | 'QUERY_FAILED' | 'INVALID_METADATA' | 'NOT_RUN' | 'UNSUPPORTED_SERVER' | 'NOT_RETURNED';
export type Fact<T> = { status: 'OBSERVED'; value: T } | { status: 'UNVERIFIED'; reason: Reason };
export interface LocalConfig {
  kind: 'local_synthetic'; host: '127.0.0.1'; port: number;
  database: 'lmps_source_local'; user: 'lmps_preflight'; password: string; caFile: string;
}
interface Column { name: string; data_type: string; numeric_parameters: number[]; nullable: boolean }
interface Table { primary_key: string[]; unique_keys: string[][]; column_candidates: Column[] }
interface Mapping { source_tables: Record<string, Table> }
const mapping = JSON.parse(await readFile(new URL('../../../docs/data-dictionary/source-mapping.json', import.meta.url), 'utf8')) as Mapping;
export const TABLES = Object.freeze(['transfer', 'transfer_hist', 'transfer_old', 'member']);
export const SQL = Object.freeze({
  readonly: 'START TRANSACTION READ ONLY',
  version: 'SELECT VERSION() AS version',
  variables: "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('read_only','log_bin','log_slave_updates','binlog_format','binlog_row_image','gtid_strict_mode','gtid_binlog_pos','gtid_slave_pos','slave_parallel_threads','slave_parallel_mode','binlog_expire_logs_seconds','expire_logs_days')",
  replication: 'SHOW ALL REPLICAS STATUS',
  tables: 'SELECT TABLE_NAME, ENGINE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?,?,?,?) ORDER BY TABLE_NAME LIMIT 5',
  columns: 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?,?,?,?) ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 257',
  indexes: 'SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?,?,?,?) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX LIMIT 257',
});

export function validateConfig(input: unknown): LocalConfig {
  const value = input as Partial<LocalConfig> | null;
  const authentication = value?.password;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'caFile,database,host,kind,password,port,user'
    || value.kind !== 'local_synthetic' || value.host !== '127.0.0.1' || value.database !== 'lmps_source_local'
    || value.user !== 'lmps_preflight' || !Number.isInteger(value.port) || value.port! < 1024 || value.port! > 65535
    || typeof authentication !== 'string' || authentication.length < 16 || authentication.length > 128
    || typeof value.caFile !== 'string' || !isAbsolute(value.caFile)) throw new Error('Invalid local preflight configuration.');
  return value as LocalConfig;
}

const unknown = <T>(reason: Reason): Fact<T> => ({ status: 'UNVERIFIED', reason });
const observed = <T>(value: T): Fact<T> => ({ status: 'OBSERVED', value });

function reason(error: unknown): Reason {
  const code = (error as { errno?: number })?.errno;
  if (code && [1044, 1045, 1142, 1227].includes(code)) return 'PERMISSION_DENIED';
  if (code === 1969 || ['ER_SOCKET_TIMEOUT', 'ER_QUERY_TIMEOUT'].includes(String((error as { code?: string })?.code))) return 'TIMEOUT';
  return 'QUERY_FAILED';
}

function unsigned(value: unknown): string | null {
  const text = typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return /^\d{1,20}$/.test(text) ? text : null;
}

function numeric(value: unknown): number | null {
  const text = unsigned(value);
  if (text === null) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

export function sanitizeVersion(rows: Row[]): Fact<string> {
  const value = rows[0]?.version;
  if (typeof value !== 'string' || !value.includes('MariaDB')) return unknown('UNSUPPORTED_SERVER');
  const version = value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})-MariaDB(?:\b|-)/)?.[1];
  return version ? observed(version) : unknown('INVALID_METADATA');
}

export function sanitizeVariables(rows: Row[]): Record<string, Fact<string | boolean>> {
  const booleans = ['read_only', 'log_bin', 'log_slave_updates', 'gtid_strict_mode'];
  const numericNames = ['slave_parallel_threads', 'binlog_expire_logs_seconds', 'expire_logs_days'];
  const enums: Record<string, string[]> = { binlog_format: ['ROW', 'MIXED', 'STATEMENT'], binlog_row_image: ['FULL', 'MINIMAL', 'NOBLOB'], slave_parallel_mode: ['none', 'conservative', 'optimistic', 'aggressive', 'minimal'] };
  const result: Record<string, Fact<string | boolean>> = {};
  for (const name of [...booleans, ...numericNames, ...Object.keys(enums), 'gtid_binlog_pos', 'gtid_slave_pos']) {
    const value = rows.find(row => row.Variable_name === name)?.Value;
    if (value === undefined) { result[name] = unknown('NOT_RETURNED'); continue; }
    if (booleans.includes(name)) result[name] = typeof value === 'string' && ['ON', 'OFF'].includes(value) ? observed(value === 'ON') : unknown('INVALID_METADATA');
    else if (name === 'expire_logs_days') result[name] = typeof value === 'string' && /^\d{1,10}(\.\d{1,6})?$/.test(value) ? observed(value) : unknown('INVALID_METADATA');
    else if (numericNames.includes(name)) result[name] = unsigned(value) !== null ? observed(String(value)) : unknown('INVALID_METADATA');
    else if (enums[name]) result[name] = typeof value === 'string' && enums[name]!.includes(value) ? observed(value) : unknown('INVALID_METADATA');
    else result[name] = typeof value === 'string' && (value === '' || /^\d+-\d+-\d+(,\d+-\d+-\d+)*$/.test(value)) ? observed(value ? 'present' : 'empty') : unknown('INVALID_METADATA');
  }
  return result;
}

export function sanitizeReplication(rows: Row[]): Fact<{ channel_count: number; channels: Row[] }> {
  if (rows.length > 32) return unknown('INVALID_METADATA');
  return observed({ channel_count: rows.length, channels: rows.map(row => ({
    io_running: ['Yes', 'No', 'Connecting'].includes(String(row.Slave_IO_Running)) ? row.Slave_IO_Running : 'UNVERIFIED',
    sql_running: ['Yes', 'No'].includes(String(row.Slave_SQL_Running)) ? row.Slave_SQL_Running : 'UNVERIFIED',
    lag_seconds: row.Seconds_Behind_Master === null ? null : unsigned(row.Seconds_Behind_Master),
    last_io_errno: unsigned(row.Last_IO_Errno), last_sql_errno: unsigned(row.Last_SQL_Errno),
  })) });
}

export function compareSchema(tables: Row[], columns: Row[], indexes: Row[]) {
  return Object.fromEntries(TABLES.map(name => {
    const expected = mapping.source_tables[name]!;
    const table = tables.find(row => row.TABLE_NAME === name);
    if (!table) return [name, { status: 'UNVERIFIED', reason: 'TABLE_NOT_VISIBLE' }];
    const differences: { column?: string; issue: string }[] = [];
    for (const expectedColumn of expected.column_candidates) {
      const actual = columns.find(row => row.TABLE_NAME === name && row.COLUMN_NAME === expectedColumn.name);
      let issue;
      if (!actual) issue = 'MISSING_OR_NOT_VISIBLE';
      else if (actual.DATA_TYPE !== expectedColumn.data_type) issue = 'TYPE_MISMATCH';
      else if (actual.IS_NULLABLE !== (expectedColumn.nullable ? 'YES' : 'NO')) issue = 'NULLABILITY_MISMATCH';
      else if (actual.DATA_TYPE === 'varchar' && numeric(actual.CHARACTER_MAXIMUM_LENGTH) !== expectedColumn.numeric_parameters[0]) issue = 'LENGTH_MISMATCH';
      else if (actual.DATA_TYPE === 'decimal' && (numeric(actual.NUMERIC_PRECISION) !== expectedColumn.numeric_parameters[0] || numeric(actual.NUMERIC_SCALE) !== expectedColumn.numeric_parameters[1])) issue = 'PRECISION_SCALE_MISMATCH';
      else if (actual.DATA_TYPE === 'datetime' && numeric(actual.DATETIME_PRECISION) !== (expectedColumn.numeric_parameters[0] ?? 0)) issue = 'DATETIME_PRECISION_MISMATCH';
      if (issue) differences.push({ column: expectedColumn.name, issue });
    }
    const groups = new Map<string, Row[]>();
    for (const row of indexes.filter(row => row.TABLE_NAME === name && numeric(row.NON_UNIQUE) === 0)) {
      const key = String(row.INDEX_NAME);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const keys = [...groups].map(([key, rows]) => ({ primary: key === 'PRIMARY', columns: [...rows].sort((a, b) => (numeric(a.SEQ_IN_INDEX) ?? 0) - (numeric(b.SEQ_IN_INDEX) ?? 0)).map(row => row.COLUMN_NAME), prefix: rows.some(row => row.SUB_PART !== null) }));
    const primary = keys.find(key => key.primary);
    const unique = keys.filter(key => !key.primary).map(key => JSON.stringify(key.columns)).sort();
    if (!primary || JSON.stringify(primary.columns) !== JSON.stringify(expected.primary_key) || keys.some(key => key.prefix) || JSON.stringify(unique) !== JSON.stringify(expected.unique_keys.map(key => JSON.stringify(key)).sort())) differences.push({ issue: 'KEYS_DIFFER_OR_NOT_VISIBLE' });
    return [name, { status: differences.length ? 'MISMATCH' : 'OBSERVED', selected_columns_checked: expected.column_candidates.length, row_estimate: unsigned(table.TABLE_ROWS), estimate_is_exact: false, differences }];
  }));
}

export async function inspect(input: unknown) {
  const config = validateConfig(input);
  const report: Record<string, unknown> = {
    report_version: 1, provenance: 'local_synthetic', full_source_ddl_verified: false,
    cdc_readiness_approved: false, account_identity_verified: false,
    schema_consistency: 'best_effort_metadata_only', status: 'partial',
    version: unknown('NOT_RUN'), variables: unknown('NOT_RUN'), replication: unknown('NOT_RUN'), schema: unknown('NOT_RUN'),
  };
  let connection: Connection | undefined;
  let expired = false;
  try {
    const ssl = { ca: await readFile(config.caFile, 'utf8'), servername: 'localhost', rejectUnauthorized: true, minVersion: 'TLSv1.2' } satisfies ConnectionOptions;
    connection = await mariadb.createConnection({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
      ssl,
      connectTimeout: 1000, socketTimeout: 1500, maxAllowedPacket: 1024 * 1024,
      multipleStatements: false, permitLocalInfile: false, trace: false, decimalAsNumber: false, bigIntAsNumber: false });
    connection.on('error', () => {}); // Driver diagnostics may contain connection details.
    const deadline = Date.now() + 8000;
    async function bounded(sql: string, parameters: unknown[]) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          connection!.query({ sql, timeout: 800 }, parameters),
          new Promise<never>((_, reject) => { timer = setTimeout(() => {
            expired = true;
            connection?.destroy();
            reject(new Error('Metadata deadline exceeded.'));
          }, Math.max(1, Math.min(1000, deadline - Date.now()))); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    async function query(sql: string, parameters: unknown[] = [], limit = 256): Promise<Fact<Row[]>> {
      if (expired) return unknown('TIMEOUT');
      try {
        const result: unknown = await bounded(sql, parameters);
        if (!Array.isArray(result) || result.length > limit || result.some(row => !row || typeof row !== 'object')) return unknown('INVALID_METADATA');
        return observed(result as Row[]);
      } catch (error) {
        const category = expired ? 'TIMEOUT' : reason(error);
        if (category === 'TIMEOUT') { expired = true; connection?.destroy(); }
        return unknown(category);
      }
    }
    await bounded(SQL.readonly, []);
    const version = await query(SQL.version, [], 1);
    report.version = version.status === 'OBSERVED' ? sanitizeVersion(version.value) : version;
    if ((report.version as Fact<string>).status !== 'OBSERVED') return report;
    const variables = await query(SQL.variables, [], 16);
    report.variables = variables.status === 'OBSERVED' ? sanitizeVariables(variables.value) : variables;
    const replication = await query(SQL.replication, [], 32);
    report.replication = replication.status === 'OBSERVED' ? sanitizeReplication(replication.value) : replication;
    const parameters = [config.database, ...TABLES];
    const tables = await query(SQL.tables, parameters, 4);
    const columns = await query(SQL.columns, parameters);
    const indexes = await query(SQL.indexes, parameters);
    report.schema = tables.status === 'OBSERVED' && columns.status === 'OBSERVED' && indexes.status === 'OBSERVED' ? compareSchema(tables.value, columns.value, indexes.value) : [tables, columns, indexes].find(fact => fact.status === 'UNVERIFIED');
    const json = JSON.stringify(report);
    if (!json.includes('UNVERIFIED') && !json.includes('MISMATCH')) report.status = 'complete_for_local_metadata';
    return report;
  } catch {
    throw new Error('Local metadata preflight failed; connection/transport details withheld.');
  } finally {
    connection?.destroy();
  }
}
