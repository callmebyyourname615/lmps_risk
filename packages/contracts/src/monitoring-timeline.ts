import type { TransactionRiskResult } from './transaction-risk.js';
export interface TimelineTarget { namespace: string; transaction_id: string }
export interface TimelineRevision {
  revision_number: number; recorded_at: string; observed_at: string; occurred_at: null; amount: string; currency: string; status: string;
  revision_sha256: string; reversal_code: string | null; reversed_amount: string | null; executed_amount: string | null;
  normalization: 'known' | 'unknown' | 'invalid' | 'not_normalized'; reasons: string[]; changes: string[];
  source: null | { capture_id: string; snapshot_sha256: string; evidence_sha256: string; event_key: string };
}
export interface TimelineAssessment {
  recorded_at: string; bound: boolean; core_sha256: string; result: TransactionRiskResult;
  window: null | { seconds: number; baseline_windows: number; coverage_start: string | null; coverage_complete: boolean | null };
}
export interface TimelineAlert {
  alert_id: string; assessment_run_id: string; revision_number: number; recorded_at: string; severity: string;
  patterns: string[]; snapshot_sha256: string; policy: { policy_id: string; version: string; sha256: string };
}
export interface MonitoringTimeline {
  version: 'local-monitoring-timeline-1'; provenance: 'local_synthetic'; execution_mode: 'test'; canonical_emission: false;
  workspace_key: string; target: TimelineTarget; as_of: string; consistency: 'request_repeatable_read'; time_basis: 'recorded_at';
  revisions: TimelineRevision[]; assessments: TimelineAssessment[]; alerts: TimelineAlert[];
  coverage: { revisions: number; assessment_runs: number; assessed_revisions: number; missing_assessments: number; alerts: number; revision_history_complete: boolean };
  limits: { revisions: 100; assessments: 100; alerts: 100; scope_complete: true };
  availability: { account_identity: 'unverified'; payment_time: 'unverified'; source_connectivity: 'not_attested' };
}
export function parseTimelineTarget(value: unknown): TimelineTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MONITORING_INVALID_QUERY');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'namespace,transaction_id' || typeof input.namespace !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(input.namespace)
    || typeof input.transaction_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.transaction_id)) throw new Error('MONITORING_INVALID_QUERY');
  return { namespace: input.namespace, transaction_id: input.transaction_id };
}
