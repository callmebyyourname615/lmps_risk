import { randomUUID } from 'node:crypto';
import { publicationFixture } from '../../../contracts/fixtures/synthetic-publication.mjs';
import { RULE_EVALUATOR_VERSION } from '../../dist/index.js';

export function assessmentFixture() {
  const revision = publicationFixture();
  const target = { namespace: revision.transaction.source_reference.namespace, transaction_id: revision.transaction.transaction_id, revision_number: 1 };
  return {
    revision,
    observations: [{ target, revision }],
    manifest: { format: 1, provenance: 'local_synthetic', execution_mode: 'test', evaluator_version: RULE_EVALUATOR_VERSION,
      run_id: randomUUID(), workspace_key: 'synthetic_local', targets: [target], rules: [
        { rule_id: 'synthetic_amount', rule_version: 'synthetic_v1', risk_dimension: 'fraud', kind: 'amount_gte', currency: 'SYN', statuses: ['succeeded'], threshold: '1.00' },
        { rule_id: 'synthetic_aml', rule_version: 'synthetic_v1', risk_dimension: 'aml', kind: 'amount_gte', currency: 'SYN', statuses: ['succeeded'], threshold: '999.00' },
      ] },
  };
}
