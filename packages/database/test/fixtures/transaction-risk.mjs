import { publicationFixture } from '../../../contracts/fixtures/synthetic-publication.mjs';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { riskHash } from '@lmps/risk';
import { riskFixture } from '../../../risk/fixtures/request.mjs';
import { riskObservation } from '../../dist/index.js';

export function transactionRiskFixture() {
  const f = riskFixture(), revision = publicationFixture(), p = revision.publication;
  p.binding.transaction_id = f.request.target.transaction_id; p.normalization_input.amount = f.observation.amount;
  p.source.observed_at = p.normalization_input.observed_at = f.observation.observed_at;
  revision.transaction = publicationTransaction(p).transaction;
  f.request.context.binding.revision_sha256 = riskHash(revision);
  return { request: f.request, revision, observation: riskObservation(f.request.target, revision) };
}
