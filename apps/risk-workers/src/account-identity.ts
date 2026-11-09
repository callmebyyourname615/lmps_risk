import type { Transaction } from '@lmps/contracts';
import { detachIdentityJSON, unresolvedIdentityAccount } from '@lmps/contracts/account-identity';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { localRiskMode, riskHash, type createAccountIdentityResolver } from '@lmps/risk';

type Resolver = ReturnType<typeof createAccountIdentityResolver>;
interface WorkerIdentityInput {
  publication: unknown;
  evidence: null | { binding: { transaction_id: string; transaction_revision: string; source_namespace: string; record_ref: string; publication_sha256: string };
    sender: unknown; receiver: unknown };
}
export interface WorkerIdentityResult {
  transaction: Transaction; identity_scope: 'synthetic_only'; source_identity_verified: false;
  mapping_sha256: { sender: string | null; receiver: string | null };
}
/** Opt-in worker enrichment stage. Never mutates/persists publications or supplies history/time verification. */
export async function resolveWorkerTransactionIdentity(input: unknown, resolver: Resolver): Promise<WorkerIdentityResult> {
  let transaction: Transaction;
  try {
    localRiskMode();
    const value = detachIdentityJSON<WorkerIdentityInput>(input);
    if (!value || Object.keys(value).sort().join(',') !== 'evidence,publication') throw Error();
    const projected = publicationTransaction(value.publication);
    transaction = projected.transaction;
    const fail = (reason: string) => ({ transaction: { ...transaction, sender: unresolvedIdentityAccount(reason), receiver: unresolvedIdentityAccount(reason) },
      identity_scope: 'synthetic_only' as const, source_identity_verified: false as const, mapping_sha256: { sender: null, receiver: null } });
    if (projected.publication.provenance === 'user_supplied_file') return fail('STABLE_IDENTITY_UNVERIFIED');
    const evidence = value.evidence;
    if (!evidence) return fail('IDENTITY_EVIDENCE_MISSING');
    if (Object.keys(evidence).sort().join(',') !== 'binding,receiver,sender' || !evidence.binding
      || Object.keys(evidence.binding).sort().join(',') !== 'publication_sha256,record_ref,source_namespace,transaction_id,transaction_revision'
      || evidence.binding.transaction_id !== transaction.transaction_id || evidence.binding.transaction_revision !== transaction.transaction_revision
      || evidence.binding.source_namespace !== transaction.source_reference.namespace || evidence.binding.record_ref !== transaction.source_reference.record_ref
      || evidence.binding.publication_sha256 !== riskHash(projected.publication)) return fail('IDENTITY_BINDING_MISMATCH');
    const [sender, receiver] = await Promise.all([resolver.resolve(projected.publication.provenance, evidence.sender), resolver.resolve(projected.publication.provenance, evidence.receiver)]);
    return { transaction: { ...transaction, sender: sender.account, receiver: receiver.account }, identity_scope: 'synthetic_only' as const,
      source_identity_verified: false as const, mapping_sha256: { sender: sender.mapping_sha256, receiver: receiver.mapping_sha256 } };
  } catch { throw Error('WORKER_IDENTITY_INVALID; private values withheld.'); }
}
