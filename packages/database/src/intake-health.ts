import type { Pool, PoolClient } from 'pg';
import { DATASET_MAX_BYTES, datasetMode } from '@lmps/contracts/offline-dataset';
import { analyzeIntakeRevisionHistory, INTAKE_AUDIT_MAX_REVISIONS } from './intake-revision-audit.js';
import { policyVersion } from './risk-policies.js';

export class IntakeHealthError extends Error {
  constructor(readonly code: 'INTAKE_HEALTH_UNAVAILABLE' | 'INTAKE_HEALTH_SCOPE_TOO_LARGE' = 'INTAKE_HEALTH_UNAVAILABLE') {
    super('Intake health is unavailable; private values withheld.');
  }
}
export async function readIntakeHealth(pool: Pool, workspace: string) {
  let client: PoolClient | undefined, active = false, discard = false;
  try {
    datasetMode();
    if (!/^synthetic_[a-z0-9_]{1,40}$/.test(workspace)) throw Error();
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); active = true;
    const context = (await client.query("SELECT transaction_timestamp() AS at, coalesce(nullif(current_setting('lmps.read_namespace',true),''),'synthetic_snapshot') AS namespace")).rows[0];
    const namespace = context.namespace, scope = [workspace, namespace];
    const filter = `workspace_key=$1 AND namespace=$2 AND transaction_id IN (
      SELECT transaction_id FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2
      AND (provenance='user_supplied_file' OR publication->>'provenance'='user_supplied_file'))`;
    const metadata = (await client.query(`SELECT count(*)::int AS revisions,
      coalesce(sum(octet_length(payload::text)+coalesce(octet_length(publication::text),0)),0)::text AS bytes
      FROM platform.local_transaction_revisions WHERE ${filter}`, scope)).rows[0];
    if (metadata.revisions > INTAKE_AUDIT_MAX_REVISIONS || BigInt(metadata.bytes) > BigInt(DATASET_MAX_BYTES)) throw new IntakeHealthError('INTAKE_HEALTH_SCOPE_TOO_LARGE');
    const rows = (await client.query(`SELECT workspace_key,namespace,transaction_id,revision_number,provenance,payload,publication
      FROM platform.local_transaction_revisions WHERE ${filter} ORDER BY transaction_id,revision_number LIMIT $3`, [...scope, INTAKE_AUDIT_MAX_REVISIONS + 1])).rows;
    if (rows.length !== metadata.revisions) throw Error();
    const audit = analyzeIntakeRevisionHistory(rows, workspace, namespace);
    const selected = await client.query(`SELECT b.currency AS binding_currency,b.namespace AS binding_namespace,b.generation,
      p.*,b.policy_sha256 AS binding_sha256 FROM platform.local_risk_policy_bindings b
      LEFT JOIN platform.local_risk_policy_versions p ON (p.workspace_key,p.policy_id,p.policy_version)=(b.workspace_key,b.policy_id,b.policy_version)
      WHERE b.workspace_key=$1 AND b.namespace=$2 AND b.currency=ANY($3::text[]) LIMIT $4`,
      [...scope, audit.currencies.map(group => group.currency), audit.currencies.length + 1]);
    const configured = new Set<string>();
    for (const row of selected.rows) {
      const version = policyVersion(row);
      if (row.binding_namespace !== namespace || !audit.currencies.some(group => group.currency === row.binding_currency)
        || configured.has(row.binding_currency) || !Number.isSafeInteger(row.generation) || row.generation < 1
        || version.workspace_key !== workspace || version.state !== 'approved' || version.policy.currency !== row.binding_currency
        || version.policy_sha256 !== row.binding_sha256) throw Error();
      configured.add(row.binding_currency);
    }
    const currency_policies = audit.currencies.map(group => ({ currency: group.currency, state: configured.has(group.currency) ? 'configured' as const : 'waiting_policy' as const }));
    const report = { ...audit, format: 'lmps-intake-health-1' as const, as_of: new Date(context.at).toISOString(), consistency: 'request_repeatable_read' as const,
      currency_policies, waiting_policy: audit.currencies.reduce((total, group) => total + (configured.has(group.currency) ? 0 : group.transactions), 0), demo_results_included: false as const };
    await client.query('COMMIT'); active = false;
    return report;
  } catch (error) {
    if (active) { try { await client!.query('ROLLBACK'); } catch { discard = true; } }
    if (error instanceof IntakeHealthError) throw error;
    throw new IntakeHealthError();
  } finally { client?.release(discard); }
}
