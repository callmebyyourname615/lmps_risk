export const DETECTION_STATES = ['not_normalized', 'waiting_policy', 'waiting_alert_policy', 'policy_ambiguous', 'ready', 'pending', 'running', 'retry_wait', 'interrupted', 'completed', 'failed', 'assessed'] as const;
export type DetectionState = typeof DETECTION_STATES[number];
export interface DetectionFilters { namespace: string | null; currency: string | null }
export interface DetectionRow {
  namespace: string; transaction_id: string; revision_number: number; currency: string; state: DetectionState;
  recorded_at: string; assessment_run_id: string | null; assessment_status: string | null; reasons: string[];
  job_ref: string | null; stage: string | null; attempt_number: number; updated_at: string | null;
  next_attempt_at: string | null; alert_id: string | null; error_code: string | null; retryable: boolean;
}
export interface DetectionWorkerStatus {
  configured: boolean; enabled: boolean; state: 'disabled' | 'starting' | 'running' | 'unavailable';
  last_completed_at: string | null; last_enqueued: number | null; last_processed: number | null; interval_seconds: number;
}
export interface DetectionHealth {
  version: 'local-detection-health-1'; provenance: 'local_synthetic'; execution_mode: 'test'; canonical_emission: false;
  workspace_key: string; as_of: string; filters: DetectionFilters; consistency: 'request_repeatable_read';
  counts: Record<DetectionState, number> & { transactions: number; with_assessment: number; missing_inputs: number };
  policies: Array<{ namespace: string; currency: string; generation: number; policy_id: string; policy_version: string; status: 'ready' | 'waiting_alert_policy' | 'policy_ambiguous' }>;
  availability: { source_lag_seconds: null; account_identity: 'unverified'; source_connectivity: 'not_attested' };
  rows: DetectionRow[]; worker: DetectionWorkerStatus; limit: 500;
}
export function parseDetectionFilters(value: unknown): DetectionFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DETECTION_INVALID_QUERY');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['namespace', 'currency'].includes(key))
    || input.namespace !== undefined && (typeof input.namespace !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(input.namespace))
    || input.currency !== undefined && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) throw new Error('DETECTION_INVALID_QUERY');
  return { namespace: input.namespace as string ?? null, currency: input.currency as string ?? null };
}
