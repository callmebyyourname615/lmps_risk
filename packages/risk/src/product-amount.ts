import { localRiskMode } from './index.js';

/** Candidate recorded-major-unit LAK profile, not an approved or enforced policy. */
export const LAK_PRODUCT_AMOUNT_PROFILE = Object.freeze({
  version: 'lak_product_amount_candidate_v1', currency: 'LAK',
  review: '20000000.00', high: '100000000.00', near_cap: '180000000.00', cap: '200000000.00',
  backtest_thresholds: Object.freeze(['20000000.00', '50000000.00', '100000000.00', '180000000.00']),
  authority: 'user_declared_candidate', product_scope: 'unverified', amount_units: 'unverified', enforcement: false,
});

export function classifyProductAmount(input: unknown) {
  try {
    localRiskMode();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype
      || Reflect.ownKeys(input).length !== 2) throw Error();
    const values = ['amount', 'currency'].map(name => {
      const d = Object.getOwnPropertyDescriptor(input, name);
      if (!d?.enumerable || !('value' in d) || typeof d.value !== 'string') throw Error();
      return d.value as string;
    });
    const [amount, currency] = values as [string, string];
    if (!/^-?(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) throw Error();
    const value = BigInt(amount.replace('.', '')), units = (s: string) => BigInt(s.replace('.', ''));
    const p = LAK_PRODUCT_AMOUNT_PROFILE;
    const band = currency !== p.currency ? 'currency_out_of_scope' : value <= 0n ? 'nonpositive_withheld'
      : value > units(p.cap) ? 'above_cap' : value >= units(p.near_cap) ? 'near_cap'
        : value >= units(p.high) ? 'high' : value >= units(p.review) ? 'review' : 'below_review';
    return { profile_version: p.version, band, candidate_only: true as const, product_scope: 'unverified' as const,
      amount_units: 'unverified' as const, net_execution: 'unverified' as const, enforcement: false as const };
  } catch { throw Error('PRODUCT_AMOUNT_INVALID; source values withheld.'); }
}
