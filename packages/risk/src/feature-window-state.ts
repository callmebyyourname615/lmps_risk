import { canonicalFeatureJSON, detachFeatureJSON, featureGroupedHash, validateFeatureDelivery, validateFeatureQuery, type FeatureAvailability } from '@lmps/contracts/feature-catalog';
import { initializeFeatureContributions, restoreFeatureContributions, applyFeatureContribution, evaluateFeatureContributions, materializeFeatureContributions, type ContributionState, type ContributionCorrection } from './feature-contributions.js';

/** Synthetic fixture only. Window (as_of-window,as_of]; admission accepts
 * occurred_at >= current watermark - allowed_lateness_seconds, including equality.
 * This applies to newly positioned deliveries (including new-position duplicates);
 * exact positioned replay is checked against retained evidence before admission.
 * TTL expires only after occurred_at+TTL; equality remains active per US-801.
 * Evidence with available_at > watermark remains retained until eligible.
 * Active cache expiry never deletes bounded lineage or frozen snapshot evidence.
 * Historical queries recompute from lineage, selecting available_at <= as_of <= watermark.
 * Per-key limits count all retained deliveries for account_id/currency, not just active
 * entries. TTL cannot replenish these or the independent payment/attempt/revision caps.
 * All APIs return detached frozen values; persist the whole envelope for restore.
 * No source completeness or legal deletion claim.
 */
export interface FeatureWindowState {
  contributions: ContributionState;
  admission_watermarks: string[];
  active: { positions: number[]; buckets: { account_id: string; currency: string; result: FeatureAvailability }[] };
  sha256: string;
}
/** Rejection is not an acknowledgement: retry the same position after resolving
 * admission, or stop. No rejection record is retained and no cursor is advanced. */
export type FeatureWindowApplyResult =
  | { status: 'applied'; state: FeatureWindowState; corrections: ContributionCorrection[] }
  | { status: 'rejected'; reason: 'LATE_EVENT' | 'LIMIT_EXCEEDED'; state: FeatureWindowState };
export class FeatureWindowError extends Error {
  constructor(readonly code: 'WINDOW_STATE' | 'WINDOW_TIME') { super(code); this.name = 'FeatureWindowError'; }
}
function check(ok: unknown, code: FeatureWindowError['code'] = 'WINDOW_STATE'): asserts ok { if (!ok) throw new FeatureWindowError(code); }
function freeze<T>(x: T): T { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
const equal = (a: unknown, b: unknown) => canonicalFeatureJSON(a) === canonicalFeatureJSON(b);
function timestamp(value: unknown, c: ContributionState): string {
  return validateFeatureQuery({ id: 'synthetic_clock', account_id: 'synthetic_clock', currency: c.evidence.policy.currencies[0], as_of: value }, c.evidence.policy).as_of;
}
function seal(contributions: ContributionState, admission_watermarks: string[]): FeatureWindowState {
  const e = contributions.evidence, p = e.policy;
  const retained = e.deliveries.filter(({ revision: r }) => r.available_at > e.watermark || Date.parse(e.watermark) <= Date.parse(r.occurred_at) + p.active_ttl_seconds * 1000);
  const keys = new Map<string, { account_id: string; currency: string }>();
  for (const { revision: r } of retained) keys.set(`${r.account_id}/${r.currency}`, { account_id: r.account_id, currency: r.currency });
  const active = { positions: retained.map(d => d.position), buckets: [...keys.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, k]) => ({ ...k, result: evaluateFeatureContributions(contributions, { ...k, id: 'synthetic_active', as_of: e.watermark }) })) };
  const body = { contributions, admission_watermarks, active }, out = { ...body, sha256: featureGroupedHash([body]) };
  detachFeatureJSON(out, p.limits.bytes); return freeze(out);
}
/** Persist complete envelope; immutable policy includes initial watermark and anchor. */
export function initializeFeatureWindowState(config: unknown): FeatureWindowState { return seal(initializeFeatureContributions(config), []); }
/** Recompute lineage, frozen results, active contributions and hashes. Hashes are integrity, not authentication. */
export function restoreFeatureWindowState(input: unknown, config: unknown): FeatureWindowState {
  const x = detachFeatureJSON(input);
  check(x && Object.keys(x).sort().join(',') === 'active,admission_watermarks,contributions,sha256');
  const c = restoreFeatureContributions(x.contributions, config), e = c.evidence;
  check(Array.isArray(x.admission_watermarks) && x.admission_watermarks.length === e.next_position);
  let previous = e.policy.watermark;
  for (const [i, raw] of x.admission_watermarks.entries()) {
    const wm = timestamp(raw, c); check(wm >= previous && wm <= e.watermark);
    check(Date.parse(e.deliveries[i]!.revision.occurred_at) >= Date.parse(wm) - e.policy.allowed_lateness_seconds * 1000); previous = wm;
  }
  for (const [i, snapshot] of e.snapshots.entries()) {
    const pos = c.frozen_positions[i]!;
    check(pos === 0 || x.admission_watermarks[pos - 1] <= snapshot.watermark);
    check(pos === e.next_position || snapshot.watermark <= x.admission_watermarks[pos]);
  }
  const out = seal(c, x.admission_watermarks); check(equal(x.active, out.active) && x.sha256 === out.sha256); return out;
}
function checked(input: FeatureWindowState): FeatureWindowState { const x = detachFeatureJSON(input); return restoreFeatureWindowState(x, x?.contributions?.evidence?.policy); }
/** Contiguous apply or exact replay. Rejections retain no record and commit no cursor.
 * Malformed/conflicting/gapped deliveries throw. History/key/byte caps reject explicitly.
 */
export function applyFeatureWindowState(input: FeatureWindowState, delivery: unknown): FeatureWindowApplyResult {
  const s = checked(input), e = s.contributions.evidence;
  const raw = detachFeatureJSON(delivery, e.policy.limits.bytes);
  // Position 2000 is the first exhausted absolute cursor, not an accepted delivery.
  // Validate every other field before returning its explicit limit rejection.
  const d = validateFeatureDelivery(raw?.position === 2000 ? { ...raw, position: 1999 } : raw,
    { ...e.policy, limits: { ...e.policy.limits, deliveries: 2000 } });
  if (raw.position === 2000) d.position = 2000;
  check(d.position <= e.next_position);
  if (d.position === e.next_position && Date.parse(d.revision.occurred_at) < Date.parse(e.watermark) - e.policy.allowed_lateness_seconds * 1000)
    return freeze({ status: 'rejected' as const, reason: 'LATE_EVENT' as const, state: s });
  try {
    if (d.position === e.next_position && e.next_position >= e.policy.limits.deliveries) return freeze({ status: 'rejected' as const, reason: 'LIMIT_EXCEEDED' as const, state: s });
    const out = applyFeatureContribution(s.contributions, d);
    return freeze({ status: 'applied' as const, state: seal(out.state, d.position < e.next_position ? s.admission_watermarks : [...s.admission_watermarks, e.watermark]), corrections: out.corrections });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FEATURE_LIMIT') return freeze({ status: 'rejected' as const, reason: 'LIMIT_EXCEEDED' as const, state: s });
    throw error;
  }
}
/** Explicit monotonic UTC watermark; equality is idempotent, never wall-clock driven. */
export function advanceFeatureWatermark(input: FeatureWindowState, watermark: unknown): FeatureWindowState {
  const s = checked(input), c = s.contributions, wm = timestamp(watermark, c); check(wm >= c.evidence.watermark, 'WINDOW_TIME');
  const body = { evidence: { ...c.evidence, watermark: wm }, frozen_positions: c.frozen_positions };
  return seal(restoreFeatureContributions({ ...body, sha256: featureGroupedHash([body]) }, c.evidence.policy), s.admission_watermarks);
}
/** Frozen query replay preserves original result/prefix after correction or TTL expiry. */
export function snapshotFeatureWindowState(input: FeatureWindowState, query: unknown) {
  const s = checked(input), out = materializeFeatureContributions(s.contributions, query);
  return freeze({ state: seal(out.state, s.admission_watermarks), snapshot: out.snapshot, sha256: out.sha256 });
}
