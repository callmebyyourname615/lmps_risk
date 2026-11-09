import { isDeepStrictEqual, types } from 'node:util';
import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { DATASET_MAX_BYTES, datasetMode } from '@lmps/contracts/offline-dataset';
import { jointIntakeLifecycle } from '@lmps/contracts/intake-source-contract';
import { JOINT_SOURCE_PUBLISHER_VERSION, makeJointSourcePublication, sourceEvidenceHash, sourcePublicationTransaction } from '@lmps/contracts/source-publication';
import { validateTransactionRevision } from './transaction-revisions.js';
import type { Transaction } from '@lmps/contracts';
import type { SourcePublication } from '@lmps/contracts/source-publication';

export const INTAKE_AUDIT_MAX_REVISIONS = 10_000;
interface Revision {
  workspace_key: string; namespace: string; transaction_id: string; revision_number: number;
  provenance: 'user_supplied_file'; payload: Transaction; publication: SourcePublication;
}

export function analyzeIntakeRevisionHistory(input: unknown, workspace: string, namespace: string) {
  try {
    datasetMode();
    if (![workspace, namespace].every(value => typeof value === 'string' && /^synthetic_[a-z0-9_]{1,40}$/.test(value))
      || !Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype
      || input.length > INTAKE_AUDIT_MAX_REVISIONS || Reflect.ownKeys(input).length !== input.length + 1) throw Error();
    const revisions: Revision[] = [];
    let bytes = 0;
    for (let index = 0; index < input.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) throw Error();
      const row = detachFeatureJSON(descriptor.value, 65536) as Revision;
      if (!row || Object.keys(row).sort().join(',') !== 'namespace,payload,provenance,publication,revision_number,transaction_id,workspace_key'
        || row.workspace_key !== workspace || row.namespace !== namespace || row.provenance !== 'user_supplied_file'
        || !Number.isSafeInteger(row.revision_number) || row.revision_number < 1 || row.revision_number > 2147483647) throw Error();
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > DATASET_MAX_BYTES) throw Error();
      const checked = validateTransactionRevision({ format: 1, execution_mode: 'test', provenance: row.provenance,
        workspace_key: workspace, expected_revision: row.revision_number - 1, transaction: row.payload, publication: row.publication });
      if (checked.transaction.transaction_id !== row.transaction_id || checked.transaction.source_reference.namespace !== namespace) throw Error();
      sourcePublicationTransaction(row.publication);
      revisions.push(row);
    }
    revisions.sort((first, second) => first.transaction_id < second.transaction_id ? -1
      : first.transaction_id > second.transaction_id ? 1 : first.revision_number - second.revision_number);
    const latest = new Map<string, Revision>();
    let changed = 0;
    for (const row of revisions) {
      const previous = latest.get(row.transaction_id);
      if (row.revision_number !== (previous?.revision_number ?? 0) + 1) throw Error();
      if (row.publication.publisher_version === JOINT_SOURCE_PUBLISHER_VERSION) {
        if (!previous || !isDeepStrictEqual(makeJointSourcePublication(previous.publication, row.publication.origin.review),
          { transaction: row.payload, publication: row.publication })) throw Error();
      }
      if (previous?.revision_number === 1) changed++;
      latest.set(row.transaction_id, row);
    }
    const currencies = new Map<string, { currency: string; transactions: number; succeeded: number; failed: number; unknown: number }>();
    const mappings: Record<string, number> = {}, refunds = { required: 0, not_indicated: 0, unknown: 0 };
    for (const { payload, publication } of latest.values()) {
      const group = currencies.get(payload.currency) ?? { currency: payload.currency, transactions: 0, succeeded: 0, failed: 0, unknown: 0 };
      if (!['succeeded', 'failed', 'unknown'].includes(payload.transaction_status)) throw Error();
      group.transactions++; group[payload.transaction_status as 'succeeded' | 'failed' | 'unknown']++;
      currencies.set(payload.currency, group);
      mappings[publication.origin.mapping] = (mappings[publication.origin.mapping] ?? 0) + 1;
      const refund = publication.publisher_version === JOINT_SOURCE_PUBLISHER_VERSION
        ? jointIntakeLifecycle({ result: publication.origin.values[4], shouldrevert: publication.origin.review.shouldrevert }).refund_instruction : 'unknown';
      refunds[refund]++;
    }
    return { format: 'lmps-intake-revision-audit-1', execution_mode: 'test', source_kind: 'user_supplied_file',
      workspace, namespace, stored_revisions: revisions.length, transactions: latest.size, revised_transactions: changed,
      evidence_sha256: sourceEvidenceHash(revisions), mappings,
      currencies: [...currencies.values()].sort((first, second) => first.currency.localeCompare(second.currency)),
      refund_instruction: refunds, refund_completion: 'unverified',
      identity: { verified_transactions: 0, unresolved_sender_slots: latest.size, unresolved_receiver_slots: latest.size },
      source_semantics: 'unverified', business_payment_identity: 'unverified', payment_time: 'unverified', source_history_coverage: 'unverified',
      stored_revision_chains_verified: true, account_linkage_performed: false, assessment_performed: false,
      connection_authorized: false, production_ready: false };
  } catch { throw Error('INTAKE_REVISION_AUDIT_INVALID; private values withheld.'); }
}
