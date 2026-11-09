/** User declarations for current-snapshot screening, not verified account identity. */
export const OBSERVED_MASK_SOURCE_PROFILE = Object.freeze({
  version: 'bank_mask_snapshot_candidate_v1', authority: 'user_declared',
  product: 'cross_bank_transfer', product_scope: 'user_declared_not_independently_verified',
  currency: 'LAK', amount_unit: 'major', product_cap: '200000000.00',
  sender_bank_field: 'frommember', receiver_bank_field: 'tomember',
  sender_representation_field: 'fromaccount', receiver_representation_field: 'toaccount',
  mask_stability: 'user_declared', mask_uniqueness: 'unverified',
  cross_role_consistency: 'mostly_same_not_guaranteed', identity_status: 'unverified',
  occurrence_field: 'txtime', request_received_field: 'requesttime',
  time_zone: 'Asia/Vientiane', declared_offset_minutes: 420,
  time_authority: 'user_declared_fixed_UTC_plus_07', known_at: 'unverified',
  source_completeness: 'unverified', correction_history: 'unverified', net_execution: 'unverified',
  windows_seconds: Object.freeze([300, 900, 3600]),
  window_bounds: '(anchor-window,anchor]', tie_policy: 'all_same_second_snapshot_events',
  cohort: 'valid_request_month_LAK_positive_within_cap_OK_refund0_no_DRS_nonempty_printable_endpoints',
  threshold_method: 'exploratory_above_p99_bin_upper', histogram_significant_bits: 8,
  canonical_assessment: false, enforcement: false,
});

export interface ObservedMaskEvent {
  ordinal: number; occurred_unix: number; sender: string; receiver: string; amount: string;
}
