export const OFFLINE_MONITORING_VERSION = 'offline-monitoring-trends-1';
export const OFFLINE_MONITORING_MAX_ROWS = 500;
export const OFFLINE_MONITORING_MAX_BYTES = 2 * 1024 * 1024;
export type OfflineScreeningOutcome = 'matched' | 'not_matched' | 'unavailable';
export interface OfflineMonitoringDataset {
  batch_ref: string; workspace_key: string; label: string; source_table: 'transfer'; expected_rows: number;
}
export interface OfflineMonitoringCatalog {
  version: 'offline-monitoring-datasets-1'; owner_workspace_key: string;
  default_batch_ref: string | null; datasets: OfflineMonitoringDataset[];
}
export interface OfflineMonitoringRow {
  row_number: number; id: string; requesttime: string; txtime: string;
  amount: string; ccy: string; result: string | null;
  outcome: OfflineScreeningOutcome; threshold: string | null;
}
export interface OfflineMonitoringCounts {
  rows: number; matched: number; not_matched: number; unavailable: number;
}
export interface OfflineMonitoringTrends {
  version: typeof OFFLINE_MONITORING_VERSION; owner_workspace_key: string;
  source_kind: 'user_supplied_file'; execution_mode: 'offline_analysis'; source_semantics: 'unverified';
  as_of: string; consistency: 'verified_staging_snapshot'; time_basis: 'raw_requesttime';
  source_timezone: 'unconfirmed_no_conversion'; risk_assessment: 'not_performed';
  operational_alerts: false; enforcement: false; dataset: OfflineMonitoringDataset;
  policy: { purpose: 'simulation_only'; amount_unit: 'as_recorded'; lifecycle_scope: 'all_recorded_rows';
    thresholds: { source_ccy: string; amount_gte: string }[] };
  counts: OfflineMonitoringCounts;
  currencies: ({ source_ccy: string } & OfflineMonitoringCounts)[];
  rows: OfflineMonitoringRow[];
}
