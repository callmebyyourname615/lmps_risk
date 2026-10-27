import { DATASET_DIGEST, DATASET_SCOPE, DATASET_UUID, datasetMode } from './offline-dataset.js';

export const OFFLINE_REPLAY_VERSION = 'offline-amount-screen-1';
export const MAX_REPLAY_INPUT_BYTES = 64 * 1024;
export const MAX_REPLAY_REPORT_BYTES = 128 * 1024 * 1024;
export class OfflineReplayError extends Error {
  constructor(readonly code: 'REPLAY_INVALID_INPUT' | 'REPLAY_INPUT_CONFLICT' | 'REPLAY_REPORT_UNAVAILABLE') {
    super(code + '; private diagnostics withheld.'); this.name = 'OfflineReplayError';
  }
}
export interface ReplayPolicy {
  version: string; purpose: 'simulation_only'; amount_semantics: 'raw_recorded_amount'; amount_unit: 'as_recorded';
  lifecycle_scope: 'all_recorded_rows'; thresholds: { source_ccy: string; amount_gte: string }[];
}
export interface ReplayInput {
  format: 1; execution_mode: 'offline_analysis'; evaluator_version: typeof OFFLINE_REPLAY_VERSION;
  run_id: string; workspace_key: string; batch_ref: string; dataset_sha256: string; policy: ReplayPolicy;
}
export interface ReplayRow {
  row_number: number; row_sha256: string; outcome: 'matched' | 'not_matched' | 'unavailable';
  reason_code: 'AMOUNT_AT_OR_ABOVE_THRESHOLD' | 'AMOUNT_BELOW_THRESHOLD' | 'CURRENCY_POLICY_MISSING' | 'AMOUNT_FIELDS_UNAVAILABLE';
  amount: string | null; source_ccy: string | null; threshold: string | null;
}
export interface ReplayReport {
  format: 1; source_kind: 'user_supplied_file'; execution_mode: 'offline_analysis'; evaluator_version: typeof OFFLINE_REPLAY_VERSION;
  purpose: 'simulation_only'; source_semantics: 'unverified'; canonical_emission: false; enforcement: false; operational_alerts: false;
  status: 'complete' | 'partial'; run_id: string; input_sha256: string; policy_sha256: string; policy: ReplayPolicy;
  dataset: { workspace_key: string; batch_ref: string; source_namespace: string; source_table: string; profile_version: string;
    dataset_sha256: string; rows_sha256: string; expected_rows: number };
  counts: { rows: number; matched: number; not_matched: number; unavailable: number }; rows: ReplayRow[];
}
const exact = (v: unknown, names: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === names.sort().join(',');

export function validateReplayInput(input: unknown): ReplayInput {
  try {
    datasetMode(); const v = structuredClone(input) as ReplayInput;
    if (!exact(v, ['format','execution_mode','evaluator_version','run_id','workspace_key','batch_ref','dataset_sha256','policy'])
      || v.format !== 1 || v.execution_mode !== 'offline_analysis' || v.evaluator_version !== OFFLINE_REPLAY_VERSION
      || typeof v.run_id !== 'string' || v.run_id.length !== 36 || !DATASET_UUID.test(v.run_id)
      || typeof v.workspace_key !== 'string' || v.workspace_key !== v.workspace_key.trim() || !DATASET_SCOPE.test(v.workspace_key)
      || typeof v.batch_ref !== 'string' || v.batch_ref.length !== 36 || !DATASET_UUID.test(v.batch_ref)
      || typeof v.dataset_sha256 !== 'string' || v.dataset_sha256.length !== 64 || !DATASET_DIGEST.test(v.dataset_sha256)
      || !exact(v.policy, ['version','purpose','amount_semantics','amount_unit','lifecycle_scope','thresholds'])
      || typeof v.policy.version !== 'string' || v.policy.version !== v.policy.version.trim() || !/^simulation_[A-Za-z0-9_.-]{1,60}$/.test(v.policy.version)
      || v.policy.purpose !== 'simulation_only' || v.policy.amount_semantics !== 'raw_recorded_amount'
      || v.policy.amount_unit !== 'as_recorded' || v.policy.lifecycle_scope !== 'all_recorded_rows'
      || !Array.isArray(v.policy.thresholds) || v.policy.thresholds.length < 1 || v.policy.thresholds.length > 32
      || Buffer.byteLength(JSON.stringify(v)) > MAX_REPLAY_INPUT_BYTES) throw new Error();
    const currencies = new Set<string>();
    for (const t of v.policy.thresholds) {
      if (!exact(t, ['source_ccy','amount_gte']) || typeof t.source_ccy !== 'string' || [...t.source_ccy].length < 1
        || [...t.source_ccy].length > 200 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(t.source_ccy) || currencies.has(t.source_ccy)
        || typeof t.amount_gte !== 'string' || t.amount_gte !== t.amount_gte.trim() || !/^(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(t.amount_gte)
        || BigInt(t.amount_gte.replace('.', '')) <= 0n) throw new Error();
      currencies.add(t.source_ccy);
    }
    v.policy.thresholds.sort((a,b) => a.source_ccy < b.source_ccy ? -1 : a.source_ccy > b.source_ccy ? 1 : 0);
    return v;
  } catch { throw new OfflineReplayError('REPLAY_INVALID_INPUT'); }
}
