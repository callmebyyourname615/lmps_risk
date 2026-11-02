import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { validateFeatureParityPlan, featureParityPlanHash, FEATURE_PARITY_SEMANTICS } from '@lmps/contracts/feature-parity';

export const FEATURE_HEALTH_LIMITS = Object.freeze({ rows: 8, versions: 1 });
export type FeatureHealthStatus = 'available' | 'partial' | 'unavailable' | 'retrospective' | 'unsupported';
export interface FeatureHealthSource {
  status: FeatureHealthStatus; as_of: string | null; available_at: string | null;
  source_position: number | null; consumed_position: number | null; plan_sha256: string;
}
export interface FeatureHealthInput { plan: unknown; now: string; max_age_seconds: number; sources: FeatureHealthSource[] }
function check(v: unknown): asserts v { if (!v) throw new Error('FEATURE_HEALTH_INVALID'); }
function timestamp(v: unknown): number {
  check(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v));
  const n = Date.parse(v); check(Number.isFinite(n) && new Date(n).toISOString() === v.replace('Z', '.000Z')); return n;
}
export function freezeFeatureEvidence<T>(v: T): T {
  if (v && typeof v === 'object') { Object.values(v).forEach(freezeFeatureEvidence); Object.freeze(v); } return v;
}
/** Explicit synthetic clock; counts never prove historical completeness.
 * No production observability, legal retention/hold, RPO/RTO or SLO closure.
 */
export function evaluateFeatureHealth(input: FeatureHealthInput) {
  const x = detachFeatureJSON(input) as FeatureHealthInput;
  check(Object.keys(x).sort().join(',') === 'max_age_seconds,now,plan,sources');
  const plan = validateFeatureParityPlan(x.plan), now = timestamp(x.now), identity = featureParityPlanHash(plan);
  const compatible = (Object.keys(FEATURE_PARITY_SEMANTICS) as (keyof typeof FEATURE_PARITY_SEMANTICS)[]).every(k => plan.semantics[k] === FEATURE_PARITY_SEMANTICS[k]);
  check(x.now === plan.fixture.now && Number.isSafeInteger(x.max_age_seconds) && x.max_age_seconds >= 0 && x.max_age_seconds <= 31536000);
  check(Array.isArray(x.sources) && x.sources.length <= 8 && x.sources.length === plan.queries.length);
  const statuses = { available: 0, partial: 0, unavailable: 0, retrospective: 0, unsupported: 0 };
  let unknown = 0, stale = 0, lagging = 0, lag = 0, age = 0;
  for (const r of x.sources) {
    check(Object.keys(r).sort().join(',') === 'as_of,available_at,consumed_position,plan_sha256,source_position,status');
    check(Object.hasOwn(statuses, r.status) && typeof r.plan_sha256 === 'string'); statuses[r.status]++;
    const positions = [r.source_position, r.consumed_position];
    check(positions.every(p => p === null || (Number.isSafeInteger(p) && !Object.is(p, -0))));
    const asof = r.as_of === null ? null : timestamp(r.as_of), available = r.available_at === null ? null : timestamp(r.available_at);
    if (!compatible || r.plan_sha256 !== identity || asof === null || available === null || asof > now || available > now || positions.some(p => p === null || p < 0) || r.consumed_position! > r.source_position!) { unknown++; continue; }
    const a = (now - asof) / 1000, l = r.source_position! - r.consumed_position!;
    check(Number.isSafeInteger(lag + l)); lag += l; age = Math.max(age, a);
    if (a > x.max_age_seconds) stale++; if (l > 0) lagging++;
  }
  const unavailable = x.sources.length - statuses.available;
  return freezeFeatureEvidence({ version: 'local-synthetic-health-1' as const, production_ready: false as const,
    coverage: 'supplied_evidence_only' as const, status: unknown || unavailable || stale || lagging ? 'unavailable' as const : 'available' as const,
    total: x.sources.length, statuses, unknown, unavailable, stale, lagging,
    position_lag: unknown ? null : lag, max_age_seconds: unknown ? null : age });
}
