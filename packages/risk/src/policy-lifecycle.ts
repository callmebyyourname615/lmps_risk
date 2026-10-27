import { isDeepStrictEqual } from 'node:util';
import {
  POLICY_MAX_COMMAND_BYTES,
  POLICY_MAX_COMPARISON_RUNS,
  type PolicyCommand,
  type PolicyErrorCode,
  type PolicyRef,
  type PolicyState,
} from '@lmps/contracts/risk-policy';
import { RISK_ENGINE_VERSION, RISK_CATALOG_VERSION } from './catalog.js';
import {
  evaluateTransactionRisk,
  localRiskMode,
  riskHash,
  validateRiskObservation,
  validateRiskRequest,
} from './index.js';
import type { RiskPolicy, TransactionRiskRequest, RiskObservation } from '@lmps/contracts/transaction-risk';

export class PolicyError extends Error {
  constructor(readonly code: PolicyErrorCode) {
    super(code);
  }
}
export const POLICY_ID = /^synthetic_[A-Za-z0-9_.:-]{1,70}$/;
export const POLICY_NAMESPACE = /^synthetic_[a-z0-9_]{1,40}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function policyRef(value: unknown): PolicyRef {
  const ref = value as PolicyRef;
  if (
    !ref ||
    typeof ref.policy_id !== 'string' ||
    !POLICY_ID.test(ref.policy_id) ||
    typeof ref.policy_version !== 'string' ||
    !POLICY_ID.test(ref.policy_version)
  )
    throw new PolicyError('POLICY_INVALID_INPUT');
  return { policy_id: ref.policy_id, policy_version: ref.policy_version };
}
export function validatePolicy(value: unknown): RiskPolicy {
  try {
    const policy = validateRiskRequest({
      format: 1,
      provenance: 'local_synthetic',
      execution_mode: 'test',
      workspace_key: 'synthetic_local',
      run_id: '00000000-0000-4000-8000-000000000001',
      target: { namespace: 'synthetic_policy', transaction_id: 'policy_validation', revision_number: 1 },
      policy: value,
      context: null,
    }).policy;
    if (!policy) throw new Error();
    return policy;
  } catch {
    throw new PolicyError('POLICY_INVALID_INPUT');
  }
}
export function validatePolicyCommand(value: unknown): PolicyCommand {
  try {
    localRiskMode();
    const command = structuredClone(value) as PolicyCommand;
    if (
      !command ||
      Buffer.byteLength(JSON.stringify(command)) > POLICY_MAX_COMMAND_BYTES ||
      !isDeepStrictEqual(command, JSON.parse(JSON.stringify(command))) ||
      !uuid.test(command.request_id) ||
      typeof command.note !== 'string' ||
      !command.note.trim() ||
      command.note.length > 1000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command.note)
    )
      throw new Error();
    let keys: string[];
    if (command.action === 'create') {
      keys = ['action', 'request_id', 'policy', 'note'];
      command.policy = validatePolicy(command.policy);
      if (!command.policy) throw new Error();
    } else {
      policyRef(command);
      if (['submit', 'approve', 'reject'].includes(command.action)) {
        keys = ['action', 'request_id', 'policy_id', 'policy_version', 'expected_revision', 'note'];
        if (
          !('expected_revision' in command) ||
          !Number.isSafeInteger(command.expected_revision) ||
          command.expected_revision < 0 ||
          command.expected_revision > 3
        )
          throw new Error();
      } else if (command.action === 'activate' || command.action === 'rollback') {
        keys = [
          'action',
          'request_id',
          'policy_id',
          'policy_version',
          'expected_generation',
          'namespace',
          'currency',
          'note',
        ];
        if (
          !Number.isSafeInteger(command.expected_generation) ||
          command.expected_generation < 0 ||
          command.expected_generation >= 2147483647 ||
          !POLICY_NAMESPACE.test(command.namespace) ||
          !/^[A-Z]{3}$/.test(command.currency)
        )
          throw new Error();
      } else throw new Error();
    }
    if (Object.keys(command).sort().join() !== keys.sort().join()) throw new Error();
    return command;
  } catch {
    throw new PolicyError('POLICY_INVALID_INPUT');
  }
}
export function nextPolicyState(
  state: PolicyState,
  action: string,
  actor: string,
  creator: string,
  submitter: string | null,
): PolicyState {
  if (action === 'submit' && state === 'draft') return 'submitted';
  if ((action === 'approve' || action === 'reject') && state === 'submitted') {
    if (actor === creator || actor === submitter) throw new PolicyError('POLICY_SELF_APPROVAL');
    return action === 'approve' ? 'approved' : 'rejected';
  }
  throw new PolicyError('POLICY_INVALID_TRANSITION');
}
export function compareRiskPolicies(
  baseline: unknown,
  candidate: unknown,
  inputs: Array<{ request: TransactionRiskRequest; observation: RiskObservation }>,
) {
  const left = validatePolicy(baseline),
    right = validatePolicy(candidate);
  if (
    !left ||
    !right ||
    left.policy_id !== right.policy_id ||
    left.currency !== right.currency ||
    !Array.isArray(inputs) ||
    !inputs.length ||
    inputs.length > POLICY_MAX_COMPARISON_RUNS
  )
    throw new PolicyError('POLICY_INVALID_INPUT');
  const ids = new Set<string>();
  const rows = inputs.map((input) => {
    const request = validateRiskRequest(input.request),
      observation = validateRiskObservation(input.observation);
    if (ids.has(request.run_id)) throw new PolicyError('POLICY_INVALID_INPUT');
    ids.add(request.run_id);
    const before = evaluateTransactionRisk({ ...request, policy: left }, observation),
      after = evaluateTransactionRisk({ ...request, policy: right }, observation);
    const project = (result: typeof before) => ({
      assessment_status: result.assessment_status,
      response_code: result.response_code,
      fraud_score: result.fraud_score,
      mule_network_score: result.mule_network_score,
      aml_suspicion_score: result.aml_suspicion_score,
      risk_types: result.risk_types,
      findings: result.findings,
    });
    return {
      run_id: request.run_id,
      target: request.target,
      input_sha256: riskHash({ request, observation }),
      before: project(before),
      after: project(after),
      changed_codes: before.findings
        .filter((finding, i) => !isDeepStrictEqual(finding, after.findings[i]))
        .map((f) => f.code),
    };
  });
  return {
    format: 1,
    provenance: 'local_synthetic',
    simulation_only: true,
    enforcement: false,
    engine_version: RISK_ENGINE_VERSION,
    catalog_version: RISK_CATALOG_VERSION,
    baseline: { policy_id: left.policy_id, version: left.version, sha256: riskHash(left) },
    candidate: { policy_id: right.policy_id, version: right.version, sha256: riskHash(right) },
    input_set_sha256: riskHash(rows.map((r) => ({ run_id: r.run_id, input_sha256: r.input_sha256 }))),
    summary: {
      runs: rows.length,
      changed_runs: rows.filter((r) => !isDeepStrictEqual(r.before, r.after)).length,
      baseline_with_signals: rows.filter((r) => r.before.risk_types.length).length,
      candidate_with_signals: rows.filter((r) => r.after.risk_types.length).length,
    },
    rows,
  };
}
