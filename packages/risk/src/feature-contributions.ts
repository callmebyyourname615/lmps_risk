import {
  FEATURE_CATALOG_VERSION, VECTOR_FIELDS, canonicalFeatureJSON, detachFeatureJSON,
  featureGroupedHash, featureMoneyMinor, featurePolicyIdentity, featureRevisionAvailability,
  validateFeatureDelivery, validateFeaturePolicy, validateFeatureQuery, validateFeatureState, validateFeatureVector,
  type FeatureAvailability, type FeatureDelivery, type FeatureQuery, type FeatureRevision,
  type FeatureSnapshot, type FeatureState, type FeatureVector,
} from '@lmps/contracts/feature-catalog';

/** Pure synthetic algebra. Money outputs are canonical integer minor-unit strings.
 * No clock, TTL, lateness admission, IO or source attestation. Persist the complete envelope.
 */
export interface ContributionState {
  evidence: FeatureState;
  /** Retained delivery prefix for each frozen snapshot. */
  frozen_positions: number[];
  sha256: string;
}
export interface ContributionCorrection {
  account_id: string; currency: string; as_of: string;
  before: FeatureAvailability; after: FeatureAvailability;
  /** Unavailable evidence is never substituted with zero. */
  delta: FeatureVector | null;
}
export class FeatureContributionError extends Error {
  constructor(readonly code: 'CONTRIBUTION_CONFLICT' | 'CONTRIBUTION_STATE' | 'CONTRIBUTION_POSITION' | 'CONTRIBUTION_TIME') {
    super(code); this.name = 'FeatureContributionError';
  }
}
function check(ok: unknown, code: FeatureContributionError['code'] = 'CONTRIBUTION_STATE'): asserts ok {
  if (!ok) throw new FeatureContributionError(code);
}
function frozen<T>(v: T): T {
  if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v); }
  return v;
}
const equal = (a: unknown, b: unknown) => canonicalFeatureJSON(a) === canonicalFeatureJSON(b);
const zero = (): FeatureVector => Object.fromEntries(VECTOR_FIELDS.map(k => [k, '0'])) as FeatureVector;

function lineage(deliveries: FeatureDelivery[]): void {
  const payments = new Map<string, FeatureRevision>(), attempts = new Map<string, FeatureRevision>();
  const numbers = new Map<string, FeatureRevision>(), ids = new Map<string, FeatureRevision>();
  for (const { revision: r } of deliveries) {
    const p = payments.get(r.payment_id), a = attempts.get(r.attempt_id);
    check(!p || (p.account_id === r.account_id && p.currency === r.currency && p.occurred_at === r.occurred_at), 'CONTRIBUTION_CONFLICT');
    check(!a || (a.payment_id === r.payment_id && a.account_id === r.account_id), 'CONTRIBUTION_CONFLICT');
    const key = `${r.payment_id}/${r.revision_number}`;
    for (const old of [numbers.get(key), ids.get(r.revision_id)]) check(!old || equal(old, r), 'CONTRIBUTION_CONFLICT');
    payments.set(r.payment_id, r); attempts.set(r.attempt_id, r); numbers.set(key, r); ids.set(r.revision_id, r);
  }
}
function result(e: FeatureState, q: FeatureQuery, deliveries = e.deliveries): FeatureAvailability {
  check(q.as_of <= e.watermark, 'CONTRIBUTION_TIME');
  const end = Date.parse(q.as_of), start = end - e.policy.window_seconds * 1000;
  if (Date.parse(e.policy.coverage_start) > start) return { status: 'unavailable', reason: 'COVERAGE_INCOMPLETE' };
  const payments = new Map<string, FeatureRevision>(), attempts = new Map<string, FeatureRevision>();
  for (const { revision: r } of deliveries) {
    if (r.available_at > q.as_of || r.account_id !== q.account_id || r.currency !== q.currency) continue;
    const occurred = Date.parse(r.occurred_at);
    if (occurred <= start || occurred > end) continue;
    for (const [map, key] of [[payments, r.payment_id], [attempts, r.attempt_id]] as const) {
      if ((map.get(key)?.revision_number ?? 0) < r.revision_number) map.set(key, r);
    }
  }
  // Availability is checked before arithmetic, including failed/zero-valued attempts.
  // Sort to make unavailable-reason selection independent of delivery order.
  const selected = [...attempts.values(), ...payments.values()].sort((a, b) =>
    a.revision_id < b.revision_id ? -1 : a.revision_id > b.revision_id ? 1 : 0);
  for (const r of selected) {
    const reason = featureRevisionAvailability(r, e.policy);
    if (reason) return { status: 'unavailable', reason };
  }
  const v = zero();
  const add = (k: keyof FeatureVector, n: bigint) => { v[k] = String(BigInt(v[k]) + n); };
  for (const r of attempts.values()) { add('attempt_count', 1n); add('attempt_amount', featureMoneyMinor(r.attempt_amount)); }
  for (const r of payments.values()) {
    if (r.lifecycle === 'pending' || r.lifecycle === 'failed') continue;
    const gross = featureMoneyMinor(r.gross_amount), reversed = featureMoneyMinor(r.reversed_amount!), net = gross - reversed;
    check(net >= 0n);
    add('gross_count', 1n); add('gross_amount', gross); add('reversed_count', reversed > 0n ? 1n : 0n);
    add('reversed_amount', reversed); add('net_active_count', net > 0n ? 1n : 0n); add('net_amount', net);
  }
  return { status: 'available', vector: validateFeatureVector(v) };
}
function seal(evidence: FeatureState, frozen_positions: number[]): ContributionState {
  const body = { evidence, frozen_positions };
  const out = { ...body, sha256: featureGroupedHash([body]) };
  detachFeatureJSON(out, evidence.policy.limits.bytes);
  return frozen(out);
}
/** Initialize an immutable, detached envelope using exactly the US-801 policy. */
export function initializeFeatureContributions(config: unknown): ContributionState {
  const policy = validateFeaturePolicy(config);
  return seal(validateFeatureState({ version: FEATURE_CATALOG_VERSION, policy, next_position: 0,
    watermark: policy.watermark, deliveries: [], snapshots: [] }), []);
}
/** Validate complete bytes, immutable policy, lineage and hash; recompute frozen results
 * from their retained prefixes. Hashes provide integrity, not authentication.
 * US-803 owns watermark advancement/admission. Recovery accepts its explicitly supplied
 * nonregressed watermark; frozen prefixes are recomputed at their original watermark.
 */
export function restoreFeatureContributions(input: unknown, config: unknown): ContributionState {
  const x = detachFeatureJSON(input);
  check(x && Object.keys(x).sort().join(',') === 'evidence,frozen_positions,sha256');
  const e = validateFeatureState(x.evidence), p = validateFeaturePolicy(config);
  check(featurePolicyIdentity(e.policy) === featurePolicyIdentity(p));
  check(Array.isArray(x.frozen_positions) && x.frozen_positions.length === e.snapshots.length);
  lineage(e.deliveries);
  let last = 0, lastWatermark = p.watermark;
  for (const [i, s] of e.snapshots.entries()) {
    const cursor = x.frozen_positions[i];
    check(Number.isSafeInteger(cursor) && cursor >= last && cursor <= e.next_position && s.watermark >= lastWatermark);
    last = cursor; lastWatermark = s.watermark;
    check(equal(s.result, result({ ...e, watermark: s.watermark }, s.query, e.deliveries.slice(0, cursor))));
  }
  const restored = seal(e, x.frozen_positions);
  check(x.sha256 === restored.sha256);
  return restored;
}
/** Read-only query; no query count is consumed until materialization. */
export function evaluateFeatureContributions(input: ContributionState, query: unknown): FeatureAvailability {
  const s = checkedState(input);
  return frozen(result(s.evidence, validateFeatureQuery(query, s.evidence.policy)));
}
/** One contiguous delivery or exact positioned replay. Return new-minus-old corrections
 * at explicit as_of (default: supplied policy watermark). A replay emits no correction;
 * a duplicate revision at a new position retains history and emits a zero delta.
 * Currency/binding changes conflict. Failed calls leave all input and prior outputs intact.
 */
export function applyFeatureContribution(input: ContributionState, delivery: unknown, as_of?: string):
  { state: ContributionState; corrections: ContributionCorrection[] } {
  const s = checkedState(input), e = s.evidence;
  if (as_of === undefined) as_of = e.watermark;
  const d = validateFeatureDelivery(delivery, e.policy);
  const q = validateFeatureQuery({ id: 'synthetic_correction', account_id: d.revision.account_id, currency: d.revision.currency, as_of }, e.policy);
  check(as_of <= e.watermark, 'CONTRIBUTION_TIME');
  if (d.position < e.next_position) {
    check(equal(e.deliveries[d.position], d), 'CONTRIBUTION_CONFLICT');
    return frozen({ state: s, corrections: [] });
  }
  check(d.position === e.next_position, 'CONTRIBUTION_POSITION');
  const next = validateFeatureState({ ...e, next_position: e.next_position + 1, deliveries: [...e.deliveries, d] });
  lineage(next.deliveries);
  const before = result(e, q), after = result(next, q);
  let delta: FeatureVector | null = null;
  if (before.status === 'available' && after.status === 'available') {
    delta = validateFeatureVector(Object.fromEntries(VECTOR_FIELDS.map(k => [k, String(BigInt(after.vector[k]) - BigInt(before.vector[k]))])), true);
  }
  return frozen({ state: seal(next, [...s.frozen_positions]), corrections: [{ account_id: q.account_id, currency: q.currency, as_of, before, after, delta }] });
}
/** Freeze query evidence and its prefix. Exact query-ID replay returns the original snapshot;
 * changed content conflicts. Later corrections never rewrite frozen outputs.
 */
export function materializeFeatureContributions(input: ContributionState, query: unknown):
  { state: ContributionState; snapshot: FeatureSnapshot; sha256: string } {
  const s = checkedState(input), e = s.evidence;
  const q = validateFeatureQuery(query, e.policy), previous = e.snapshots.find(x => x.query.id === q.id);
  if (previous) {
    check(equal(previous.query, q), 'CONTRIBUTION_CONFLICT');
    return frozen({ state: s, snapshot: previous, sha256: featureGroupedHash([previous]) });
  }
  const snapshot: FeatureSnapshot = { version: FEATURE_CATALOG_VERSION, query: q, watermark: e.watermark, result: result(e, q) };
  const next = validateFeatureState({ ...e, snapshots: [...e.snapshots, snapshot] });
  return frozen({ state: seal(next, [...s.frozen_positions, e.next_position]), snapshot, sha256: featureGroupedHash([snapshot]) });
}

function checkedState(input: unknown): ContributionState {
  const x = detachFeatureJSON(input);
  return restoreFeatureContributions(x, x?.evidence?.policy);
}
