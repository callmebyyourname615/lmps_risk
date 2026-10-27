import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import type { ModelGateRequest, ModelTrust, ShadowResult, ModelReceiptView } from '@lmps/contracts/model-signal';
import { ModelSignalError, localRiskMode, modelFeatureRequest, modelGateDecision, validateModelGateRequest, validateModelTrust, verifyShadowResult, riskHash } from '@lmps/risk';
import { createDatabase } from './index.js';
import { validateFrozenTransactionRisk, type FrozenTransactionRisk } from './transaction-risks.js';
import { generateLocalAlertInTransaction, readLocalAlert } from './alerts.js';

type Queryable = Pick<PoolClient, 'query'>;
export interface FrozenModelReceipt {
  request: ModelGateRequest; feature_sha256: string; model_result: ShadowResult | null;
  transport_status: 'received' | 'unavailable'; decision: ReturnType<typeof modelGateDecision>; alert_id: string | null;
}
async function frozenRisk(db: Queryable, workspace: string, id: string): Promise<FrozenTransactionRisk> {
  const row = (await db.query('SELECT snapshot,snapshot_sha256 FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', [workspace,id])).rows[0];
  if (!row) throw new ModelSignalError('ML_ASSESSMENT_NOT_FOUND');
  const frozen = validateFrozenTransactionRisk(row.snapshot, row.snapshot_sha256);
  if (frozen.request.workspace_key !== workspace || frozen.request.run_id !== id) throw new ModelSignalError('ML_STORAGE_UNAVAILABLE');
  return frozen;
}
const selectReceipt = `SELECT r.*,to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS time,
 p.policy,p.policy_sha256 AS stored_policy_sha256 FROM platform.local_model_receipts r JOIN platform.local_model_gate_policies p
 ON (p.workspace_key,p.policy_id,p.policy_version)=(r.workspace_key,r.policy_id,r.policy_version)`;
export async function readModelReceipt(db: Queryable, workspace: string, id: string, trust: ModelTrust): Promise<ModelReceiptView | null> {
  localRiskMode();
  if (typeof workspace!=='string' || typeof id!=='string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(workspace) || !ALERT_UUID.test(id)) throw new ModelSignalError('ML_INVALID_INPUT');
  try {
    const row = (await db.query(selectReceipt + ' WHERE r.workspace_key=$1 AND r.request_id=$2', [workspace,id])).rows[0];
    if (!row) return null;
    const s = row.snapshot as FrozenModelReceipt, r = validateModelGateRequest(s.request), p = r.policy;
    if (Object.keys(s).sort().join(',') !== 'alert_id,decision,feature_sha256,model_result,request,transport_status' || riskHash(s) !== row.snapshot_sha256
      || r.workspace_key !== workspace || r.request_id !== id || r.assessment_run_id !== row.assessment_run_id
      || p.policy_id !== row.policy_id || p.version !== row.policy_version || !isDeepStrictEqual(p,row.policy) || riskHash(p) !== row.policy_sha256
      || row.stored_policy_sha256 !== row.policy_sha256 || s.alert_id !== row.alert_id || row.recorded_by !== 'lmps_intake'
      || (s.model_result === null ? s.transport_status !== 'unavailable' : s.transport_status !== 'received')) throw new Error();
    const risk = await frozenRisk(db,workspace,r.assessment_run_id), features = modelFeatureRequest(risk.request,risk.observation);
    const signal = s.model_result === null ? null : verifyShadowResult(s.model_result,features,trust), decision = modelGateDecision(risk.result,r,signal);
    if (s.feature_sha256 !== features.snapshot.feature_sha256 || !isDeepStrictEqual(decision,s.decision) || (decision.status === 'eligible') !== (s.alert_id !== null)) throw new Error();
    if (s.alert_id !== null) {
      const alert = await readLocalAlert(db,workspace,s.alert_id);
      if (!alert || alert.snapshot.assessment_run_id !== r.assessment_run_id || !isDeepStrictEqual(alert.snapshot.policy,p.alert_policy)) throw new Error();
    }
    return { request_id:id,assessment_run_id:r.assessment_run_id,policy:p,feature_sha256:s.feature_sha256,model:signal?.model ?? null,
      model_status:signal?.status ?? 'unavailable',probabilities:signal?.probabilities ?? {},decision,alert_id:s.alert_id,receipt_sha256:row.snapshot_sha256,
      recorded_by:row.recorded_by,recorded_at:row.time,training_eligible:false,enforcement:false,scope:'synthetic_shadow_only' };
  } catch { throw new ModelSignalError('ML_STORAGE_UNAVAILABLE'); }
}
export function createModelSignals(dsn: string, trust: ModelTrust) {
  localRiskMode(); trust=validateModelTrust(trust); const database = createDatabase(dsn,'intake');
  return { close:database.close,
    async prepare(input: unknown) {
      const request = validateModelGateRequest(input), existing = await readModelReceipt(database.pool,request.workspace_key,request.request_id,trust);
      if (existing) {
        if (existing.assessment_run_id !== request.assessment_run_id || !isDeepStrictEqual(existing.policy,request.policy)) throw new ModelSignalError('ML_REQUEST_CONFLICT');
        return { existing, features:null };
      }
      const risk = await frozenRisk(database.pool,request.workspace_key,request.assessment_run_id);
      return { existing:null, features:modelFeatureRequest(risk.request,risk.observation) };
    },
    async record(input: unknown, modelResult: unknown | null) {
      const request = validateModelGateRequest(input); let client: PoolClient | undefined, active = false;
      try {
        client = await database.pool.connect(); await client.query('BEGIN'); active = true;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,46))',[request.workspace_key+':'+request.request_id]);
        const prior = await readModelReceipt(client,request.workspace_key,request.request_id,trust);
        if (prior) {
          if (prior.assessment_run_id !== request.assessment_run_id || !isDeepStrictEqual(prior.policy,request.policy)) throw new ModelSignalError('ML_REQUEST_CONFLICT');
          await client.query('COMMIT'); active=false; return {status:'duplicate' as const,view:prior};
        }
        const risk = await frozenRisk(client,request.workspace_key,request.assessment_run_id), features = modelFeatureRequest(risk.request,risk.observation);
        const signal = modelResult === null ? null : verifyShadowResult(modelResult,features,trust), decision = modelGateDecision(risk.result,request,signal), p = request.policy;
        await client.query(`INSERT INTO platform.local_model_gate_policies(workspace_key,policy_id,policy_version,policy,policy_sha256)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[request.workspace_key,p.policy_id,p.version,JSON.stringify(p),riskHash(p)]);
        const saved = (await client.query('SELECT policy,policy_sha256 FROM platform.local_model_gate_policies WHERE workspace_key=$1 AND policy_id=$2 AND policy_version=$3',[request.workspace_key,p.policy_id,p.version])).rows[0];
        if (!saved || riskHash(saved.policy) !== saved.policy_sha256) throw new ModelSignalError('ML_STORAGE_UNAVAILABLE');
        if (!isDeepStrictEqual(saved.policy,p)) throw new ModelSignalError('ML_POLICY_CONFLICT');
        const alert = decision.status === 'eligible' ? await generateLocalAlertInTransaction(client,{format:1,provenance:'local_synthetic',execution_mode:'test',workspace_key:request.workspace_key,assessment_run_id:request.assessment_run_id,policy:p.alert_policy}) : null;
        if (decision.status === 'eligible' && !alert?.alert_id) throw new ModelSignalError('ML_STORAGE_UNAVAILABLE');
        const snapshot: FrozenModelReceipt = {request,feature_sha256:features.snapshot.feature_sha256,model_result:signal,transport_status:signal === null ? 'unavailable' : 'received',decision,alert_id:alert?.alert_id ?? null};
        await client.query(`INSERT INTO platform.local_model_receipts(workspace_key,request_id,assessment_run_id,policy_id,policy_version,policy_sha256,alert_id,snapshot,snapshot_sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[request.workspace_key,request.request_id,request.assessment_run_id,p.policy_id,p.version,riskHash(p),snapshot.alert_id,JSON.stringify(snapshot),riskHash(snapshot)]);
        const view = await readModelReceipt(client,request.workspace_key,request.request_id,trust);
        if (!view) throw new ModelSignalError('ML_STORAGE_UNAVAILABLE');
        await client.query('COMMIT'); active=false; return {status:'inserted' as const,view};
      } catch (error) {
        if (active && client) try { await client.query('ROLLBACK'); } catch { /* Discard below. */ }
        if (error instanceof ModelSignalError) throw error;
        throw new ModelSignalError('ML_STORAGE_UNAVAILABLE');
      } finally { client?.release(true); }
    }
  };
}
