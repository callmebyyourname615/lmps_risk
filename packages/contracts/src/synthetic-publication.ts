import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Transaction } from './generated/transaction.js';
import { normalizeSynthetic, type SyntheticNormalizationInput } from './synthetic-normalization.js';

export const PUBLISHER_VERSION = 'synthetic-publisher-0.1.0-draft.1';
export interface PublicationBinding {
  event_key: string; transaction_id: string; transaction_revision: string; expected_revision: number;
  currency: { raw: string; code: string; decimal_places: 2 };
}
export interface SyntheticPublication {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; publisher_version: typeof PUBLISHER_VERSION;
  capture_id: string; snapshot_sha256: string; evidence_sha256: string;
  source: { workspace_key: string; source_namespace: string; source_generation: string; capture_epoch: string;
    event_key: string; source_table: string; source_key: Record<string, string>; operation: string; observed_at: string };
  binding: PublicationBinding; normalization_input: SyntheticNormalizationInput;
}
export const PUBLICATION_MAX_BYTES = 48 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function exact(value: unknown, keys: string[]): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
export function validatePublicationBinding(input: unknown): PublicationBinding {
  const b = structuredClone(input) as PublicationBinding;
  if (!exact(b, ['event_key', 'transaction_id', 'transaction_revision', 'expected_revision', 'currency'])
    || typeof b.event_key !== 'string' || !/^transfer(?:_hist|_old)?:[1-9]\d{0,2}$/.test(b.event_key)
    || typeof b.transaction_id !== 'string' || !/^synthetic_[A-Za-z0-9_.:-]{1,70}$/.test(b.transaction_id)
    || typeof b.transaction_revision !== 'string' || !/^synthetic_[A-Za-z0-9_.:-]{1,70}$/.test(b.transaction_revision)
    || !Number.isInteger(b.expected_revision) || b.expected_revision < 0 || b.expected_revision > 2147483646
    || !exact(b.currency, ['raw', 'code', 'decimal_places']) || b.currency.decimal_places !== 2
    || typeof b.currency.raw !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(b.currency.raw)
    || typeof b.currency.code !== 'string' || !/^[A-Z]{3}$/.test(b.currency.code)) throw new Error('Invalid synthetic publication binding.');
  return b;
}

// Recompute from strict raw input: a caller-provided candidate/status is never proof.
export function publicationTransaction(input: unknown): { publication: SyntheticPublication; transaction: Transaction } {
  try {
    const p = structuredClone(input) as SyntheticPublication;
    if (!exact(p, ['format', 'provenance', 'execution_mode', 'publisher_version', 'capture_id', 'snapshot_sha256', 'evidence_sha256', 'source', 'binding', 'normalization_input'])
      || p.format !== 1 || p.provenance !== 'local_synthetic' || p.execution_mode !== 'test' || p.publisher_version !== PUBLISHER_VERSION
      || typeof p.capture_id !== 'string' || !uuid.test(p.capture_id)
      || [p.snapshot_sha256, p.evidence_sha256].some(hash => typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))
      || Buffer.byteLength(JSON.stringify(p)) > PUBLICATION_MAX_BYTES || !isDeepStrictEqual(p, JSON.parse(JSON.stringify(p)))) throw new Error();
    const b = validatePublicationBinding(p.binding), s = p.source;
    if (!exact(s, ['workspace_key', 'source_namespace', 'source_generation', 'capture_epoch', 'event_key', 'source_table', 'source_key', 'operation', 'observed_at'])
      || s.workspace_key !== 'synthetic_local' || s.source_namespace !== 'synthetic_snapshot'
      || typeof s.source_generation !== 'string' || !uuid.test(s.source_generation)
      || s.capture_epoch !== p.capture_id || s.event_key !== b.event_key || s.operation !== 'snapshot'
      || !['transfer', 'transfer_hist', 'transfer_old'].includes(s.source_table) || !s.event_key.startsWith(s.source_table + ':')
      || !exact(s.source_key, s.source_table === 'transfer_old' ? ['id'] : ['id', 'requesttime'])
      || typeof s.source_key.id !== 'string' || !/^(0|-?[1-9]\d{0,9})$/.test(s.source_key.id)
      || BigInt(s.source_key.id) < -2147483648n || BigInt(s.source_key.id) > 2147483647n) throw new Error();
    if (s.source_table !== 'transfer_old') {
      const time = s.source_key.requesttime;
      if (typeof time !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)
        || new Date(time.replace(' ', 'T') + '.000Z').toISOString().slice(0, 19).replace('T', ' ') !== time) throw new Error();
    }
    const outcome = normalizeSynthetic(p.normalization_input), raw = outcome.raw, candidate = outcome.candidate;
    if (outcome.state !== 'known' || outcome.record_kind !== 'payment' || !candidate || !raw
      || raw.source_reference.namespace !== s.source_namespace || raw.source_reference.record_ref !== s.event_key
      || raw.observed_at !== s.observed_at || candidate.raw_currency !== b.currency.raw
      || (candidate.synthetic_payment_ref !== null && candidate.synthetic_payment_ref !== b.transaction_id)) throw new Error();
    const id = createHash('sha256').update(JSON.stringify([s.workspace_key, s.source_namespace, b.transaction_id, b.transaction_revision])).digest('hex');
    const unresolved = { status: 'unresolved' as const, source_representation: 'unknown' as const, reason_code: 'STABLE_IDENTITY_UNVERIFIED' };
    const transaction: Transaction = { schema_version: '0.1.0-draft.1', execution_mode: 'test',
      run_id: 'synthetic_capture_' + p.capture_id, correlation_id: 'synthetic_' + id,
      transaction_id: b.transaction_id, transaction_revision: b.transaction_revision,
      source_reference: { namespace: s.source_namespace, record_ref: 'synthetic_' + id, mapping_version: null },
      observed_at: s.observed_at, occurred_at: null, sender: { ...unresolved }, receiver: { ...unresolved },
      source_bank_id: null, destination_bank_id: null, transaction_type: null, channel: null,
      amount: candidate.amount, currency: b.currency.code, transaction_status: candidate.transaction_status };
    return { publication: p, transaction };
  } catch { throw new Error('Invalid synthetic normalization publication; details withheld.'); }
}

// A declared revision identifies one complete synthetic observation, never an additive financial delta.
// Cross-capture replay keeps the first publication and its lineage; later capture source/evidence/bindings remain private files.
export function publicationIdentity(p: SyntheticPublication) {
  const { source_reference: _reference, observed_at: _observed, ...raw } = p.normalization_input;
  const { event_key: _event, ...binding } = p.binding;
  return { publisher_version: p.publisher_version, workspace_key: p.source.workspace_key,
    namespace: p.source.source_namespace, source_generation: p.source.source_generation, binding, raw };
}
