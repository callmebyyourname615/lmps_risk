import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const HISTORICAL_LIMITS = Object.freeze({ files: 4, rowsPerFile: 16, rows: 64, fileBytes: 3072, contentBytes: 12288 });
export const HISTORICAL_SCHEMA = 'synthetic-history-1|fixture_id|amount:decimal2|currency:USD,THB,LAK|occurred_at:utc_ms|available_at:utc_ms|null';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const HISTORICAL_SCHEMA_HASH = hash(HISTORICAL_SCHEMA);
export interface HistoricalRow { fixture_id: string; amount: string; currency: 'USD' | 'THB' | 'LAK'; occurred_at: string; available_at: string | null }
export interface HistoricalFile { file_id: string; rows: HistoricalRow[] }
export interface HistoricalNamespace { workspace_id: string; run_id: string; dataset_id: string }
export interface HistoricalManifest {
  version: 1; provenance: 'local_synthetic'; execution_mode: 'test'; namespace: HistoricalNamespace;
  schema_hash: string; content_hash: string; row_count: number; content_bytes: number;
  currencies: HistoricalRow['currency'][]; time: { start: string; end: string };
  availability: { available_count: number; unavailable_count: number; latest: string | null };
  files: { file_id: string; content_hash: string; bytes: number; row_count: number }[];
  publication: 'complete';
}
function fail(): never { throw new Error('Invalid local historical dataset; details withheld.'); }
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)) ||
    Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !('value' in d))) fail();
}
function id(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !/^synthetic_[A-Za-z0-9_-]{1,64}$/.test(v) || v.includes('\n')) fail();
}
function time(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) ||
    !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail();
}
function array(v: unknown, maximum: number): asserts v is unknown[] {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length < 1 || v.length > maximum ||
    Reflect.ownKeys(v).length !== v.length + 1 ||
    Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !('value' in d))) fail();
}
/** Fixed canonical row key order; no input schema, serializer, path or code execution. */
export function historicalFileContent(rows: HistoricalRow[]): string {
  return JSON.stringify(rows.map(r => ({ fixture_id: r.fixture_id, amount: r.amount, currency: r.currency,
    occurred_at: r.occurred_at, available_at: r.available_at })));
}
export function createHistoricalManifest(namespace: unknown, input: unknown): HistoricalManifest {
  exact(namespace, ['workspace_id', 'run_id', 'dataset_id']); Object.values(namespace).forEach(id);
  array(input, HISTORICAL_LIMITS.files);
  const seenFiles = new Set<string>(), seenRows = new Set<string>();
  const rows: HistoricalRow[] = [], files: HistoricalManifest['files'] = [];
  for (const file of input) {
    exact(file, ['file_id', 'rows']); id(file.file_id);
    if (seenFiles.has(file.file_id)) fail();
    array(file.rows, HISTORICAL_LIMITS.rowsPerFile);
    seenFiles.add(file.file_id);
    const canonical: HistoricalRow[] = [];
    for (const row of file.rows) {
      exact(row, ['fixture_id', 'amount', 'currency', 'occurred_at', 'available_at']); id(row.fixture_id);
      if (seenRows.has(row.fixture_id) || typeof row.amount !== 'string' || !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(row.amount) || row.amount.includes('\n') ||
        !['USD', 'THB', 'LAK'].includes(row.currency as string)) fail();
      time(row.occurred_at); if (row.available_at !== null) { time(row.available_at); if (row.available_at < row.occurred_at) fail(); }
      seenRows.add(row.fixture_id);
      canonical.push({ fixture_id: row.fixture_id, amount: row.amount, currency: row.currency as HistoricalRow['currency'], occurred_at: row.occurred_at, available_at: row.available_at as string | null });
    }
    rows.push(...canonical);
    const content = historicalFileContent(canonical), bytes = Buffer.byteLength(content);
    if (bytes > HISTORICAL_LIMITS.fileBytes) fail();
    files.push({ file_id: file.file_id, content_hash: hash(content), bytes, row_count: canonical.length });
  }
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  if (rows.length > HISTORICAL_LIMITS.rows || bytes > HISTORICAL_LIMITS.contentBytes) fail();
  const times = rows.map(r => r.occurred_at).sort(), available = rows.flatMap(r => r.available_at === null ? [] : [r.available_at]).sort();
  return { version: 1, provenance: 'local_synthetic', execution_mode: 'test',
    namespace: { workspace_id: namespace.workspace_id as string, run_id: namespace.run_id as string, dataset_id: namespace.dataset_id as string },
    schema_hash: HISTORICAL_SCHEMA_HASH, content_hash: hash(JSON.stringify(files)), row_count: rows.length, content_bytes: bytes,
    currencies: [...new Set(rows.map(r => r.currency))].sort(), time: { start: times[0]!, end: times.at(-1)! },
    availability: { available_count: available.length, unavailable_count: rows.length - available.length, latest: available.at(-1) ?? null },
    files, publication: 'complete' };
}
export function validateHistoricalManifest(manifest: unknown, files: unknown): HistoricalManifest {
  exact(manifest, ['version', 'provenance', 'execution_mode', 'namespace', 'schema_hash', 'content_hash', 'row_count', 'content_bytes', 'currencies', 'time', 'availability', 'files', 'publication']);
  const expected = createHistoricalManifest(manifest.namespace, files);
  if (!isDeepStrictEqual(manifest, expected)) fail();
  return expected;
}
export type HistoricalWriteResult = 'published' | 'acknowledged' | 'conflict';
/** Atomically compare namespace and publish ALL files plus manifest, or nothing.
 * Identical complete bindings acknowledge; changed bindings conflict. Staging stays
 * private. Implementations must serialize concurrent namespace claims. */
export interface HistoricalWriterPort {
  publishComplete(manifest: HistoricalManifest, files: HistoricalFile[]): Promise<HistoricalWriteResult>;
}
export async function writeHistoricalDataset(port: HistoricalWriterPort, manifest: unknown, files: unknown): Promise<HistoricalWriteResult> {
  const checked = validateHistoricalManifest(manifest, files);
  const detached = structuredClone(files) as HistoricalFile[];
  const result = await port.publishComplete(checked, detached);
  if (!['published', 'acknowledged', 'conflict'].includes(result)) fail();
  return result;
}
