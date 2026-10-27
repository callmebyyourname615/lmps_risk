import { isDeepStrictEqual } from 'node:util';
import { createDatabase } from '@lmps/database';
import { MAX_TABLE_ROWS, TABLES, validateSnapshot } from './snapshot.js';

type Counts = { expected: number; observed: number; matched: number; missing: number; mismatched: number; unexpected: number };
export interface ReconciliationReport {
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'LIMIT_EXCEEDED';
  expected: number;
  observed: number | null;
  observed_is_exact: boolean;
  matched: number | null; missing: number | null; mismatched: number | null; unexpected: number | null;
  by_table: Record<string, Counts> | null;
}
const LIMIT = MAX_TABLE_ROWS * TABLES.length;

export async function reconcileSnapshot(input: unknown, dsn: string): Promise<ReconciliationReport> {
  const snapshot = validateSnapshot(input);
  const database = createDatabase(dsn);
  const unavailable: ReconciliationReport = { status: 'UNAVAILABLE', expected: snapshot.events.length, observed: null, observed_is_exact: false, matched: null, missing: null, mismatched: null, unexpected: null, by_table: null };
  try {
    // One bounded statement sees one MVCC snapshot, including all generations for this capture.
    const result = await database.pool.query(`SELECT e.source_generation, e.event_key, e.operation, e.fields, e.schema_version,
      to_char(e.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
      r.source_table, r.source_key, r.provenance, r.execution_mode
      FROM platform.source_events e JOIN platform.source_records r
        ON (r.workspace_key,r.source_namespace,r.source_generation,r.record_id)=(e.workspace_key,e.source_namespace,e.source_generation,e.record_id)
      WHERE e.workspace_key=$1 AND e.source_namespace=$2 AND e.capture_epoch=$3
      ORDER BY e.source_generation,e.event_key LIMIT ${LIMIT + 1}`, ['synthetic_local', 'synthetic_snapshot', snapshot.capture_id]);
    if (result.rows.length > LIMIT) return { ...unavailable, status: 'LIMIT_EXCEEDED', observed: result.rows.length };
    const expected = new Map(snapshot.events.map(event => [JSON.stringify([event.source_generation, event.event_key]), event]));
    const by_table: Record<string, Counts> = Object.fromEntries(TABLES.map(table => [table, { expected: 0, observed: 0, matched: 0, missing: 0, mismatched: 0, unexpected: 0 }]));
    for (const event of snapshot.events) by_table[event.source_table]!.expected++;
    const report: ReconciliationReport = { status: 'PASS', expected: snapshot.events.length, observed: result.rows.length, observed_is_exact: true, matched: 0, missing: 0, mismatched: 0, unexpected: 0, by_table };
    for (const row of result.rows) {
      const key = JSON.stringify([row.source_generation, row.event_key]);
      const event = expected.get(key);
      by_table[row.source_table]!.observed++;
      if (!event) { report.unexpected!++; by_table[row.source_table]!.unexpected++; continue; }
      expected.delete(key);
      const matches = isDeepStrictEqual(row, {
        source_generation: event.source_generation, event_key: event.event_key,
        operation: event.operation, fields: event.fields, schema_version: event.schema_version,
        observed_at: event.observed_at.slice(0, -1) + '000Z', source_table: event.source_table,
        source_key: event.source_key, provenance: event.provenance, execution_mode: event.execution_mode,
      });
      const outcome = matches ? 'matched' : 'mismatched';
      report[outcome]!++; by_table[event.source_table]![outcome]++;
    }
    for (const event of expected.values()) { report.missing!++; by_table[event.source_table]!.missing++; }
    if (report.missing || report.mismatched || report.unexpected) report.status = 'FAIL';
    return report;
  } catch { return unavailable; }
  finally { await database.close(); }
}
