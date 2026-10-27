import { FeatureServingError, FEATURE_SERVING_VERSION, validateFeatureStoreScope,
  validateFeaturePublication, validateFeatureServingRequest, featurePublicationContentHash,
  type FeatureServingResult, type FeatureUnavailableReason } from '@lmps/contracts/feature-serving';
import { restoreFeatureStream } from './feature-stream.js';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Deterministic, IO-free local synthetic API for store adapters and acceptance.
 * serveFeatureSnapshot(publicationOrNull, exactScope, request) detaches and
 * validates all inputs and recomputes every frozen snapshot before any lookup.
 * Malformed shapes, versions, hashes or arithmetic throw FEATURE_SERVING_INVALID.
 * Unavailability precedence: request scope, request policy, absent publication,
 * publication scope, publication policy, generation, future publication, expiry,
 * future query, absent snapshot, missing/partial input, source age.
 * Full plan equality includes historical query definitions and currency. An
 * absent snapshot for a configured query is QUERY_MISSING; an unknown query is
 * malformed under US-701. Age equality is permitted; expiry equality is not.
 * Available provenance retains detached full publication and frozen snapshot.
 * No clock defaults, cache, scoring or enforcement. Explicit fixture policies
 * and UTC times are not owner-approved production freshness rules.
 */
export function serveFeatureSnapshot(publicationOrNull: unknown, exactScope: unknown, input: unknown): FeatureServingResult {
  try {
    const scope = validateFeatureStoreScope(exactScope);
    const request = validateFeatureServingRequest(input);
    const publication = publicationOrNull === null ? null : validateFeaturePublication(publicationOrNull);
    if (publication) {
      publication.state = restoreFeatureStream(publication.state, publication.scope.plan);
      if (publication.content_hash !== featurePublicationContentHash(publication)) throw new FeatureServingError();
    }
    const base = { version: FEATURE_SERVING_VERSION, request };
    const unavailable = (reason: FeatureUnavailableReason): FeatureServingResult =>
      ({ ...base, status: 'unavailable', reason, count: null, amount: null, provenance: null });
    if (request.workspace_key !== scope.workspace_key || !same(request.plan, scope.plan)) return unavailable('SCOPE_MISMATCH');
    if (!same(request.policy, scope.policy)) return unavailable('POLICY_MISMATCH');
    if (!publication) return unavailable('PUBLICATION_MISSING');
    if (publication.scope.workspace_key !== scope.workspace_key || !same(publication.scope.plan, scope.plan)) return unavailable('SCOPE_MISMATCH');
    if (!same(publication.scope.policy, scope.policy)) return unavailable('POLICY_MISMATCH');
    if (publication.generation < (request.minimum_generation ?? 1)) return unavailable('GENERATION_TOO_OLD');
    const now = Date.parse(request.now);
    if (now < Date.parse(publication.published_at)) return unavailable('FUTURE_PUBLICATION');
    if (now >= Date.parse(publication.expires_at)) return unavailable('PUBLICATION_EXPIRED');
    if (now < Date.parse(request.query.as_of)) return unavailable('FUTURE_EVIDENCE');
    const snapshot = publication.state.snapshots.find(s => same(s.query, request.query));
    if (!snapshot) return unavailable('QUERY_MISSING');
    if (snapshot.reason !== null) return unavailable(snapshot.reason);
    if (now - Date.parse(snapshot.query.as_of) > scope.policy.max_age_seconds * 1000) return unavailable('SOURCE_STALE');
    return { ...base, status: 'available', reason: null, count: snapshot.count!, amount: snapshot.amount!, provenance: { publication, snapshot } };
  } catch { throw new FeatureServingError(); }
}
