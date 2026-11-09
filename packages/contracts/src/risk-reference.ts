import { Ajv2020 } from 'ajv/dist/2020.js';

export interface ReferenceSubject { namespace: string; subject_id: string; match_level: 'exact' | 'partial' | 'unresolved' }
export interface RiskReferenceEntry {
  reference_id: string; version: number; task: 'fraud' | 'mule_network' | 'aml'; subject: ReferenceSubject;
  known_at: string; valid_from: string; valid_to: string; revoked_at: string | null; evidence_sha256: string;
}
export interface RiskReferenceRequest {
  version: 'synthetic-risk-reference-1'; mode: 'local_synthetic'; source: { publisher: string; version: string; payload_sha256: string; complete: boolean };
  subject: ReferenceSubject; as_of: string; entries: RiskReferenceEntry[];
}
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const id = { type: 'string', pattern: '^synthetic_[a-z0-9_]{1,60}$', maxLength: 70 };
const time = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$', maxLength: 24 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$', maxLength: 64 };
const subject = obj({ namespace: id, subject_id: id, match_level: { enum: ['exact', 'partial', 'unresolved'] } });
const schema = obj({ version: { const: 'synthetic-risk-reference-1' }, mode: { const: 'local_synthetic' },
  source: obj({ publisher: id, version: id, payload_sha256: hash, complete: { type: 'boolean' } }), subject, as_of: time,
  entries: { type: 'array', maxItems: 100, items: obj({ reference_id: id, version: { type: 'integer', minimum: 1, maximum: 1000000 }, task: { enum: ['fraud', 'mule_network', 'aml'] }, subject,
    known_at: time, valid_from: time, valid_to: time, revoked_at: { anyOf: [time, { type: 'null' }] }, evidence_sha256: hash }) } });
const validate = new Ajv2020({ strict: true, coerceTypes: false, removeAdditional: false }).compile<RiskReferenceRequest>(schema);
export class RiskReferenceError extends Error { readonly code = 'RISK_REFERENCE_INVALID'; constructor() { super('Invalid synthetic risk reference'); } }
/** Reject accessors/exotic or excessive objects before invoking schema utilities. */
export function validateRiskReferenceRequest(value: unknown): RiskReferenceRequest {
  const seen = new Set<object>(); let nodes = 0;
  function walk(v: unknown, depth: number): void {
    if (++nodes > 5000 || depth > 8) throw new RiskReferenceError();
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isSafeInteger(v)) return;
    if (typeof v === 'string' && v.length <= 256) return;
    if (!v || typeof v !== 'object' || seen.has(v) || Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype)) throw new RiskReferenceError();
    const keys = Reflect.ownKeys(v); if (keys.length > 101) throw new RiskReferenceError(); seen.add(v);
    for (const key of keys) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d.enumerable || !('value' in d)) throw new RiskReferenceError();
      walk(d.value, depth + 1);
    }
    seen.delete(v);
  }
  walk(value, 0);
  if (!validate(value)) throw new RiskReferenceError();
  const times = [value.as_of, ...value.entries.flatMap(e => [e.known_at, e.valid_from, e.valid_to, ...(e.revoked_at ? [e.revoked_at] : [])])];
  if (times.some(t => !Number.isFinite(Date.parse(t)) || new Date(t).toISOString() !== t)
    || value.entries.some(e => e.valid_from >= e.valid_to || e.revoked_at !== null && e.revoked_at < e.known_at)) throw new RiskReferenceError();
  const keys = value.entries.map(e => `${e.reference_id}:${e.version}`);
  if (new Set(keys).size !== keys.length) throw new RiskReferenceError();
  return structuredClone(value);
}
