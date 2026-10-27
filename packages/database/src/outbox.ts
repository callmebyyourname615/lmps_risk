import type { PoolClient } from 'pg';
import { createDatabase } from './index.js';

export type LocalIntent = { workspace_key: string; semantic_key: string; notification_ref: string; expires_at: string };
export type LocalClaim = { workspace_key: string; intent_ref: string; notification_ref: string; lease_token: string; attempt_number: number };
type ClaimResult = { status: 'claimed'; claim: LocalClaim } | { status: 'empty' | 'expired' | 'dead' };
export class OutboxError extends Error {
  constructor(readonly code: 'INVALID_INTENT' | 'INTENT_CONFLICT' | 'STORAGE_FAILED') {
    super(`Local fake outbox: ${code}; diagnostic details withheld.`); this.name = 'OutboxError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKSPACE = /^synthetic_[a-z0-9_]{1,40}$/;
function localMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local') || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new OutboxError('INVALID_INTENT');
}
function workspace(value: unknown): asserts value is string {
  localMode(); if (typeof value !== 'string' || !WORKSPACE.test(value)) throw new OutboxError('INVALID_INTENT');
}
function validateIntent(input: unknown): LocalIntent {
  try {
    localMode(); const value = structuredClone(input) as LocalIntent;
    if (!value || Object.keys(value).sort().join(',') !== 'expires_at,notification_ref,semantic_key,workspace_key') throw new Error();
    workspace(value.workspace_key);
    if (typeof value.semantic_key !== 'string' || !/^synthetic_[a-z0-9_.:-]{1,80}$/.test(value.semantic_key)
      || typeof value.notification_ref !== 'string' || !UUID.test(value.notification_ref)
      || typeof value.expires_at !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expires_at) || new Date(value.expires_at).toISOString() !== value.expires_at) throw new Error();
    return value;
  } catch { throw new OutboxError('INVALID_INTENT'); }
}
function storage(error: unknown): never {
  if (error instanceof OutboxError) throw error;
  throw new OutboxError('STORAGE_FAILED');
}

// Caller owns BEGIN/COMMIT/ROLLBACK when coupling a domain write and its intent.
export async function enqueueLocalIntent(client: PoolClient, input: unknown): Promise<{ status: 'inserted' | 'duplicate'; intent_ref: string }> {
  const value = validateIntent(input);
  try {
    const parameters = [value.workspace_key, value.semantic_key, value.notification_ref, value.expires_at];
    const inserted = await client.query('INSERT INTO platform.local_outbox_intents(workspace_key,semantic_key,notification_ref,expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_key,semantic_key) DO NOTHING RETURNING intent_ref', parameters);
    if (inserted.rowCount === 1) return { status: 'inserted', intent_ref: inserted.rows[0].intent_ref };
    const existing = (await client.query('SELECT intent_ref,(notification_ref=$3::uuid AND expires_at=$4::timestamptz) AS matches FROM platform.local_outbox_intents WHERE workspace_key=$1 AND semantic_key=$2', parameters)).rows[0];
    if (!existing?.matches) throw new OutboxError('INTENT_CONFLICT');
    return { status: 'duplicate', intent_ref: existing.intent_ref };
  } catch (error) { return storage(error); }
}

export function createLocalOutbox(dsn: string) {
  localMode(); const database = createDatabase(dsn, 'outbox');
  async function transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined; let active = false; let discard = false;
    try {
      client = await database.pool.connect(); await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); active = true;
      const result = await action(client); await client.query('COMMIT'); active = false; return result;
    } catch (error) {
      if (active && client) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
      return storage(error);
    } finally { client?.release(discard); }
  }
  return {
    close: database.close,
    enqueue(input: unknown) {
      const value = validateIntent(input);
      return transaction(client => enqueueLocalIntent(client, value));
    },
    async claim(scope: string): Promise<ClaimResult> {
      workspace(scope);
      try {
        const result = await database.pool.query(`WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS at), candidate AS (
          SELECT q.intent_ref FROM platform.local_outbox_intents q,clock
          WHERE workspace_key=$1 AND ((state='pending' AND available_at<=clock.at) OR (state='leased' AND lease_until<=clock.at))
          ORDER BY available_at,intent_ref LIMIT 1 FOR UPDATE OF q SKIP LOCKED
        ), claimed AS (
          UPDATE platform.local_outbox_intents q SET
            state=CASE WHEN expires_at<=clock.at THEN 'expired' WHEN attempt_count>=3 THEN 'dead' ELSE 'leased' END,
            attempt_count=attempt_count+CASE WHEN expires_at>clock.at AND attempt_count<3 THEN 1 ELSE 0 END,
            lease_token=CASE WHEN expires_at>clock.at AND attempt_count<3 THEN gen_random_uuid() ELSE NULL END,
            lease_until=CASE WHEN expires_at>clock.at AND attempt_count<3 THEN clock.at+interval '5 seconds' ELSE NULL END
          FROM candidate,clock WHERE q.intent_ref=candidate.intent_ref
          RETURNING q.workspace_key,q.intent_ref,q.notification_ref,q.lease_token,q.attempt_count,q.state
        ), recorded AS (
          INSERT INTO platform.local_outbox_attempts(workspace_key,intent_ref,attempt_number,lease_token)
          SELECT workspace_key,intent_ref,attempt_count,lease_token FROM claimed WHERE state='leased' RETURNING attempt_id
        ) SELECT claimed.*,(SELECT count(*) FROM recorded) AS attempts_recorded FROM claimed`, [scope]);
        const row = result.rows[0];
        if (!row) return { status: 'empty' };
        if (row.state !== 'leased') return { status: row.state as 'expired' | 'dead' };
        return { status: 'claimed', claim: { workspace_key: row.workspace_key, intent_ref: row.intent_ref, notification_ref: row.notification_ref, lease_token: row.lease_token, attempt_number: row.attempt_count } };
      } catch (error) { return storage(error); }
    },
    async finish(input: LocalClaim, outcome: 'accepted' | 'retry' | 'permanent'): Promise<{ status: 'accepted' | 'pending' | 'dead' | 'stale' }> {
      let claim: LocalClaim;
      try {
        claim = structuredClone(input); workspace(claim?.workspace_key);
        if (Object.keys(claim).sort().join(',') !== 'attempt_number,intent_ref,lease_token,notification_ref,workspace_key'
          || ![claim.intent_ref, claim.lease_token, claim.notification_ref].every(value => typeof value === 'string' && UUID.test(value))
          || !Number.isInteger(claim.attempt_number) || claim.attempt_number < 1 || claim.attempt_number > 3 || !['accepted', 'retry', 'permanent'].includes(outcome)) throw new Error();
      } catch { throw new OutboxError('INVALID_INTENT'); }
      return transaction(async client => {
        const updated = await client.query(`UPDATE platform.local_outbox_intents SET
          state=CASE WHEN $6='accepted' THEN 'accepted' WHEN $6='permanent' OR attempt_count>=3 THEN 'dead' ELSE 'pending' END,
          available_at=clock_timestamp()+((power(2,attempt_count-1)+random())*interval '1 second'), lease_token=NULL,lease_until=NULL
          WHERE workspace_key=$1 AND intent_ref=$2 AND lease_token=$3 AND notification_ref=$4 AND attempt_count=$5 AND state='leased'
            AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING state`, [claim.workspace_key, claim.intent_ref, claim.lease_token, claim.notification_ref, claim.attempt_number, outcome]);
        if (!updated.rowCount) return { status: 'stale' };
        const attempt = await client.query("UPDATE platform.local_outbox_attempts SET outcome=$4,finished_at=clock_timestamp() WHERE workspace_key=$1 AND intent_ref=$2 AND lease_token=$3 AND outcome='unknown' RETURNING attempt_id", [claim.workspace_key, claim.intent_ref, claim.lease_token, outcome]);
        if (attempt.rowCount !== 1) throw new OutboxError('STORAGE_FAILED');
        return { status: updated.rows[0].state as 'accepted' | 'pending' | 'dead' };
      });
    },
  };
}
