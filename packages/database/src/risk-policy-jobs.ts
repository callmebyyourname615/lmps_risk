import type { PoolClient } from 'pg';
import { PolicyError, policyRef, POLICY_NAMESPACE, riskHash } from '@lmps/risk';
import { enqueueRiskJobInTransaction, validateRiskJobInput } from './risk-jobs.js';
import { readRiskPolicy } from './risk-policies.js';

/** Explicit opt-in; standalone legacy jobs remain outside policy governance. */
export async function enqueueApprovedRiskJob(client: PoolClient, input: unknown, value: unknown) {
  const manifest = validateRiskJobInput(input);
  const selection = value as {
    policy_id: string;
    policy_version: string;
    namespace: string;
    currency: string;
    expected_generation: number;
  };
  policyRef(selection);
  if (
    !selection ||
    Object.keys(selection).sort().join() !==
      ['currency', 'expected_generation', 'namespace', 'policy_id', 'policy_version'].join() ||
    manifest.risk_request.policy !== null ||
    !POLICY_NAMESPACE.test(selection.namespace) ||
    selection.namespace !== manifest.risk_request.target.namespace ||
    !/^[A-Z]{3}$/.test(selection.currency) ||
    !Number.isSafeInteger(selection.expected_generation) ||
    selection.expected_generation < 1 ||
    selection.expected_generation > 2147483647
  )
    throw new PolicyError('POLICY_INVALID_INPUT');
  const hash = riskHash({ manifest, selection });
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,363))', [manifest.job_ref]);
  const prior = (
    await client.query(
      "SELECT * FROM platform.local_risk_job_policy_bindings WHERE workspace_key='synthetic_local' AND job_ref=$1",
      [manifest.job_ref],
    )
  ).rows[0];
  if (prior) {
    if (prior.command_sha256 !== hash) throw new PolicyError('POLICY_CONFLICT');
    const pinned = await readRiskPolicy(client, 'synthetic_local', prior);
    if (!pinned || pinned.policy_sha256 !== prior.policy_sha256) throw new PolicyError('POLICY_STORAGE_UNAVAILABLE');
    await enqueueRiskJobInTransaction(client, {
      ...manifest,
      risk_request: { ...manifest.risk_request, policy: pinned.policy },
    });
    return {
      status: 'duplicate' as const,
      job_ref: manifest.job_ref,
      policy_binding: {
        policy_id: prior.policy_id,
        policy_version: prior.policy_version,
        policy_sha256: prior.policy_sha256,
        generation: prior.generation,
      },
    };
  }
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,362))', [
    'synthetic_local:' + selection.namespace + ':' + selection.currency,
  ]);
  const active = (
    await client.query(
      "SELECT * FROM platform.local_risk_policy_bindings WHERE workspace_key='synthetic_local' AND namespace=$1 AND currency=$2",
      [selection.namespace, selection.currency],
    )
  ).rows[0];
  if (
    !active ||
    active.generation !== selection.expected_generation ||
    active.policy_id !== selection.policy_id ||
    active.policy_version !== selection.policy_version
  )
    throw new PolicyError('POLICY_CONFLICT');
  const version = await readRiskPolicy(client, 'synthetic_local', selection);
  if (
    !version ||
    version.state !== 'approved' ||
    version.policy_sha256 !== active.policy_sha256 ||
    version.policy.currency !== selection.currency
  )
    throw new PolicyError('POLICY_NOT_APPROVED');
  const result = await enqueueRiskJobInTransaction(client, {
    ...manifest,
    risk_request: { ...manifest.risk_request, policy: version.policy },
  });
  if (result.status === 'inserted') {
    await client.query(
      `INSERT INTO platform.local_risk_job_policy_bindings(workspace_key,job_ref,namespace,currency,generation,policy_id,policy_version,policy_sha256,command_sha256)
      VALUES('synthetic_local',$1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        result.job_ref,
        selection.namespace,
        selection.currency,
        active.generation,
        version.policy_id,
        version.policy_version,
        version.policy_sha256,
        hash,
      ],
    );
  } else {
    const receipt = (
      await client.query(
        "SELECT * FROM platform.local_risk_job_policy_bindings WHERE workspace_key='synthetic_local' AND job_ref=$1",
        [result.job_ref],
      )
    ).rows[0];
    if (!receipt || receipt.policy_sha256 !== version.policy_sha256) throw new PolicyError('POLICY_CONFLICT');
    return {
      ...result,
      policy_binding: {
        policy_id: receipt.policy_id,
        policy_version: receipt.policy_version,
        policy_sha256: receipt.policy_sha256,
        generation: receipt.generation,
      },
    };
  }
  return {
    ...result,
    policy_binding: {
      policy_id: version.policy_id,
      policy_version: version.policy_version,
      policy_sha256: version.policy_sha256,
      generation: active.generation,
    },
  };
}
