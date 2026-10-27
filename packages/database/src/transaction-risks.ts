import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { normalizeSynthetic } from '@lmps/contracts/synthetic-normalization';
import { evaluateTransactionRisk, riskHash, RiskError, validateRiskRequest, validateRiskObservation,
  type RiskObservation, type RiskTarget, type TransactionRiskRequest, type TransactionRiskResult } from '@lmps/risk';
import { createDatabase } from './index.js';
import { validateTransactionRevision } from './transaction-revisions.js';

export interface FrozenTransactionRisk { request: TransactionRiskRequest; observation: RiskObservation; result: TransactionRiskResult }
export function riskObservation(target: RiskTarget, raw: unknown | null): RiskObservation {
  const absent: RiskObservation = { status: raw === null ? 'missing' : 'invalid', revision_sha256: raw === null ? null : riskHash(raw),
    amount: null, reversed_amount: null, currency: null, transaction_status: null, observed_at: null };
  if (raw === null) return absent;
  try {
    const value = validateTransactionRevision(raw), tx = value.transaction;
    if (value.workspace_key !== 'synthetic_local' || tx.transaction_id !== target.transaction_id || tx.source_reference.namespace !== target.namespace
      || value.expected_revision + 1 !== target.revision_number) throw new Error();
    if (!value.publication) return { ...absent, status: 'not_normalized' };
    const normalized = normalizeSynthetic(value.publication.normalization_input);
    return validateRiskObservation({ status: 'available', revision_sha256: riskHash(value), amount: tx.amount,
      reversed_amount: normalized.candidate?.cumulative_reversed_amount ?? '0.00', currency: tx.currency,
      transaction_status: tx.transaction_status, observed_at: tx.observed_at });
  } catch { return absent; }
}
export function validateFrozenTransactionRisk(input: unknown, digest: string): FrozenTransactionRisk {
  try {
    const value = structuredClone(input) as FrozenTransactionRisk;
    if (!value || Object.keys(value).sort().join(',') !== 'observation,request,result'
      || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024 || riskHash(value) !== digest) throw new Error();
    const request = validateRiskRequest(value.request), observation = validateRiskObservation(value.observation);
    if (!isDeepStrictEqual(request, value.request) || !isDeepStrictEqual(evaluateTransactionRisk(request, observation), value.result)) throw new Error();
    return value;
  } catch { throw new RiskError('RISK_STORAGE_UNAVAILABLE'); }
}

export async function readRiskObservation(client: PoolClient, request: TransactionRiskRequest): Promise<RiskObservation> {
  const t = request.target;
  const row = (await client.query(`SELECT payload,publication FROM platform.local_transaction_revisions
    WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=$4`, [request.workspace_key, t.namespace, t.transaction_id, t.revision_number])).rows[0];
  const revision = row ? { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.workspace_key,
    expected_revision: t.revision_number - 1, transaction: row.payload, ...(row.publication === null ? {} : { publication: row.publication }) } : null;
  return riskObservation(t, revision);
}
// The caller owns the transaction; jobs can fence the result and checkpoint in the same commit.
export async function evaluateTransactionRiskInTransaction(client: PoolClient, input: unknown, observation?: RiskObservation): Promise<{ status: 'inserted' | 'duplicate'; result: TransactionRiskResult }> {
  const request = validateRiskRequest(input);
  if (observation) validateRiskObservation(observation);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,31))', [request.workspace_key + ':' + request.run_id]);
  const saved = (await client.query('SELECT snapshot,snapshot_sha256 FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', [request.workspace_key, request.run_id])).rows[0];
  if (saved) {
    const frozen = validateFrozenTransactionRisk(saved.snapshot, saved.snapshot_sha256);
    if (riskHash(frozen.request) !== riskHash(request)) throw new RiskError('RISK_RUN_CONFLICT');
    if (observation && !isDeepStrictEqual(frozen.observation, observation)) throw new RiskError('RISK_RUN_CONFLICT');
    return { status: 'duplicate', result: frozen.result };
  }
  const t = request.target;
  const evaluatedObservation = observation ?? await readRiskObservation(client, request);
  const result = evaluateTransactionRisk(request, evaluatedObservation);
  const snapshot: FrozenTransactionRisk = { request, observation: evaluatedObservation, result };
  validateFrozenTransactionRisk(snapshot, riskHash(snapshot));
  const policy = request.policy;
  if (policy) {
    const args = [request.workspace_key, policy.policy_id, policy.version];
    await client.query(`INSERT INTO platform.local_risk_policies(workspace_key,policy_id,policy_version,policy,policy_sha256)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [...args, JSON.stringify(policy), riskHash(policy)]);
    const stored = (await client.query('SELECT policy,policy_sha256 FROM platform.local_risk_policies WHERE workspace_key=$1 AND policy_id=$2 AND policy_version=$3', args)).rows[0];
    if (riskHash(stored.policy) !== stored.policy_sha256) throw new RiskError('RISK_STORAGE_UNAVAILABLE');
    if (!isDeepStrictEqual(stored.policy, policy)) throw new RiskError('RISK_POLICY_CONFLICT');
  }
  await client.query(`INSERT INTO platform.local_transaction_risks(workspace_key,run_id,namespace,transaction_id,revision_number,policy_id,policy_version,snapshot,snapshot_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [request.workspace_key, request.run_id, t.namespace, t.transaction_id, t.revision_number,
    policy?.policy_id ?? null, policy?.version ?? null, JSON.stringify(snapshot), riskHash(snapshot)]);
  return { status: 'inserted', result };
}
export function createTransactionRisks(dsn: string) {
  const database = createDatabase(dsn, 'intake');
  return { close: database.close, async evaluate(input: unknown) {
    const request = validateRiskRequest(input);
    let client: PoolClient | undefined, active = false;
    try {
      client = await database.pool.connect(); await client.query('BEGIN'); active = true;
      const result = await evaluateTransactionRiskInTransaction(client, request);
      await client.query('COMMIT'); active = false; return result;
    } catch (error) {
      if (active && client) { try { await client.query('ROLLBACK'); } catch { /* Discard below. */ } }
      if (error instanceof RiskError) throw error;
      throw new RiskError('RISK_STORAGE_UNAVAILABLE');
    } finally { client?.release(true); }
  } };
}
