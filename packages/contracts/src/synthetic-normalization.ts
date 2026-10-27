import { readFileSync } from 'node:fs';

export const NORMALIZER_VERSION = 'synthetic-normalizer-0.1.0-draft.1';
export const CODEBOOK_VERSION = 'synthetic-lifecycle-0.1.0-draft.1';
type Kind = 'payment' | 'lookup';
type OriginalStatus = 'unknown' | 'pending' | 'succeeded' | 'failed';
type Reversal = 'none' | 'requested' | 'failed' | 'partial_completed' | 'full_completed';
type PaymentStatus = Exclude<OriginalStatus, 'unknown'> | 'partially_reversed' | 'reversed';
type SourceReference = { namespace: string; record_ref: string };
type ReversalEvent = { event_ref: string; amount: string; currency: string; completed: boolean | null };
export interface SyntheticNormalizationInput {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; codebook_version: string;
  source_reference: SourceReference; observed_at: string;
  operation_code?: string | null; status_code?: string | null; reversal_code?: string | null;
  amount?: string | null; currency?: string | null; source_time?: string | null;
  synthetic_payment_ref?: string | null;
  reversal_evidence?: { original_payment_ref: string; events: ReversalEvent[] } | null;
}
export interface NormalizationOutcome {
  format: 1; normalizer_version: typeof NORMALIZER_VERSION; codebook_version: typeof CODEBOOK_VERSION;
  provenance: 'local_synthetic'; execution_mode: 'test'; canonical_emission: false;
  state: 'known' | 'unknown' | 'invalid'; reason_codes: string[];
  source_reference: SourceReference | null; record_kind: Kind | null;
  time: { observed_at: string; source_time: string | null; occurred_at: null; source_timezone: 'unverified'; quality: 'missing' | 'naive_unverified' } | null;
  candidate: { transaction_status: PaymentStatus; amount: string; raw_currency: string;
    synthetic_payment_ref: string | null; cumulative_reversed_amount: string | null; account_identity: 'unresolved' } | null;
  raw: SyntheticNormalizationInput | null;
}

const book = JSON.parse(readFileSync(new URL('../../../docs/data-dictionary/synthetic-lifecycle-codebook.v1.json', import.meta.url), 'utf8')) as {
  codebook_version: string; synthetic_only: boolean; execution_mode: string; production_mapping_approved: boolean; source_field_mapping: unknown;
  codes: { operation: Record<string, Kind>; status: Record<string, OriginalStatus>; reversal: Record<string, Reversal> };
  reversal_status_overrides: Record<string, PaymentStatus>;
};
if (book.codebook_version !== CODEBOOK_VERSION || book.synthetic_only !== true || book.execution_mode !== 'test'
  || book.production_mapping_approved !== false || book.source_field_mapping !== null) throw new Error('Unsupported bundled synthetic codebook.');

const INPUT_KEYS = ['format', 'provenance', 'execution_mode', 'codebook_version', 'source_reference', 'observed_at', 'operation_code', 'status_code', 'reversal_code', 'amount', 'currency', 'source_time', 'synthetic_payment_ref', 'reversal_evidence'];
const HANDLE = /^synthetic_[A-Za-z0-9_.:-]{1,70}$/;
const MONEY = /^(0|[1-9]\d{0,21})\.\d{2}$/;
const CURRENCY = /^[A-Za-z0-9_.:-]{1,200}$/;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function optionalText(value: unknown, max: number): boolean { return value === undefined || value === null || (typeof value === 'string' && value.length <= max); }
function calendar(value: string, naive: boolean): boolean {
  if (!(naive ? /^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ : /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(value)) return false;
  const date = new Date(naive ? value.replace(' ', 'T') + '.000Z' : value);
  return Number.isFinite(date.valueOf()) && (naive ? date.toISOString().slice(0, 19).replace('T', ' ') : date.toISOString()) === value;
}
function lookup<T>(codes: Record<string, T>, raw: string | null | undefined): T | undefined {
  return typeof raw === 'string' && Object.hasOwn(codes, raw) ? codes[raw] : undefined;
}
const units = (value: string) => BigInt(value.replace('.', ''));
const decimal = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

// shortcut: local synthetic envelope only; approved source normalization/persistence needs a separate adapter and review.
export function normalizeSynthetic(input: unknown): NormalizationOutcome {
  let raw: SyntheticNormalizationInput | null = null;
  let reference: SourceReference | null = null;
  let kind: Kind | null = null;
  let time: NormalizationOutcome['time'] = null;
  const result = (state: NormalizationOutcome['state'], reason_codes: string[], candidate: NormalizationOutcome['candidate'] = null): NormalizationOutcome => ({
    format: 1, normalizer_version: NORMALIZER_VERSION, codebook_version: CODEBOOK_VERSION,
    provenance: 'local_synthetic', execution_mode: 'test', canonical_emission: false,
    state, reason_codes, source_reference: reference ? { ...reference } : null, record_kind: kind, time, candidate, raw,
  });
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
    || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') return result('invalid', ['INVALID_CONTEXT']);
  try {
    const value: unknown = structuredClone(input);
    if (!object(value) || Object.keys(value).some(key => !INPUT_KEYS.includes(key))) return result('invalid', ['INVALID_INPUT']);
    if (value.format !== 1 || value.provenance !== 'local_synthetic' || value.execution_mode !== 'test'
      || value.codebook_version !== CODEBOOK_VERSION) return result('invalid', ['INVALID_CONTEXT']);
    if (!exact(value.source_reference, ['namespace', 'record_ref']) || typeof value.source_reference.namespace !== 'string'
      || !/^synthetic_[a-z0-9_]{1,40}$/.test(value.source_reference.namespace)
      || typeof value.source_reference.record_ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value.source_reference.record_ref)) return result('invalid', ['INVALID_SOURCE_REFERENCE']);
    reference = value.source_reference as SourceReference;
    if (typeof value.observed_at !== 'string' || !calendar(value.observed_at, false)) return result('invalid', ['INVALID_OBSERVED_AT']);
    for (const field of ['operation_code', 'status_code', 'reversal_code']) if (!optionalText(value[field], 200)) return result('invalid', ['INVALID_CODE_TYPE']);
    if (!optionalText(value.amount, 26) || !optionalText(value.currency, 200) || !optionalText(value.source_time, 19)
      || !optionalText(value.synthetic_payment_ref, 80)) return result('invalid', ['INVALID_FIELD_TYPE']);
    if (value.synthetic_payment_ref != null && (typeof value.synthetic_payment_ref !== 'string' || !HANDLE.test(value.synthetic_payment_ref))) return result('invalid', ['INVALID_PAYMENT_REFERENCE']);
    if (value.reversal_evidence != null) {
      const evidence = value.reversal_evidence;
      if (!exact(evidence, ['original_payment_ref', 'events']) || typeof evidence.original_payment_ref !== 'string'
        || !HANDLE.test(evidence.original_payment_ref) || !Array.isArray(evidence.events) || evidence.events.length > 100) return result('invalid', ['INVALID_REVERSAL_EVIDENCE']);
      for (const event of evidence.events) {
        if (!exact(event, ['event_ref', 'amount', 'currency', 'completed']) || typeof event.event_ref !== 'string' || !HANDLE.test(event.event_ref)
          || typeof event.amount !== 'string' || event.amount.length > 26 || typeof event.currency !== 'string' || !CURRENCY.test(event.currency)
          || (event.completed !== null && typeof event.completed !== 'boolean')) return result('invalid', ['INVALID_REVERSAL_EVIDENCE']);
      }
    }
    raw = value as unknown as SyntheticNormalizationInput;
    if (Buffer.byteLength(JSON.stringify(raw)) > 32768) { raw = null; return result('invalid', ['INPUT_TOO_LARGE']); }
    if (raw.source_time != null && !calendar(raw.source_time, true)) return result('invalid', ['INVALID_SOURCE_TIME']);
    time = { observed_at: raw.observed_at, source_time: raw.source_time ?? null, occurred_at: null,
      source_timezone: 'unverified', quality: raw.source_time == null ? 'missing' : 'naive_unverified' };
    if (raw.amount != null && !MONEY.test(raw.amount)) return result('invalid', ['INVALID_AMOUNT']);
    if (raw.currency != null && raw.currency !== '' && !CURRENCY.test(raw.currency)) return result('invalid', ['INVALID_CURRENCY']);

    kind = lookup(book.codes.operation, raw.operation_code) ?? null;
    const status = lookup(book.codes.status, raw.status_code);
    const reversal = lookup(book.codes.reversal, raw.reversal_code);
    const unknown = [];
    if (!kind) unknown.push('UNKNOWN_OPERATION_CODE');
    if (!status || status === 'unknown') unknown.push('UNKNOWN_STATUS_CODE');
    if (!reversal) unknown.push('UNKNOWN_REVERSAL_CODE');
    if (kind === 'lookup' && ((reversal && reversal !== 'none') || raw.reversal_evidence != null)) return result('invalid', ['LOOKUP_REVERSAL_CONFLICT']);
    if (!kind || !status || status === 'unknown' || !reversal) return result('unknown', unknown);
    if (kind === 'lookup') {
      return result('known', ['NON_PAYMENT_LOOKUP']);
    }
    if (reversal !== 'none' && status !== 'succeeded') return result('invalid', ['REVERSAL_REQUIRES_SUCCEEDED_ORIGINAL']);
    if (!raw.amount || !raw.currency) return result('unknown', [!raw.amount ? 'MISSING_AMOUNT' : 'MISSING_CURRENCY']);
    let candidateStatus: PaymentStatus = status;
    let cumulative: string | null = null;
    const completed = reversal === 'partial_completed' || reversal === 'full_completed';
    if (!completed && raw.reversal_evidence != null) return result('invalid', ['UNEXPECTED_REVERSAL_EVIDENCE']);
    if (reversal !== 'none' && !raw.synthetic_payment_ref) return result('unknown', ['MISSING_ORIGINAL_PAYMENT_LINK']);
    if (completed) {
      const evidence = raw.reversal_evidence;
      if (!evidence || evidence.events.length === 0) return result('unknown', ['MISSING_REVERSAL_EVIDENCE']);
      if (evidence.original_payment_ref !== raw.synthetic_payment_ref) return result('invalid', ['REVERSAL_ORIGINAL_MISMATCH']);
      const seen = new Map<string, ReversalEvent>();
      let total = 0n; let incomplete = false;
      for (const event of evidence.events) {
        const previous = seen.get(event.event_ref);
        if (previous) {
          if (previous.amount !== event.amount || previous.currency !== event.currency || previous.completed !== event.completed) return result('invalid', ['REVERSAL_EVENT_CONFLICT']);
          continue;
        }
        seen.set(event.event_ref, event);
        if (!MONEY.test(event.amount) || units(event.amount) <= 0n) return result('invalid', ['INVALID_REVERSAL_AMOUNT']);
        if (event.currency !== raw.currency) return result('invalid', ['REVERSAL_CURRENCY_MISMATCH']);
        if (event.completed !== true) incomplete = true;
        total += units(event.amount);
      }
      if (incomplete) return result('unknown', ['REVERSAL_NOT_CONFIRMED']);
      const original = units(raw.amount);
      if (original <= 0n || (reversal === 'partial_completed' ? total >= original : total !== original)) return result('invalid', ['REVERSAL_AMOUNT_MISMATCH']);
      candidateStatus = book.reversal_status_overrides[reversal]!;
      cumulative = decimal(total);
    }
    return result('known', ['SYNTHETIC_PAYMENT_CANDIDATE'], { transaction_status: candidateStatus, amount: raw.amount,
      raw_currency: raw.currency, synthetic_payment_ref: raw.synthetic_payment_ref ?? null,
      cumulative_reversed_amount: cumulative, account_identity: 'unresolved' });
  } catch {
    raw = null;
    return result('invalid', ['INVALID_INPUT']);
  }
}
