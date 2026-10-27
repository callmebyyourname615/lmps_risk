import type { TransactionRiskRequest } from './transaction-risk.js';
import type { AlertPolicy } from './local-alert.js';

export interface RiskJobInput {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; workspace_key: 'synthetic_local';
  job_ref: string; risk_request: TransactionRiskRequest; alert_policy: AlertPolicy;
}
export const MAX_JOB_INPUT_BYTES = 512 * 1024;
export const MAX_JOB_ATTEMPTS = 8;
export const JOB_STATES = ['pending', 'running', 'retry_wait', 'completed', 'failed'] as const;
export const JOB_STAGES = ['assessment', 'alert', 'done'] as const;
export const JOB_ERRORS = ['JOB_STORAGE_UNAVAILABLE', 'JOB_INPUT_CONFLICT', 'JOB_INVALID_INPUT', 'JOB_STALE_LEASE',
  'JOB_LEASE_EXPIRED', 'RISK_POLICY_CONFLICT', 'RISK_RUN_CONFLICT', 'ALERT_POLICY_CONFLICT'] as const;
export type RiskJobState = typeof JOB_STATES[number];
export type RiskJobStage = typeof JOB_STAGES[number];
export type RiskJobErrorCode = typeof JOB_ERRORS[number];
