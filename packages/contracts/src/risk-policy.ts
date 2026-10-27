import type { RiskPolicy } from './transaction-risk.js';

export type PolicyState = 'draft' | 'submitted' | 'approved' | 'rejected';
export interface PolicyRef {
  policy_id: string;
  policy_version: string;
}
export type PolicyCommand =
  | { action: 'create'; request_id: string; policy: RiskPolicy; note: string }
  | ({
      action: 'submit' | 'approve' | 'reject';
      request_id: string;
      expected_revision: number;
      note: string;
    } & PolicyRef)
  | ({
      action: 'activate' | 'rollback';
      request_id: string;
      expected_generation: number;
      namespace: string;
      currency: string;
      note: string;
    } & PolicyRef);
export interface PolicyVersion extends PolicyRef {
  workspace_key: string;
  policy: RiskPolicy;
  policy_sha256: string;
  state: PolicyState;
  revision: number;
  created_by: string;
  submitted_by: string | null;
  approved_by: string | null;
  created_at: string;
}
export interface PolicyBinding extends PolicyRef {
  namespace: string;
  currency: string;
  generation: number;
  policy_sha256: string;
}
export const POLICY_MAX_COMPARISON_RUNS = 20;
export const POLICY_MAX_COMMAND_BYTES = 24 * 1024;
export const POLICY_ERRORS = [
  'POLICY_INVALID_INPUT',
  'POLICY_NOT_FOUND',
  'POLICY_CONFLICT',
  'POLICY_INVALID_TRANSITION',
  'POLICY_SELF_APPROVAL',
  'POLICY_NOT_APPROVED',
  'POLICY_STORAGE_UNAVAILABLE',
  'POLICY_WRITES_NOT_CONFIGURED',
] as const;
export type PolicyErrorCode = (typeof POLICY_ERRORS)[number];
