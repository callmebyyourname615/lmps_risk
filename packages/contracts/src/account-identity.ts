import type { ResolvedAccount, UnresolvedAccount } from './generated/transaction.js';

export const IDENTITY_VERSION = 'account-identity-test-1';
export type IdentityRepresentation = 'masked' | 'unmasked' | 'unknown';
export interface IdentityMapping {
  version: string; namespace: string; owning_institution_id: string;
  stability: 'synthetic_declared' | 'unverified'; source_representation: IdentityRepresentation;
  canonicalization: 'exact_utf8'; key: { id: string; version: string };
}
export interface IdentityInput {
  mapping_version: string; namespace: string; owning_institution_id: string;
  source_representation: IdentityRepresentation; account_value: string | null;
}
export interface IdentityResolution {
  version: typeof IDENTITY_VERSION; identity_scope: 'synthetic_only'; source_identity_verified: false;
  mapping_sha256: string | null; account: ResolvedAccount | UnresolvedAccount;
}
export class IdentityError extends Error {
  constructor() { super('IDENTITY_INVALID_INPUT; private values withheld.'); }
}
export const identityHandle = (v: unknown): v is string => typeof v === 'string' && /^synthetic_[A-Za-z0-9_.:-]{1,60}$/.test(v);
const representations = ['masked', 'unmasked', 'unknown'];
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object'
  && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.sort().join(',');

/** Bounded plain JSON only; never invoke caller accessors/toJSON while validating private evidence. */
export function detachIdentityJSON<T = unknown>(input: unknown): T {
  try {
    let nodes = 0; const active = new Set<object>();
    function visit(v: unknown, depth: number): void {
      if (++nodes > 2500 || depth > 8) throw Error();
      if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isSafeInteger(v)) return;
      if (typeof v === 'string' && v.length <= 256) return;
      if (!v || typeof v !== 'object' || active.has(v)
        || Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype)) throw Error();
      const keys = Reflect.ownKeys(v); if (keys.length > 129) throw Error();
      if (Array.isArray(v) && (keys.length !== v.length + 1 || keys.some(key => key !== 'length'
        && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)))) throw Error();
      active.add(v);
      for (const key of keys) {
        if (Array.isArray(v) && key === 'length') continue;
        const d = Object.getOwnPropertyDescriptor(v, key)!;
        if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
          || !d.enumerable || !('value' in d)) throw Error();
        visit(d.value, depth + 1);
      }
      active.delete(v);
    }
    visit(input, 0);
    return structuredClone(input) as T;
  } catch { throw new IdentityError(); }
}
export function validateIdentityMapping(input: unknown): IdentityMapping {
  const v = detachIdentityJSON<IdentityMapping>(input);
  if (!exact(v, ['version', 'namespace', 'owning_institution_id', 'stability', 'source_representation', 'canonicalization', 'key'])
    || ![v.version, v.namespace, v.owning_institution_id].every(identityHandle)
    || !['synthetic_declared', 'unverified'].includes(v.stability) || !representations.includes(v.source_representation)
    || v.canonicalization !== 'exact_utf8' || !exact(v.key, ['id', 'version'])
    || !identityHandle(v.key.id) || !identityHandle(v.key.version)) throw new IdentityError();
  return v;
}
export function validateIdentityInput(input: unknown): IdentityInput {
  const v = detachIdentityJSON<IdentityInput>(input);
  if (!exact(v, ['mapping_version', 'namespace', 'owning_institution_id', 'source_representation', 'account_value'])
    || ![v.mapping_version, v.namespace, v.owning_institution_id].every(identityHandle)
    || !representations.includes(v.source_representation)
    || v.account_value !== null && (typeof v.account_value !== 'string' || v.account_value.length > 200
      || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v.account_value))) throw new IdentityError();
  return v;
}
export function unresolvedIdentityAccount(reason_code = 'STABLE_IDENTITY_UNVERIFIED', source_representation: IdentityRepresentation = 'unknown'): UnresolvedAccount {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(reason_code) || !representations.includes(source_representation)) throw new IdentityError();
  return { status: 'unresolved', source_representation, reason_code };
}
