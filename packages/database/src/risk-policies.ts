import type { Pool, PoolClient } from 'pg';
import type { PolicyVersion, PolicyBinding } from '@lmps/contracts/risk-policy';
import { POLICY_MAX_COMPARISON_RUNS } from '@lmps/contracts/risk-policy';
import {
  PolicyError,
  policyRef,
  validatePolicy,
  validatePolicyCommand,
  riskHash,
  compareRiskPolicies,
  localRiskMode,
} from '@lmps/risk';
import { createDatabase } from './index.js';
import { validateFrozenTransactionRisk } from './transaction-risks.js';

export function policyVersion(row: Record<string, any>): PolicyVersion {
  try {
    const policy = validatePolicy(row.policy);
    if (
      !policy ||
      policy.policy_id !== row.policy_id ||
      policy.version !== row.policy_version ||
      riskHash(policy) !== row.policy_sha256
    )
      throw new Error();
    return {
      workspace_key: row.workspace_key,
      policy_id: row.policy_id,
      policy_version: row.policy_version,
      policy,
      policy_sha256: row.policy_sha256,
      state: row.state,
      revision: row.revision,
      created_by: row.created_by,
      submitted_by: row.submitted_by,
      approved_by: row.approved_by,
      created_at: new Date(row.created_at).toISOString(),
    };
  } catch {
    throw new PolicyError('POLICY_STORAGE_UNAVAILABLE');
  }
}
export async function readRiskPolicy(pool: Pick<Pool, 'query'> | PoolClient, workspace: string, input: unknown) {
  const ref = policyRef(input);
  const result = await pool.query(
    'SELECT * FROM platform.local_risk_policy_versions WHERE workspace_key=$1 AND policy_id=$2 AND policy_version=$3',
    [workspace, ref.policy_id, ref.policy_version],
  );
  return result.rows[0] ? policyVersion(result.rows[0]) : null;
}
export async function listRiskPolicies(
  pool: Pick<Pool, 'query'>,
  workspace: string,
  after: [string, string] | null,
  limit: number,
) {
  const result = await pool.query(
    `SELECT * FROM platform.local_risk_policy_versions WHERE workspace_key=$1 AND ($2::text IS NULL OR (policy_id,policy_version)>($2::text,$3::text)) ORDER BY policy_id,policy_version LIMIT $4`,
    [workspace, after?.[0] ?? null, after?.[1] ?? null, limit + 1],
  );
  const items = result.rows.slice(0, limit).map(policyVersion),
    last = items.at(-1);
  return {
    pagination: 'live_committed_view',
    items,
    next_cursor:
      result.rows.length > limit && last
        ? Buffer.from(JSON.stringify([last.policy_id, last.policy_version])).toString('base64url')
        : null,
  };
}
export async function readPolicyBinding(
  pool: Pick<Pool, 'query'>,
  workspace: string,
  namespace: string,
  currency: string,
): Promise<PolicyBinding | null> {
  const result = await pool.query(
    'SELECT namespace,currency,generation,policy_id,policy_version,policy_sha256 FROM platform.local_risk_policy_bindings WHERE workspace_key=$1 AND namespace=$2 AND currency=$3',
    [workspace, namespace, currency],
  );
  return result.rows[0] ?? null;
}
export function createRiskPolicies(dsn: string) {
  localRiskMode();
  const database = createDatabase(dsn, 'policy');
  return {
    close: database.close,
    async command(workspace: string, actor: string, input: unknown) {
      const command = validatePolicyCommand(input);
      if (workspace !== 'synthetic_local' || !/^synthetic_[a-z0-9_]{1,40}$/.test(actor))
        throw new PolicyError('POLICY_INVALID_INPUT');
      try {
        return (
          await database.pool.query('SELECT platform.command_local_risk_policy($1,$2,$3,$4) AS result', [
            workspace,
            actor,
            JSON.stringify(command),
            command.action === 'create' ? riskHash(command.policy) : null,
          ])
        ).rows[0].result as { status: 'inserted' | 'duplicate'; result: Record<string, unknown> };
      } catch (error) {
        const code = (error as { code?: string }).code;
        throw new PolicyError(
          (
            {
              P3600: 'POLICY_INVALID_INPUT',
              P3604: 'POLICY_NOT_FOUND',
              P3609: 'POLICY_CONFLICT',
              P3610: 'POLICY_INVALID_TRANSITION',
              P3611: 'POLICY_SELF_APPROVAL',
              P3612: 'POLICY_NOT_APPROVED',
            } as const
          )[code as 'P3600'] ?? 'POLICY_STORAGE_UNAVAILABLE',
        );
      }
    },
  };
}
export async function compareStoredRiskPolicies(
  pool: Pool,
  workspace: string,
  baseline: unknown,
  candidate: unknown,
  ids: unknown,
) {
  policyRef(baseline);
  policyRef(candidate);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > POLICY_MAX_COMPARISON_RUNS ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
    )
  )
    throw new PolicyError('POLICY_INVALID_INPUT');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const left = await readRiskPolicy(client, workspace, baseline),
      right = await readRiskPolicy(client, workspace, candidate);
    if (!left || !right) throw new PolicyError('POLICY_NOT_FOUND');
    const records = await client.query(
      'SELECT * FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=ANY($2::uuid[]) ORDER BY run_id',
      [workspace, ids],
    );
    if (records.rows.length !== ids.length) throw new PolicyError('POLICY_NOT_FOUND');
    const inputs = records.rows.map((row) => {
      const frozen = validateFrozenTransactionRisk(row.snapshot, row.snapshot_sha256);
      if (
        frozen.request.workspace_key !== workspace ||
        frozen.request.run_id !== row.run_id ||
        frozen.request.target.namespace !== row.namespace ||
        frozen.request.target.transaction_id !== row.transaction_id ||
        frozen.request.target.revision_number !== row.revision_number
      )
        throw new PolicyError('POLICY_STORAGE_UNAVAILABLE');
      return { request: frozen.request, observation: frozen.observation };
    });
    const report = compareRiskPolicies(left.policy, right.policy, inputs);
    await client.query('COMMIT');
    return { ...report, report_sha256: riskHash(report) };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Discard session below. */
    }
    if (error instanceof PolicyError) throw error;
    throw new PolicyError('POLICY_STORAGE_UNAVAILABLE');
  } finally {
    client.release(true);
  }
}
