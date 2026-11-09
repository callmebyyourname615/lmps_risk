import { isDeepStrictEqual } from 'node:util';
import { createDatabase } from './index.js';
import { evaluateTransactionRiskInTransaction } from './transaction-risks.js';
import { generateLocalAlertInTransaction } from './alerts.js';
import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { localRiskMode, projectAlert, riskHash, validateAlertPolicy, validateRiskObservation, validateRiskRequest } from '@lmps/risk';

/** Explicit synthetic candidate publication; the risk and Inbox rows commit together. */
export function createCoreInbox(dsn: string) {
  localRiskMode(); const database = createDatabase(dsn, 'intake');
  return {
    async publish(input: { runtime_id:string; config_sha256:string; index:number; request: unknown; observation: unknown; assessment: unknown; alert: unknown; policy: unknown }) {
      localRiskMode();
      const request=validateRiskRequest(input.request), observation=validateRiskObservation(input.observation), policy=validateAlertPolicy(input.policy);
      if(!/^synthetic_[A-Za-z0-9_]{1,60}$/.test(input.runtime_id) || !/^[a-f0-9]{64}$/.test(input.config_sha256)
        || !Number.isSafeInteger(input.index) || input.index<0 || input.index>=64 || request.provenance!=='local_synthetic' || !projectAlert(input.assessment as never,policy).snapshot
        || !isDeepStrictEqual(projectAlert(input.assessment as never,policy),input.alert)) throw Error('CORE_INBOX_INVALID');
      const client=await database.pool.connect();
      try {
        await client.query('BEGIN');
        const checkpoint=(await client.query(`SELECT config_sha256,next_offset,state,state_sha256 FROM platform.core_detection_checkpoints
          WHERE workspace_key='synthetic_local' AND runtime_id=$1 FOR SHARE`,[input.runtime_id])).rows[0];
        const state=checkpoint && detachFeatureJSON(checkpoint.state,undefined,true),entry=state?.entries?.[input.index];
        if(!checkpoint || checkpoint.config_sha256!==input.config_sha256 || !state || Object.keys(state).join(',')!=='entries' || !Array.isArray(state.entries)
          || state.entries.length!==checkpoint.next_offset || riskHash(state)!==checkpoint.state_sha256 || !entry
          || entry.duplicate_of!==null || entry.prepared?.provenance!=='local_synthetic' || !entry.alert_id
          || !isDeepStrictEqual(entry.assessment,input.assessment) || !isDeepStrictEqual(entry.alert,input.alert)) throw Error('CORE_INBOX_INVALID');
        const evaluated=await evaluateTransactionRiskInTransaction(client,request,observation);
        if(!isDeepStrictEqual(evaluated.result,input.assessment)) throw Error('CORE_INBOX_INVALID');
        const alert=await generateLocalAlertInTransaction(client,{format:1,provenance:'local_synthetic',execution_mode:'test',
          workspace_key:'synthetic_local',assessment_run_id:request.run_id,policy});
        if(!alert.alert_id) throw Error('CORE_INBOX_INVALID');
        await client.query('COMMIT'); return alert;
      } catch {
        try { await client.query('ROLLBACK'); } catch { /* discard connection */ }
        throw Error('CORE_INBOX_FAILED; private diagnostics withheld.');
      } finally {client.release(true);}
    },
    close:database.close,
  };
}
