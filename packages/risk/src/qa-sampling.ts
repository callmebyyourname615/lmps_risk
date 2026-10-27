import {
  isQaSamplingCaller, isQaSamplingPool, isQaSamplingPolicy, isQaSamplingResult,
  QA_SAMPLING_BOUNDARY, QA_SAMPLING_VERSION, QaSamplingContractError,
  type QaSamplingResult,
} from '@lmps/contracts/qa-sampling';
import { riskHash } from './index.js';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Fixture-only audit: fractions describe this supplied pool, never a population. */
export function selectQaSampling(callerInput: unknown, poolInput: unknown, policyInput: unknown): QaSamplingResult {
  try {
    const caller: unknown = structuredClone(callerInput);
    const pool: unknown = structuredClone(poolInput);
    const policy: unknown = structuredClone(policyInput);
    if (!isQaSamplingCaller(caller) || !isQaSamplingPool(pool) || !isQaSamplingPolicy(policy)) throw new Error();
    // Canonical set order preserves all supplied fields, independent of presentation order.
    pool.rows.sort((a, b) => compare(a.fixture_id, b.fixture_id));
    for (const row of pool.rows) row.evidence.sort((a, b) => compare(a.evidence_id, b.evidence_id));
    policy.strata.sort((a, b) => compare(a.stratum_id, b.stratum_id));
    const declared = new Map(policy.strata.map(s => [s.stratum_id, s.alert_status]));
    if (pool.rows.some(r => declared.get(r.stratum_id) !== r.alert_status)) throw new Error();
    const policyHash = riskHash(policy);
    const strata = policy.strata.map(stratum => {
      const rows = pool.rows.filter(r => r.stratum_id === stratum.stratum_id);
      const eligible = rows.filter(r => r.evidence.every(e => e.available_at <= policy.as_of));
      const ranked = eligible.map(row => ({ row, rank: riskHash({ caller, policy_hash: policyHash,
        seed: policy.seed, stratum_id: stratum.stratum_id, alert_status: stratum.alert_status, fixture_id: row.fixture_id }) }));
      ranked.sort((a, b) => compare(a.rank, b.rank) || compare(a.row.fixture_id, b.row.fixture_id));
      const selected = ranked.slice(0, stratum.requested_count).map(r => r.row);
      return { ...stratum, status: rows.length === 0 ? 'missing' as const : eligible.length < stratum.requested_count ? 'insufficient' as const : 'satisfied' as const,
        pool_count: rows.length, eligible_count: eligible.length,
        excluded_future_evidence_count: rows.length - eligible.length, selected_count: selected.length,
        fraction: { numerator: selected.length, denominator: rows.length }, selected };
    });
    const result: QaSamplingResult = { ...QA_SAMPLING_BOUNDARY, contract_version: QA_SAMPLING_VERSION,
      caller, pool_id: pool.pool_id, pool_hash: riskHash(pool), policy_hash: policyHash, policy,
      population_claims: false, row_count: pool.row_count,
      selected_count: strata.reduce((sum, s) => sum + s.selected_count, 0), strata };
    if (!isQaSamplingResult(result)) throw new Error();
    return result;
  } catch { throw new QaSamplingContractError(); }
}
