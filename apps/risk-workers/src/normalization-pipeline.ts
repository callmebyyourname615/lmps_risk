import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CODEBOOK_VERSION, NORMALIZER_VERSION, normalizeSynthetic, type NormalizationOutcome, type SyntheticNormalizationInput } from './normalization.js';
import { localMode, validateSnapshot } from './snapshot.js';
import { snapshotIdentity } from './sync-job.js';

export const PIPELINE_VERSION = 'synthetic-pipeline-0.1.0-draft.1';
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const MAX_NORMALIZATION_REPORT_BYTES = 4 * 1024 * 1024;
type Supplement = Pick<SyntheticNormalizationInput, 'operation_code' | 'status_code' | 'reversal_code' | 'synthetic_payment_ref' | 'reversal_evidence'> & { event_key: string };
export interface SyntheticSnapshotEvidence {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; codebook_version: typeof CODEBOOK_VERSION;
  capture_id: string; snapshot_sha256: string; entries: Supplement[];
}
type Row = {
  source: { workspace_key: string; source_namespace: string; source_generation: string; capture_epoch: string;
    event_key: string; source_table: string; source_key: Record<string, string>; operation: string; observed_at: string };
  state: NormalizationOutcome['state']; reason_codes: string[]; normalization: NormalizationOutcome | null;
};
export interface SnapshotNormalizationReport {
  format: 1; pipeline_version: typeof PIPELINE_VERSION; codebook_version: typeof CODEBOOK_VERSION; normalizer_version: typeof NORMALIZER_VERSION;
  provenance: 'local_synthetic'; execution_mode: 'test'; canonical_emission: false;
  capture_id: string; snapshot_sha256: string; evidence_sha256: string | null; evidence_status: 'absent' | 'provided';
  scope: 'frozen_synthetic_snapshot'; source_semantics: 'unverified'; account_identity: 'unresolved';
  counts: { total: number; known: number; unknown: number; invalid: number }; rows: Row[];
}
const canonical = (input: unknown) => JSON.stringify(input, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
const ENTRY_KEYS = ['event_key', 'operation_code', 'status_code', 'reversal_code', 'synthetic_payment_ref', 'reversal_evidence'];

// Evidence supplies only invented semantic codes; source money/time/keys always come from the frozen snapshot.
export function normalizeSnapshot(input: unknown, supplement?: unknown): SnapshotNormalizationReport {
  try {
    localMode();
    const snapshot = validateSnapshot(input); const identity = snapshotIdentity(snapshot);
    const entries = new Map<string, Supplement>();
    let evidenceHash: string | null = null;
    if (supplement !== undefined) {
      const evidence: unknown = structuredClone(supplement);
      if (!object(evidence) || Object.keys(evidence).sort().join(',') !== 'capture_id,codebook_version,entries,execution_mode,format,provenance,snapshot_sha256'
        || evidence.format !== 1 || evidence.provenance !== 'local_synthetic' || evidence.execution_mode !== 'test' || evidence.codebook_version !== CODEBOOK_VERSION
        || evidence.capture_id !== snapshot.capture_id || evidence.snapshot_sha256 !== identity.snapshot_sha256
        || !Array.isArray(evidence.entries) || evidence.entries.length > 400 || Buffer.byteLength(JSON.stringify(evidence)) > MAX_EVIDENCE_BYTES) throw new Error();
      if (!isDeepStrictEqual(evidence, JSON.parse(JSON.stringify(evidence)))) throw new Error();
      const sourceEvents = new Map(snapshot.events.map(event => [event.event_key, event]));
      for (const entry of evidence.entries) {
        if (!object(entry) || Object.keys(entry).some(key => !ENTRY_KEYS.includes(key)) || typeof entry.event_key !== 'string') throw new Error();
        const event = sourceEvents.get(entry.event_key);
        if (!event || event.source_table === 'member' || entries.has(entry.event_key)) throw new Error();
        entries.set(entry.event_key, entry as Supplement);
      }
      // Entry order and JSON formatting do not change frozen semantic-evidence identity.
      evidenceHash = createHash('sha256').update(canonical({ ...evidence, entries: [...entries.values()].sort((a, b) => a.event_key < b.event_key ? -1 : a.event_key > b.event_key ? 1 : 0) })).digest('hex');
    }
    const report: SnapshotNormalizationReport = { format: 1, pipeline_version: PIPELINE_VERSION, codebook_version: CODEBOOK_VERSION, normalizer_version: NORMALIZER_VERSION,
      provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false, capture_id: snapshot.capture_id, snapshot_sha256: identity.snapshot_sha256,
      evidence_sha256: evidenceHash, evidence_status: supplement === undefined ? 'absent' : 'provided', scope: 'frozen_synthetic_snapshot',
      source_semantics: 'unverified', account_identity: 'unresolved', counts: { total: snapshot.events.length, known: 0, unknown: 0, invalid: 0 }, rows: [] };
    for (const event of snapshot.events) {
      const source = { workspace_key: event.workspace_key, source_namespace: event.source_namespace, source_generation: event.source_generation,
        capture_epoch: event.capture_epoch, event_key: event.event_key, source_table: event.source_table, source_key: { ...event.source_key },
        operation: event.operation, observed_at: event.observed_at };
      const entry = entries.get(event.event_key);
      let normalization: NormalizationOutcome | null = null;
      if (entry) {
        const { event_key: _key, ...codes } = entry;
        normalization = normalizeSynthetic({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', codebook_version: CODEBOOK_VERSION,
          source_reference: { namespace: event.source_namespace, record_ref: event.event_key }, observed_at: event.observed_at,
          amount: event.fields!.amount, currency: event.fields!.ccy, source_time: event.fields!.txtime, ...codes });
      }
      const state = normalization?.state ?? 'unknown';
      const reason_codes = normalization?.reason_codes ?? [event.source_table === 'member' ? 'UNSUPPORTED_SOURCE_RECORD' : 'SYNTHETIC_EVIDENCE_MISSING'];
      report.rows.push({ source, state, reason_codes, normalization }); report.counts[state]++;
    }
    if (Buffer.byteLength(JSON.stringify(report)) > MAX_NORMALIZATION_REPORT_BYTES) throw new Error();
    return report;
  } catch { throw new Error('Local normalization pipeline rejected snapshot or evidence; details withheld.'); }
}
