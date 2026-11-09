import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { FeatureServingError, validateFeatureStoreScope, validateFeatureServingRequest,
  featureStoreScopeIdentity, type FeaturePublication } from '@lmps/contracts/feature-serving';
import { evaluateFeatureRisk, type FeatureRiskResult } from '@lmps/risk';
import type { openFeatureServingAdapter } from './feature-serving-adapter.js';

export class FeatureRiskStorageUnavailableError extends Error {
  readonly code = 'FEATURE_RISK_STORAGE_UNAVAILABLE';
  constructor() { super('Local synthetic feature storage unavailable'); this.name = 'FeatureRiskStorageUnavailableError'; }
}

/** One synchronous bounded no-cache assessment from the existing local adapter
 * or snapshot store read contract. Caller owns open/close and releases its lock
 * in finally. No asynchronous IO or handles are created here. A reader is a
 * trusted IO seam, not provider acceptance. Requests detach/validate before the
 * sole read. Summary DTOs cannot replace publications. Only known store errors
 * become storage-unavailable; unexpected errors propagate. Invalid publications
 * never become missing. Synthetic source/identity and caller revision bindings
 * remain unverified; no production authorization or account-linkage claim.
 */
export function serveFeatureRisk(store: Pick<ReturnType<typeof openFeatureServingAdapter>, 'read'>,
  exactScope: unknown, servingRequest: unknown, riskRequest: unknown, observation: unknown): FeatureRiskResult {
  const input = detachFeatureJSON({ scope: exactScope, serving: servingRequest, risk: riskRequest, observation });
  const scope = validateFeatureStoreScope(input.scope), serving = validateFeatureServingRequest(input.serving);
  if (featureStoreScopeIdentity({ ...scope, workspace_key: serving.workspace_key, plan: serving.plan })
    !== featureStoreScopeIdentity(scope)) throw new FeatureServingError();
  // Validate every publication-independent binding, including caller context,
  // before IO; the real publication is restored/recomputed by the bridge below.
  evaluateFeatureRisk(null, scope, serving, input.risk, input.observation);
  let publication: FeaturePublication | null;
  try { publication = store.read(); }
  catch (error) {
    if (error instanceof FeatureServingError) throw new FeatureRiskStorageUnavailableError();
    throw error;
  }
  return evaluateFeatureRisk(detachFeatureJSON(publication), scope, serving, input.risk, input.observation);
}
