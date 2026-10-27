import { DATASET_DIGEST, datasetMode } from './offline-dataset.js';

export const SOURCE_SEMANTICS_VERSION = 'lmps-source-semantics-1';
export const SEMANTIC_SELECTOR_FIELDS = ['result','txtype','totype','shouldrevert','isreconciled','issettled'] as const;
export type SemanticSelector = Record<typeof SEMANTIC_SELECTOR_FIELDS[number], string | null>;
export interface SourceSemantics {
  format: 1; execution_mode: 'offline_analysis'; version: string; source_manifest_sha256: string;
  status: 'draft' | 'owner_declared';
  evidence: null | { reference: string; sha256: string; owner_role: 'lmps_source_owner' };
  lifecycle: { source: SemanticSelector; operation: 'unknown' | 'payment' | 'lookup' | 'reversal';
    state: 'unknown' | 'pending' | 'succeeded' | 'failed' }[];
  currencies: { source_ccy: string; currency: string | null; amount_unit: 'major' | 'minor' | null; fee_unit: 'major' | 'minor' | null }[];
  time: null | { field: 'requesttime' | 'txtime'; meaning: 'request_received' | 'business_occurrence'; timezone: string };
}
export class SourceSemanticsError extends Error {
  constructor() { super('SEMANTICS_INVALID_MAPPING; private diagnostics withheld.'); }
}
const exact = (value: unknown, keys: readonly string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value: unknown, maximum = 200): value is string => typeof value === 'string'
  && [...value].length <= maximum && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value);
const digest = (value: unknown) => typeof value === 'string' && value.length === 64 && DATASET_DIGEST.test(value);
export const semanticSelectorKey = (source: SemanticSelector) => JSON.stringify(SEMANTIC_SELECTOR_FIELDS.map(field => source[field]));

export function validateSourceSemantics(input: unknown): SourceSemantics {
  try {
    datasetMode(); const v = structuredClone(input) as SourceSemantics;
    if (!exact(v, ['format','execution_mode','version','source_manifest_sha256','status','evidence','lifecycle','currencies','time'])
      || v.format !== 1 || v.execution_mode !== 'offline_analysis' || !text(v.version, 64)
      || !/^lmps_semantics_[a-zA-Z0-9_.-]{1,48}$/.test(v.version) || !digest(v.source_manifest_sha256)
      || !['draft','owner_declared'].includes(v.status) || !Array.isArray(v.lifecycle) || v.lifecycle.length > 1000
      || !Array.isArray(v.currencies) || v.currencies.length > 32 || Buffer.byteLength(JSON.stringify(v)) > 2 * 1024 * 1024) throw new Error();
    if (v.status === 'draft' ? v.evidence !== null : !exact(v.evidence, ['reference','sha256','owner_role'])
      || !text(v.evidence?.reference, 96) || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,95}$/.test(v.evidence!.reference)
      || !digest(v.evidence?.sha256) || v.evidence?.owner_role !== 'lmps_source_owner') throw new Error();
    const keys = new Set<string>();
    for (const entry of v.lifecycle) {
      if (!exact(entry, ['source','operation','state']) || !exact(entry.source, SEMANTIC_SELECTOR_FIELDS)
        || !['unknown','payment','lookup','reversal'].includes(entry.operation)
        || !['unknown','pending','succeeded','failed'].includes(entry.state)
        || (entry.operation === 'unknown' && entry.state !== 'unknown')) throw new Error();
      for (const field of SEMANTIC_SELECTOR_FIELDS) {
        const value = entry.source[field];
        if (value !== null && !text(value)) throw new Error();
        if (['shouldrevert','isreconciled','issettled'].includes(field)
          && value !== null && !/^(0|-?[1-9][0-9]{0,10})$/.test(value)) throw new Error();
        if (['totype','isreconciled','issettled'].includes(field) && value === null) throw new Error();
      }
      const key = semanticSelectorKey(entry.source);
      if (keys.has(key)) throw new Error(); keys.add(key);
    }
    const currencies = new Set<string>();
    for (const entry of v.currencies) {
      if (!exact(entry, ['source_ccy','currency','amount_unit','fee_unit']) || !text(entry.source_ccy) || !entry.source_ccy.length
        || (entry.currency !== null && (!text(entry.currency, 3) || !/^[A-Z]{3}$/.test(entry.currency)))
        || ![null,'major','minor'].includes(entry.amount_unit) || ![null,'major','minor'].includes(entry.fee_unit)
        || currencies.has(entry.source_ccy)) throw new Error();
      currencies.add(entry.source_ccy);
    }
    if (v.time !== null) {
      if (!exact(v.time, ['field','meaning','timezone']) || !['requesttime','txtime'].includes(v.time.field)
        || (v.time.field === 'requesttime' ? v.time.meaning !== 'request_received' : v.time.meaning !== 'business_occurrence')
        || !text(v.time.timezone, 64) || !v.time.timezone.length || v.time.timezone !== v.time.timezone.trim()) throw new Error();
      if (/^[+-]/.test(v.time.timezone)) {
        if (!/^[+-](?:(?:0[0-9]|1[0-3]):[0-5][0-9]|14:00)$/.test(v.time.timezone)) throw new Error();
      } else {
        if (v.time.timezone !== 'UTC' && !/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(v.time.timezone)) throw new Error();
        new Intl.DateTimeFormat('en', { timeZone: v.time.timezone });
      }
    }
    v.lifecycle.sort((a,b) => semanticSelectorKey(a.source) < semanticSelectorKey(b.source) ? -1 : semanticSelectorKey(a.source) > semanticSelectorKey(b.source) ? 1 : 0);
    v.currencies.sort((a,b) => a.source_ccy < b.source_ccy ? -1 : a.source_ccy > b.source_ccy ? 1 : 0);
    return v;
  } catch { throw new SourceSemanticsError(); }
}
