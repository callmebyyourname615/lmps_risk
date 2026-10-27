import { alertFixture } from './alert.mjs';
export function riskJobFixture() {
  const f = alertFixture();
  return { f, input: { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local',
    job_ref: f.f.request.run_id, risk_request: f.f.request, alert_policy: f.policy } };
}
