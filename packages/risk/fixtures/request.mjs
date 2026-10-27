import { randomUUID } from 'node:crypto';
import { RISK_CATALOG } from '../dist/index.js';

export function riskFixture() {
  const namespace = 'synthetic_snapshot', target = { namespace, transaction_id: 'synthetic_target', revision_number: 1 };
  const event = (id, sender, receiver, time, amount) => ({ namespace, transaction_id: 'synthetic_' + id, revision_number: 1,
    sender: 'synthetic_' + sender, receiver: 'synthetic_' + receiver, occurred_at: `2026-01-01T${time}:00.000Z`, available_at: `2026-01-01T${time}:00.000Z`,
    currency: 'SYN', amount, reversed_amount: '0.00', status: 'succeeded' });
  const observation = { status: 'available', revision_sha256: 'a'.repeat(64), amount: '900.00', reversed_amount: '0.00', currency: 'SYN', transaction_status: 'succeeded', observed_at: '2026-01-01T12:00:00.000Z' };
  const request = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', run_id: randomUUID(), target,
    policy: { policy_id: 'synthetic_monitoring', version: 'synthetic_v1', currency: 'SYN', window_seconds: 3600, baseline_windows: 2, graph_depth: 4,
      minimum_amount: '500.00', structuring_ceiling: '1000.00', near_threshold_bps: 8000, severity_bps: { medium: 3000, high: 6000, critical: 9000 },
      rules: RISK_CATALOG.map(entry => ({ code: entry.code, enabled: true, threshold: entry.unit === 'amount' ? entry.code === 'FRAUD_AMOUNT_VELOCITY' ? '2000.00' : '500.00'
        : entry.unit === 'basis_points' ? entry.code === 'MULE_RAPID_PASS_THROUGH' ? '8000' : '15000' : ['FRAUD_NEW_COUNTERPARTY', 'MULE_FLAGGED_NEIGHBOR'].includes(entry.code) ? '1' : '2', weight_bps: 1000, severity: 'high' })) },
    context: { binding: { ...target, revision_sha256: observation.revision_sha256 }, identity_status: 'synthetic_declared', as_of: observation.observed_at,
      coverage_start: '2026-01-01T08:00:00.000Z', coverage_complete: true, flagged_accounts: ['synthetic_C'], flagged_accounts_version: 'synthetic_flags_v1',
      events: [event('baseline_1', 'A', 'Old1', '09:30', '100.00'), event('baseline_2', 'A', 'Old2', '10:30', '100.00'),
        event('chain', 'X', 'C', '11:01', '100.00'), event('cycle', 'B', 'C', '11:02', '100.00'), event('fanin', 'X', 'B', '11:10', '500.00'),
        event('receipt', 'C', 'A', '11:15', '1800.00'), event('out_1', 'A', 'D', '11:30', '850.00'), event('out_2', 'A', 'E', '11:40', '900.00'),
        event('target', 'A', 'B', '12:00', '900.00')] } };
  return { request, observation };
}
