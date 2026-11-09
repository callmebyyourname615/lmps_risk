import { createDatabase } from './index.js';
import type { PoolClient } from 'pg';
import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { validateIdentityMapping } from '@lmps/contracts/account-identity';
import { localRiskMode, riskHash } from '@lmps/risk';

export class CoreDetectionError extends Error {
  constructor(readonly code = 'CORE_DETECTION_INVALID') { super(code + '; private values withheld.'); }
}
export interface CoreJournalState { entries: Array<{ input_sha256: string; [key: string]: unknown }> }
const check = (v: unknown): void => { if (!v) throw new CoreDetectionError(); };
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const runtime = (v: unknown): v is string => typeof v === 'string' && /^synthetic_[A-Za-z0-9_]{1,60}$/.test(v);

/** Trusted local worker persistence. One transaction commits cursor, assessment and candidate together. */
export function createCoreDetectionJournal(dsn: string) {
  localRiskMode(); const db = createDatabase(dsn, 'intake');
  async function transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    localRiskMode(); const client = await db.pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(18503,751)');
      const result = await body(client); await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection release discards failed transaction */ }
      if (error instanceof CoreDetectionError) throw error;
      throw new CoreDetectionError('CORE_DETECTION_STORAGE_UNAVAILABLE');
    } finally { client.release(true); }
  }
  const validateState = (row: { state: unknown; next_offset: number; state_sha256: string; config_sha256: string }, configHash: string) => {
    const state = detachFeatureJSON(row.state, undefined, true) as CoreJournalState;
    check(state && Object.keys(state).join(',') === 'entries' && Array.isArray(state.entries)
      && state.entries.length === row.next_offset && row.config_sha256 === configHash && riskHash(state) === row.state_sha256);
    return state;
  };
  return {
    async register(mappings: unknown[], keys: Array<{ id: string; version: string; sha256: string }>, binding:{runtime_id:string;config_sha256:string}) {
      const parsed = mappings.map(validateIdentityMapping);
      check(keys.length > 0 && keys.length <= 32 && parsed.length <= 32);
      return transaction(async client => {
        check(runtime(binding.runtime_id) && hash(binding.config_sha256));
        const initial={entries:[]};
        await client.query(`INSERT INTO platform.core_detection_checkpoints(workspace_key,runtime_id,config_sha256,state,state_sha256) VALUES('synthetic_local',$1,$2,$3,$4) ON CONFLICT DO NOTHING`,[binding.runtime_id,binding.config_sha256,initial,riskHash(initial)]);
        const checkpoint=(await client.query(`SELECT * FROM platform.core_detection_checkpoints WHERE workspace_key='synthetic_local' AND runtime_id=$1`,[binding.runtime_id])).rows[0];
        validateState(checkpoint,binding.config_sha256);
        for (const key of keys) {
          check(hash(key.sha256));
          await client.query(`INSERT INTO platform.core_identity_keys(workspace_key,key_id,key_version,material_sha256) VALUES('synthetic_local',$1,$2,$3) ON CONFLICT DO NOTHING`, [key.id,key.version,key.sha256]);
          const row = (await client.query(`SELECT material_sha256 FROM platform.core_identity_keys WHERE workspace_key='synthetic_local' AND key_id=$1 AND key_version=$2`,[key.id,key.version])).rows[0];
          check(row?.material_sha256 === key.sha256);
        }
        for (const m of parsed) {
          await client.query(`INSERT INTO platform.core_identity_mappings(workspace_key,namespace,institution,mapping_version,mapping,mapping_sha256,key_id,key_version)
            VALUES('synthetic_local',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[m.namespace,m.owning_institution_id,m.version,m,riskHash(m),m.key.id,m.key.version]);
          const row=(await client.query(`SELECT mapping,mapping_sha256 FROM platform.core_identity_mappings WHERE workspace_key='synthetic_local' AND namespace=$1 AND institution=$2 AND mapping_version=$3`,[m.namespace,m.owning_institution_id,m.version])).rows[0];
          check(row?.mapping_sha256 === riskHash(m) && riskHash(row.mapping)===riskHash(m));
        }
      });
    },
    async keyActive(id: string, version: string) {
      localRiskMode();
      try { return (await db.pool.query(`SELECT revoked FROM platform.core_identity_keys WHERE workspace_key='synthetic_local' AND key_id=$1 AND key_version=$2`,[id,version])).rows[0]?.revoked === false; }
      catch { throw new CoreDetectionError('CORE_IDENTITY_KEY_UNAVAILABLE'); }
    },
    async revokeKey(id: string, version: string) {
      return transaction(async client => {
        const r = await client.query(`UPDATE platform.core_identity_keys SET revoked=true WHERE workspace_key='synthetic_local' AND key_id=$1 AND key_version=$2 AND NOT revoked RETURNING key_id`,[id,version]);
        if (!r.rowCount) check((await client.query(`SELECT revoked FROM platform.core_identity_keys WHERE workspace_key='synthetic_local' AND key_id=$1 AND key_version=$2`,[id,version])).rows[0]?.revoked === true);
      });
    },
    async read(runtimeId: string, configHash: string): Promise<CoreJournalState> {
      check(runtime(runtimeId) && hash(configHash)); localRiskMode();
      const row=(await db.pool.query(`SELECT * FROM platform.core_detection_checkpoints WHERE workspace_key='synthetic_local' AND runtime_id=$1`,[runtimeId])).rows[0];
      return row ? validateState(row,configHash) : {entries:[]};
    },
    async append(runtimeId: string, configHash: string, offset: number, inputHash: string,
      derive: (state: CoreJournalState) => Promise<CoreJournalState>) {
      check(runtime(runtimeId) && hash(configHash) && hash(inputHash) && Number.isSafeInteger(offset) && offset >= 0 && offset < 64);
      return transaction(async client => {
        const initial={entries:[]};
        await client.query(`INSERT INTO platform.core_detection_checkpoints(workspace_key,runtime_id,config_sha256,state,state_sha256) VALUES('synthetic_local',$1,$2,$3,$4) ON CONFLICT DO NOTHING`,[runtimeId,configHash,initial,riskHash(initial)]);
        const row=(await client.query(`SELECT * FROM platform.core_detection_checkpoints WHERE workspace_key='synthetic_local' AND runtime_id=$1 FOR UPDATE`,[runtimeId])).rows[0];
        const state=validateState(row,configHash);
        if (offset < state.entries.length) { check(state.entries[offset]?.input_sha256 === inputHash); return {duplicate:true,entry:state.entries[offset]!}; }
        check(offset === state.entries.length);
        const next=detachFeatureJSON(await derive(state), undefined, true) as CoreJournalState;
        check(Object.keys(next).join(',') === 'entries' && next.entries.length === offset+1 && next.entries[offset]?.input_sha256 === inputHash
          && riskHash(next.entries.slice(0,offset)) === riskHash(state.entries));
        await client.query(`UPDATE platform.core_detection_checkpoints SET next_offset=$2,state=$3,state_sha256=$4 WHERE workspace_key='synthetic_local' AND runtime_id=$1`,[runtimeId,offset+1,next,riskHash(next)]);
        return {duplicate:false,entry:next.entries[offset]!};
      });
    },
    close: () => db.close(),
  };
}
