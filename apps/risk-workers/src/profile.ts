import { TABLES, MAX_TABLE_ROWS, validateSnapshot } from './snapshot.js';
import { snapshotIdentity } from './sync-job.js';

export const PROFILE_VERSION = 1;
export const MAX_PROFILE_BYTES = 1024 * 1024;
type FieldStats = { non_null_rows: number; null_rows: number; empty_rows: number; distinct_non_null: number };
type CodeCount = { value: string | null; rows: number };
type TimeRange = { projection: 'included' | 'not_in_projection'; non_null_rows: number; min: string | null; max: string | null };
type AmountGroup = { raw_currency: string; rows: number; positive_rows: number; zero_rows: number; negative_rows: number;
  observed_amount_sum: string; min: string; max: string };
type TableProfile = { observed_rows: number; fields: Record<string, FieldStats>; raw_code_counts: Record<string, CodeCount[]>;
  source_naive_times: { requesttime: TimeRange; txtime: TimeRange }; amounts_by_raw_currency: AmountGroup[] };
export type SnapshotProfile = {
  profile_version: 1; provenance: 'local_synthetic'; execution_mode: 'test'; capture_id: string; snapshot_sha256: string;
  scope: 'observed_snapshot_rows'; observed_rows: number; observed_at_utc: string | null;
  source_completeness: 'unverified'; source_timezone: 'unverified'; currency_and_status_semantics: 'unverified';
  account_identity: 'not_observed'; business_payment_deduplication: 'not_performed';
  target_reconciliation: 'not_checked'; job_fingerprint_binding: 'not_checked';
  amount_representation: 'source_fixed_two_decimal_strings'; max_input_rows: number;
  tables: Record<string, TableProfile>;
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function stats(values: (string | null)[]): FieldStats {
  return { non_null_rows: values.filter(value => value !== null).length, null_rows: values.filter(value => value === null).length,
    empty_rows: values.filter(value => value === '').length, distinct_non_null: new Set(values.filter(value => value !== null)).size };
}
function codes(values: (string | null)[]): CodeCount[] {
  const counts = new Map<string | null, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a === b ? 0 : a === null ? -1 : b === null ? 1 : compare(a, b)).map(([value, rows]) => ({ value, rows }));
}
function timeRange(values: (string | null)[], included: boolean): TimeRange {
  const observed = values.filter((value): value is string => value !== null).sort(compare);
  return { projection: included ? 'included' : 'not_in_projection', non_null_rows: observed.length, min: observed[0] ?? null, max: observed.at(-1) ?? null };
}
function decimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}

// shortcut: profile validated, bounded snapshots only; approved raw-extract profiling needs its own ingestion/DQ contract.
export function profileSnapshot(input: unknown): SnapshotProfile {
  const snapshot = validateSnapshot(input); const identity = snapshotIdentity(snapshot);
  const tables: Record<string, TableProfile> = {};
  for (const table of TABLES) {
    const events = snapshot.events.filter(event => event.source_table === table);
    const fieldNames = table === 'member' ? ['status', 'member_type'] : ['amount', 'ccy', 'result', 'txtime'];
    const codeNames = table === 'member' ? ['status', 'member_type'] : ['ccy', 'result'];
    const groups = new Map<string, { values: bigint[] }>();
    if (table !== 'member') for (const event of events) {
      const currency = event.fields!.ccy!;
      const group = groups.get(currency) ?? { values: [] };
      // Validated event contract requires exactly two decimal places; BigInt avoids Number rounding/overflow.
      group.values.push(BigInt(event.fields!.amount!.replace('.', ''))); groups.set(currency, group);
    }
    const amounts = [...groups].sort(([a], [b]) => compare(a, b)).map(([raw_currency, { values }]): AmountGroup => {
      let sum = 0n; let min = values[0]!; let max = min; let positive = 0; let zero = 0; let negative = 0;
      for (const value of values) { sum += value; if (value < min) min = value; if (value > max) max = value; if (value > 0n) positive++; else if (value < 0n) negative++; else zero++; }
      return { raw_currency, rows: values.length, positive_rows: positive, zero_rows: zero, negative_rows: negative,
        observed_amount_sum: decimal(sum), min: decimal(min), max: decimal(max) };
    });
    tables[table] = { observed_rows: events.length,
      fields: Object.fromEntries(fieldNames.map(name => [name, stats(events.map(event => event.fields![name]!))])),
      raw_code_counts: Object.fromEntries(codeNames.map(name => [name, codes(events.map(event => event.fields![name]!))])),
      source_naive_times: {
        requesttime: timeRange(events.map(event => event.source_key.requesttime ?? null), table === 'transfer' || table === 'transfer_hist'),
        txtime: timeRange(events.map(event => event.fields!.txtime ?? null), table !== 'member'),
      }, amounts_by_raw_currency: amounts };
  }
  const profile: SnapshotProfile = { profile_version: PROFILE_VERSION, provenance: 'local_synthetic', execution_mode: 'test', capture_id: snapshot.capture_id,
    snapshot_sha256: identity.snapshot_sha256, scope: 'observed_snapshot_rows', observed_rows: snapshot.events.length, observed_at_utc: snapshot.events[0]?.observed_at ?? null,
    source_completeness: 'unverified', source_timezone: 'unverified', currency_and_status_semantics: 'unverified', account_identity: 'not_observed',
    business_payment_deduplication: 'not_performed', target_reconciliation: 'not_checked', job_fingerprint_binding: 'not_checked',
    amount_representation: 'source_fixed_two_decimal_strings', max_input_rows: TABLES.length * MAX_TABLE_ROWS, tables };
  if (Buffer.byteLength(JSON.stringify(profile)) > MAX_PROFILE_BYTES) throw new Error('Local profile exceeds its size bound.');
  return profile;
}
