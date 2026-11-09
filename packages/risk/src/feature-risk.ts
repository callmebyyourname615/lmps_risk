import { validateFeatureStoreScope, validateFeatureServingRequest, validateFeaturePublication,
  type FeatureServingResult } from '@lmps/contracts/feature-serving';
import type { RiskEvent, TransactionRiskResult } from '@lmps/contracts/transaction-risk';
import { serveFeatureSnapshot } from './feature-serving.js';
import { evaluateTransactionRisk, validateRiskRequest, validateRiskObservation, riskHash, RiskError } from './index.js';

export interface FeatureRiskResult {
  version: 'synthetic-feature-risk-1'; production_ready: false;
  feature: FeatureServingResult;
  publication: { generation: number; content_hash: string } | null;
  context: { status: 'available' | 'withheld'; reason: string | null };
  assessment: TransactionRiskResult;
  lineage: { scope_sha256: string; serving_request_sha256: string; policy_sha256: string | null;
    source_prefix: number | null; source_sha256: string | null; observation_revision_sha256: string | null;
    revision_attestation: 'caller_binding_only'; source_semantics: 'unverified'; identity_scope: 'synthetic_only' };
}

// Traverse descriptors before invoking any schema or cloning utility.
function detach(input: unknown): unknown {
  let budget = 1048576;
  const active = new Set<object>();
  const invalid = () => { throw new RiskError('RISK_INPUT_INVALID'); };
  const spend = (n: number) => { if ((budget -= n) < 0) invalid(); };
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 40) return invalid();
    if (v === null || typeof v === 'boolean') { spend(5); return v; }
    if (typeof v === 'string') { spend(Buffer.byteLength(JSON.stringify(v))); return v; }
    if (typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0)) { spend(24); return v; }
    if (!v || typeof v !== 'object' || active.has(v)) return invalid();
    const array = Array.isArray(v), keys = Reflect.ownKeys(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype) || keys.length > 2001
      || (array && (v.length > 2000 || keys.length !== v.length + 1))) return invalid();
    active.add(v); spend(2);
    const out: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || (array && key !== String((out as unknown[]).length))) return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) return invalid();
      spend(key.length * 6 + 4);
      (out as Record<string, unknown>)[key] = walk(descriptor.value, depth + 1);
    }
    active.delete(v); return out;
  };
  return walk(input, 0);
}

/** Inert IO-free synthetic P04 bridge, reusing all fifteen risk detectors.
 * Serving restores/recomputes frozen arithmetic through restoreFeatureStream.
 * Only snapshot.next_offset history available_at <= as_of supplies context;
 * the existing 200-event risk contract is enforced without truncation.
 * Synthetic declarations and caller-provided observation revision hashes are
 * bindings, not verified source attestation. P04 carries no source revision hash.
 * No production context/account linkage, flagged-account evidence, calibrated
 * probabilities or enforcement. Missing/stale/partial serving withholds context;
 * the independent observation may retain its amount finding. Scores retain the
 * evaluator's separate Fraud/Mule/AML semantics, including nonexecution/zero.
 */
function prepareFeatureRisk(publicationOrNull: unknown, exactScope: unknown, servingRequest: unknown,
  riskRequest: unknown, observation: unknown) {
  const scope = validateFeatureStoreScope(exactScope), serving = validateFeatureServingRequest(servingRequest);
  const request = validateRiskRequest(detach(riskRequest)), source = validateRiskObservation(detach(observation));
  const conflict = () => { throw new RiskError('RISK_CONTEXT_CONFLICT'); };
  if (request.context !== null) conflict();
  if (scope.workspace_key !== request.workspace_key || serving.workspace_key !== request.workspace_key
    || scope.plan.namespace !== request.target.namespace || serving.plan.namespace !== request.target.namespace
    || serving.query.target !== request.target.transaction_id || !request.policy
    || request.policy.window_seconds !== 3600 || request.policy.currency !== serving.currency
    || (source.status === 'available' && (source.currency !== serving.currency
      || Date.parse(source.observed_at!) !== Date.parse(serving.query.as_of)))) conflict();
  const feature = serveFeatureSnapshot(publicationOrNull, scope, serving);
  const publication = publicationOrNull === null ? null : validateFeaturePublication(publicationOrNull);
  const snapshot = publication?.state.snapshots.find(s => riskHash(s.query) === riskHash(serving.query));
  const history = snapshot && publication ? publication.state.deliveries.slice(0, snapshot.next_offset)
    .map(d => d.event).filter(e => Date.parse(e.available_at) <= Date.parse(serving.query.as_of)) : null;
  const unique = new Map<string, RiskEvent>();
  for (const event of history ?? []) unique.set(JSON.stringify([event.namespace, event.transaction_id, event.revision_number]), event);
  let target: RiskEvent | undefined;
  for (const event of unique.values()) if (event.namespace === request.target.namespace && event.transaction_id === request.target.transaction_id
    && (!target || event.revision_number > target.revision_number)) target = event;
  if (snapshot && (!target || target.revision_number !== request.target.revision_number
    || Date.parse(target.occurred_at) > Date.parse(serving.query.as_of)
    || (source.status === 'available' && (target.amount !== source.amount || target.reversed_amount !== source.reversed_amount
      || target.currency !== source.currency || target.status !== source.transaction_status)))) conflict();
  if (history?.some(e => Date.parse(e.available_at) < Date.parse(e.occurred_at))) conflict();
  const reason = feature.status === 'unavailable' ? feature.reason : source.status !== 'available' ? 'OBSERVATION_UNAVAILABLE'
    : unique.size > 200 ? 'RISK_CONTEXT_LIMIT_EXCEEDED' : null;
  if (reason === null) request.context = {
    binding: { ...request.target, revision_sha256: source.revision_sha256! }, identity_status: 'synthetic_declared',
    as_of: serving.query.as_of, coverage_start: scope.plan.coverage_start, coverage_complete: serving.query.coverage_complete,
    events: [...unique.values()], flagged_accounts: null, flagged_accounts_version: null,
  };
  return { request, source, feature, publication, snapshot, history, reason, scope, serving };
}

/** Freeze only the synthetic context already verified by the P04 bridge. */
export function bindFeatureRiskRequest(publicationOrNull: unknown, exactScope: unknown, servingRequest: unknown,
  riskRequest: unknown, observation: unknown) {
  return validateRiskRequest(prepareFeatureRisk(publicationOrNull, exactScope, servingRequest, riskRequest, observation).request);
}

export function evaluateFeatureRisk(publicationOrNull: unknown, exactScope: unknown, servingRequest: unknown,
  riskRequest: unknown, observation: unknown): FeatureRiskResult {
  const { request, source, feature, publication, snapshot, history, reason, scope, serving } = prepareFeatureRisk(publicationOrNull, exactScope, servingRequest, riskRequest, observation);
  const assessment = evaluateTransactionRisk(request, source);
  return { version: 'synthetic-feature-risk-1', production_ready: false, feature,
    publication: publication ? { generation: publication.generation, content_hash: publication.content_hash } : null,
    context: { status: reason === null ? 'available' : 'withheld', reason }, assessment,
    lineage: { scope_sha256: riskHash(scope), serving_request_sha256: riskHash(serving), policy_sha256: request.policy ? riskHash(request.policy) : null,
      source_prefix: snapshot?.next_offset ?? null, source_sha256: history ? riskHash(history) : null,
      observation_revision_sha256: source.revision_sha256, revision_attestation: 'caller_binding_only',
      source_semantics: 'unverified', identity_scope: 'synthetic_only' } };
}
