import { isDeepStrictEqual } from 'node:util';
import { createTransactionRevisions, TransactionRevisionError, type LocalTransactionRevision } from '@lmps/database';
import { PUBLISHER_VERSION, publicationIdentity, publicationTransaction, validatePublicationBinding, type PublicationBinding } from '@lmps/contracts/synthetic-publication';
import { normalizeSnapshot } from './normalization-pipeline.js';

export const MAX_PUBLICATION_MANIFEST_BYTES = 512 * 1024;
export interface PublicationManifest {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; publisher_version: typeof PUBLISHER_VERSION;
  capture_id: string; snapshot_sha256: string; evidence_sha256: string; bindings: PublicationBinding[];
}
export interface PublicationPlan {
  capture_id: string; total: number;
  withheld: { event_key: string; reason_codes: string[] }[];
  revisions: LocalTransactionRevision[];
}

// Read frozen source + semantic evidence again; never trust a caller-supplied normalization report.
export function planPublications(snapshot: unknown, evidence: unknown, input: unknown): PublicationPlan {
  try {
    const report = normalizeSnapshot(snapshot, evidence), manifest = structuredClone(input) as PublicationManifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || Object.keys(manifest).sort().join(',') !== 'bindings,capture_id,evidence_sha256,execution_mode,format,provenance,publisher_version,snapshot_sha256'
      || manifest.format !== 1 || manifest.provenance !== 'local_synthetic' || manifest.execution_mode !== 'test'
      || manifest.publisher_version !== PUBLISHER_VERSION || manifest.capture_id !== report.capture_id
      || manifest.snapshot_sha256 !== report.snapshot_sha256 || report.evidence_sha256 === null || manifest.evidence_sha256 !== report.evidence_sha256
      || !Array.isArray(manifest.bindings) || manifest.bindings.length > 400
      || Buffer.byteLength(JSON.stringify(manifest)) > MAX_PUBLICATION_MANIFEST_BYTES) throw new Error();
    const bindings = new Map<string, PublicationBinding>(), currencies = new Map<string, string>();
    for (const inputBinding of manifest.bindings) {
      const b = validatePublicationBinding(inputBinding);
      if (bindings.has(b.event_key) || !report.rows.some(row => row.source.event_key === b.event_key)) throw new Error();
      if (currencies.has(b.currency.raw) && currencies.get(b.currency.raw) !== b.currency.code) throw new Error();
      currencies.set(b.currency.raw, b.currency.code); bindings.set(b.event_key, b);
    }
    const plan: PublicationPlan = { capture_id: report.capture_id, total: report.counts.total, withheld: [], revisions: [] };
    const ordinals = new Map<string, unknown>(), handles = new Map<string, number>();
    for (const row of report.rows) {
      const b = bindings.get(row.source.event_key), n = row.normalization;
      let reasons: string[] | null = null;
      if (row.state !== 'known') reasons = row.reason_codes;
      else if (!n?.candidate || n.record_kind !== 'payment') reasons = ['NON_PAYMENT_LOOKUP'];
      else if (!b) reasons = ['PUBLICATION_BINDING_MISSING'];
      if (reasons) { plan.withheld.push({ event_key: row.source.event_key, reason_codes: [...reasons] }); continue; }
      const { publication, transaction } = publicationTransaction({ format: 1, provenance: 'local_synthetic', execution_mode: 'test',
        publisher_version: PUBLISHER_VERSION, capture_id: report.capture_id, snapshot_sha256: report.snapshot_sha256,
        evidence_sha256: report.evidence_sha256, source: row.source, binding: b!, normalization_input: n!.raw });
      const scope = JSON.stringify([row.source.workspace_key, row.source.source_namespace, transaction.transaction_id]);
      const ordinal = scope + ':' + b!.expected_revision, handle = scope + ':' + transaction.transaction_revision;
      const identity = publicationIdentity(publication);
      if ((ordinals.has(ordinal) && !isDeepStrictEqual(ordinals.get(ordinal), identity))
        || (handles.has(handle) && handles.get(handle) !== b!.expected_revision)) throw new Error();
      ordinals.set(ordinal, identity); handles.set(handle, b!.expected_revision);
      plan.revisions.push({ format: 1, provenance: 'local_synthetic', execution_mode: 'test',
        workspace_key: row.source.workspace_key, expected_revision: b!.expected_revision, transaction, publication });
    }
    plan.revisions.sort((a, b) => a.transaction.transaction_id < b.transaction.transaction_id ? -1
      : a.transaction.transaction_id > b.transaction.transaction_id ? 1 : a.expected_revision - b.expected_revision);
    return plan;
  } catch { throw new Error('Synthetic publication preflight failed; details withheld.'); }
}

export async function publishSnapshot(snapshot: unknown, evidence: unknown, manifest: unknown, dsn: string) {
  const plan = planPublications(snapshot, evidence, manifest);
  const counts = { total: plan.total, eligible: plan.revisions.length, withheld: plan.withheld.length,
    inserted: 0, duplicate: 0, conflict: 0, failed: 0, unattempted: plan.revisions.length };
  let status: 'complete' | 'conflict' | 'failed' = 'complete';
  if (plan.revisions.length) {
    const writer = createTransactionRevisions(dsn);
    try {
      for (const revision of plan.revisions) {
        counts.unattempted--;
        try { counts[(await writer.append(revision)).status]++; }
        catch (error) {
          status = error instanceof TransactionRevisionError && error.code === 'REVISION_CONFLICT' ? 'conflict' : 'failed';
          counts[status]++; break;
        }
      }
    } finally { await writer.close(); }
  }
  return { status, capture_id: plan.capture_id, counts, canonical_emission: false as const };
}
