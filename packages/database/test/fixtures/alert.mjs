import { randomUUID } from 'node:crypto';
import { evaluateTransactionRisk, projectAlert, riskHash, validateRiskRequest, RISK_CODES } from '@lmps/risk';
import { transactionRiskFixture } from './transaction-risk.mjs';

export function alertFixture() {
  const f = transactionRiskFixture(), request = validateRiskRequest(f.request), observation = f.observation;
  const riskSnapshot = { request, observation, result: evaluateTransactionRisk(request, observation) };
  const policy = { policy_id: 'synthetic_alerts', version: 'synthetic_v1', minimum_severity: 'high', included_codes: [...RISK_CODES], include_partial: true };
  const generation = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', assessment_run_id: request.run_id, policy };
  const snapshot = projectAlert(riskSnapshot.result, policy).snapshot;
  const row = { alert_id: randomUUID(), workspace_key: 'synthetic_local', assessment_run_id: request.run_id,
    policy_id: policy.policy_id, policy_version: policy.version, policy_sha256: riskHash(policy), policy, stored_policy_sha256: riskHash(policy),
    snapshot, snapshot_sha256: riskHash(snapshot), risk_snapshot: riskSnapshot, risk_snapshot_sha256: riskHash(riskSnapshot), severity: snapshot.severity,
    recorded_by: 'lmps_intake', created_at: '2026-10-22T00:00:00.000Z', history: [] };
  const ack = { request_id: randomUUID(), expected_version: 0, action: 'acknowledge', outcome: null, note: null };
  const review = { request_id: randomUUID(), expected_version: 1, action: 'review', outcome: 'unknown', note: 'Synthetic evidence is insufficient.' };
  const event = command => ({ ...command, version: command.expected_version + 1, actor_subject: 'synthetic_reviewer', actor_role: 'lmps_reviewer', occurred_at: '2026-10-22T00:00:01.000Z' });
  return { f, generation, policy, row, ack, review, event };
}
