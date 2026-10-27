import { randomUUID } from 'node:crypto';
import { publicationFixture } from '../../../../packages/contracts/fixtures/synthetic-publication.mjs';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { RULE_EVALUATOR_VERSION } from '../../dist/rule-backtest.js';

export function observationFromRevision(revision) {
  return { target: { namespace: revision.transaction.source_reference.namespace, transaction_id: revision.transaction.transaction_id,
    revision_number: revision.expected_revision + 1 }, revision };
}
export function changePublication(observation, change) {
  const revision = structuredClone(observation.revision); change(revision.publication);
  revision.transaction = publicationTransaction(revision.publication).transaction;
  revision.expected_revision = revision.publication.binding.expected_revision;
  return observationFromRevision(revision);
}
export function backtestFixture() {
  const revision = publicationFixture(); revision.publication.normalization_input.amount = '42.50';
  revision.transaction = publicationTransaction(revision.publication).transaction;
  const observation = observationFromRevision(revision);
  const rules = [
    { rule_id: 'synthetic_large_amount', rule_version: 'synthetic_v1', risk_dimension: 'fraud', kind: 'amount_gte', currency: 'SYN', statuses: ['succeeded'], threshold: '40.00' },
    { rule_id: 'synthetic_aml_amount', rule_version: 'synthetic_v1', risk_dimension: 'aml', kind: 'amount_gte', currency: 'SYN', statuses: ['succeeded'], threshold: '100.00' },
  ];
  return { manifest: { format: 1, provenance: 'local_synthetic', execution_mode: 'test', evaluator_version: RULE_EVALUATOR_VERSION,
    run_id: randomUUID(), workspace_key: 'synthetic_local', rules, targets: [observation.target] }, observations: [observation] };
}
