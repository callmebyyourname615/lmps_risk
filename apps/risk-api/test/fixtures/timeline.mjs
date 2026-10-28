import { randomUUID } from 'node:crypto';
import { overviewFixture } from './overview.mjs';
import { publicationTransaction } from '../../../../packages/contracts/dist/synthetic-publication.js';
import { alertFixture } from '../../../../packages/database/test/fixtures/alert.mjs';

export async function timelineFixture() {
  const fixture = await overviewFixture();
  try {
    const entry = fixture.entries[0], alertPolicy = alertFixture().policy;
    for (const [revisionNumber, code] of [[3, 'SYNTH_REVERSAL_REQUESTED'], [4, 'SYNTH_REVERSAL_FAILED'], [5, 'SYNTH_REVERSAL_PARTIAL_COMPLETED'], [6, 'SYNTH_REVERSAL_FULL_COMPLETED']]) {
      const revision = structuredClone(entry.revision), publication = revision.publication;
      revision.expected_revision = publication.binding.expected_revision = revisionNumber - 1;
      publication.binding.transaction_revision = 'synthetic_revision_' + revisionNumber;
      publication.normalization_input.reversal_code = code;
      publication.normalization_input.synthetic_payment_ref = entry.id;
      if (revisionNumber >= 5) {
        const original = BigInt(publication.normalization_input.amount.replace('.', '')), units = revisionNumber === 5 ? original / 2n : original;
        const event = { event_ref: 'synthetic_reversal_confirmed', amount: `${units / 100n}.${String(units % 100n).padStart(2, '0')}`, currency: publication.normalization_input.currency, completed: true };
        publication.normalization_input.reversal_evidence = { original_payment_ref: entry.id, events: [event, structuredClone(event)] };
      }
      revision.transaction = publicationTransaction(publication).transaction;
      await fixture.writer.append(revision);
      const request = structuredClone(entry.request); request.run_id = randomUUID(); request.target.revision_number = revisionNumber; request.context = null;
      await fixture.risks.evaluate(request);
      await fixture.alerts.generate({ format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', assessment_run_id: request.run_id, policy: alertPolicy });
    }
    return { ...fixture, target: { namespace: entry.request.target.namespace, transaction_id: entry.id } };
  } catch (error) { await fixture.close(); throw error; }
}
