import { createHash, createHmac, KeyObject } from 'node:crypto';
import { IDENTITY_VERSION, IdentityError, detachIdentityJSON, identityHandle, unresolvedIdentityAccount,
  validateIdentityInput, validateIdentityMapping, type IdentityResolution } from '@lmps/contracts/account-identity';

export interface IdentityKeyReference { id: string; version: string }
export interface IdentityKeyProvider {
  mac(input: { key: IdentityKeyReference; message: Uint8Array; signal: AbortSignal }): Promise<{
    key: IdentityKeyReference; status: 'active'; digest: Uint8Array;
  }>;
}
const mappingKey = (v: { namespace: string; owning_institution_id: string; version: string }) => JSON.stringify([v.namespace, v.owning_institution_id, v.version]);
const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v, (_k, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex');
const localMode = () => process.env.NODE_ENV !== 'production' && ['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
  && (process.env.LMPS_EXECUTION_MODE ?? 'test') === 'test';

/** Immutable per-instance mapping registry. No real-source authority, persistent key custody or alias migration. */
export function createAccountIdentityResolver(mappingInput: unknown, provider: IdentityKeyProvider, timeoutMs = 250) {
  if (!localMode() || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 || typeof provider?.mac !== 'function') throw new IdentityError();
  const values = detachIdentityJSON<unknown[]>(mappingInput);
  if (!Array.isArray(values) || values.length > 32) throw new IdentityError();
  const mappings = new Map<string, ReturnType<typeof validateIdentityMapping>>();
  for (const value of values) {
    const mapping = validateIdentityMapping(value), key = mappingKey(mapping);
    if (mappings.has(key)) throw new IdentityError();
    mappings.set(key, mapping);
  }
  return {
    async resolve(provenance: unknown, input: unknown): Promise<IdentityResolution> {
      let representation: 'masked' | 'unmasked' | 'unknown' = 'unknown', mappingHash: string | null = null;
      const unresolved = (reason: string): IdentityResolution => ({ version: IDENTITY_VERSION, identity_scope: 'synthetic_only', source_identity_verified: false,
        mapping_sha256: mappingHash, account: unresolvedIdentityAccount(reason, representation) });
      if (!localMode()) return unresolved('IDENTITY_CONTEXT_UNSUPPORTED');
      // Never inspect/tokenize real account values, even with a synthetic-looking declaration.
      if (provenance === 'user_supplied_file') return unresolved('STABLE_IDENTITY_UNVERIFIED');
      if (provenance !== 'local_synthetic') return unresolved('IDENTITY_CONTEXT_UNSUPPORTED');
      let value;
      try { value = validateIdentityInput(input); } catch { return unresolved('IDENTITY_INPUT_INVALID'); }
      representation = value.source_representation;
      const mapping = mappings.get(mappingKey({ ...value, version: value.mapping_version }));
      if (!mapping) return unresolved('IDENTITY_MAPPING_UNAVAILABLE');
      mappingHash = digest(mapping);
      if (mapping.stability !== 'synthetic_declared') return unresolved('STABLE_IDENTITY_UNVERIFIED');
      if (representation !== 'unmasked' || mapping.source_representation !== 'unmasked') return unresolved('IDENTITY_REPRESENTATION_UNVERIFIED');
      if (value.account_value === null || value.account_value === '') return unresolved('IDENTITY_VALUE_MISSING');
      if (!identityHandle(value.account_value)) return unresolved('IDENTITY_INPUT_INVALID');
      const message = Buffer.from(JSON.stringify([IDENTITY_VERSION, mappingHash, value.account_value]), 'utf8');
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('timeout'));
        }, timeoutMs); });
        // Promise.resolve also captures a synchronous provider failure without leaking its diagnostics.
        const result = await Promise.race([Promise.resolve().then(() => provider.mac({ key: { ...mapping.key }, message, signal: controller.signal })), timeout]);
        if (controller.signal.aborted) return unresolved('IDENTITY_KEY_TIMEOUT');
        if (!result || result.status !== 'active' || result.key?.id !== mapping.key.id || result.key.version !== mapping.key.version
          || !(result.digest instanceof Uint8Array) || result.digest.byteLength !== 32) return unresolved('IDENTITY_KEY_UNAVAILABLE');
        return { version: IDENTITY_VERSION, identity_scope: 'synthetic_only', source_identity_verified: false, mapping_sha256: mappingHash,
          account: { status: 'resolved', namespace: mapping.namespace, owning_institution_id: mapping.owning_institution_id,
            account_token: 'synthetic_token_' + Buffer.from(result.digest).toString('hex'), resolution_version: 'synthetic_identity_' + mappingHash } };
      } catch { return unresolved(controller.signal.aborted ? 'IDENTITY_KEY_TIMEOUT' : 'IDENTITY_KEY_UNAVAILABLE'); }
      finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); message.fill(0); }
    },
  };
}

/** Local opaque-key fixture adapter. The managed-provider interface never exports key material. */
export function createLocalIdentityKeyProvider(input: Array<{ key: IdentityKeyReference; material: KeyObject }>) {
  if (!localMode() || !Array.isArray(input) || input.length < 1 || input.length > 32) throw new IdentityError();
  const keys = new Map<string, { material: KeyObject; revoked: boolean }>();
  const keyId = (key: IdentityKeyReference) => JSON.stringify([key.id, key.version]);
  for (const item of input) {
    if (!identityHandle(item.key?.id) || !identityHandle(item.key.version) || !(item.material instanceof KeyObject)
      || item.material.type !== 'secret' || item.material.symmetricKeySize !== 32 || keys.has(keyId(item.key))) throw new IdentityError();
    keys.set(keyId(item.key), { material: item.material, revoked: false });
  }
  const provider: IdentityKeyProvider = {
    async mac({ key, message, signal }) {
      const entry = keys.get(keyId(key));
      if (!localMode() || !entry || entry.revoked || signal.aborted || !(message instanceof Uint8Array) || message.byteLength < 1 || message.byteLength > 2048) throw new IdentityError();
      return { key: { ...key }, status: 'active', digest: createHmac('sha256', entry.material).update(message).digest() };
    },
  };
  return { provider, revoke(key: IdentityKeyReference) { const entry = keys.get(keyId(key)); if (!entry) throw new IdentityError(); entry.revoked = true; } };
}
