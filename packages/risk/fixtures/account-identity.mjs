import { createSecretKey } from 'node:crypto';
import { createLocalIdentityKeyProvider } from '../dist/index.js';

// Invented fixture identifiers and deliberately public deterministic fixture bytes only.
export const identityMapping = () => ({ version: 'synthetic_mapping_v1', namespace: 'synthetic_accounts',
  owning_institution_id: 'synthetic_bank_a', stability: 'synthetic_declared', source_representation: 'unmasked',
  canonicalization: 'exact_utf8', key: { id: 'synthetic_identity_key', version: 'synthetic_key_v1' } });
export const identityInput = () => ({ mapping_version: 'synthetic_mapping_v1', namespace: 'synthetic_accounts',
  owning_institution_id: 'synthetic_bank_a', source_representation: 'unmasked', account_value: 'synthetic_account_0001' });
export function identityProvider(mapping = identityMapping(), byte = 0) {
  return createLocalIdentityKeyProvider([{ key: mapping.key, material: createSecretKey(Buffer.alloc(32, byte)) }]);
}
