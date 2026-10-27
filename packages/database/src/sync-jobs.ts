import type { PoolClient } from 'pg';
import { createDatabase } from './index.js';
import { appendSourceEvent, IntakeError, validateSourceEvent } from './source-intake.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type SyncIdentity = { workspace_key: string; capture_id: string; snapshot_sha256: string; total: number };
export type SyncClaim = { workspace_key: string; capture_id: string; job_ref: string; attempt_number: number; lease_token: string };
export type SyncOutcome = 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'LIMIT_EXCEEDED' | 'IMPORT_FAILED' | 'EVENT_CONFLICT';
export class SyncJobError extends Error {
  constructor(readonly code: 'INVALID_JOB' | 'SNAPSHOT_CONFLICT' | 'STORAGE_FAILED' | 'STALE_LEASE' | 'EVENT_CONFLICT' | 'ATTEMPT_LIMIT') {
    super(`Local sync job: ${code}; diagnostic details withheld.`); this.name = 'SyncJobError';
  }
}
function mode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local') || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new SyncJobError('INVALID_JOB');
}
function scope(value: unknown): value is string { return typeof value === 'string' && /^synthetic_[a-z0-9_]{1,40}$/.test(value); }
function identity(input: SyncIdentity): SyncIdentity {
  mode();
  try {
    const value = structuredClone(input);
    if (!value || Object.keys(value).sort().join(',') !== 'capture_id,snapshot_sha256,total,workspace_key' || !scope(value.workspace_key)
      || typeof value.capture_id !== 'string' || !UUID.test(value.capture_id) || typeof value.snapshot_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.snapshot_sha256)
      || !Number.isInteger(value.total) || value.total < 0 || value.total > 400) throw new Error();
    return value;
  } catch { throw new SyncJobError('INVALID_JOB'); }
}
function claimValue(input: SyncClaim): SyncClaim {
  mode();
  try {
    const value = structuredClone(input);
    if (!value || Object.keys(value).sort().join(',') !== 'attempt_number,capture_id,job_ref,lease_token,workspace_key' || !scope(value.workspace_key)
      || ![value.capture_id, value.job_ref, value.lease_token].every(value => typeof value === 'string' && UUID.test(value))
      || !Number.isInteger(value.attempt_number) || value.attempt_number < 1 || value.attempt_number > 32) throw new Error();
    return value;
  } catch { throw new SyncJobError('INVALID_JOB'); }
}
function parameters(claim: SyncClaim) { return [claim.workspace_key, claim.job_ref, claim.lease_token, claim.attempt_number, claim.capture_id]; }

// shortcut: bounded local snapshots only; adopt approved capture/offset protocols before real CDC.
export function createSyncJobs(dsn: string) {
  mode(); const database = createDatabase(dsn, 'intake');
  async function transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined; let active = false; let discard = false;
    try {
      client = await database.pool.connect(); await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); active = true;
      const result = await action(client); await client.query('COMMIT'); active = false; return result;
    } catch (error) {
      if (client && active) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
      if (error instanceof SyncJobError) throw error;
      if (error instanceof IntakeError && error.code === 'EVENT_CONFLICT') throw new SyncJobError('EVENT_CONFLICT');
      throw new SyncJobError('STORAGE_FAILED');
    } finally { client?.release(discard); }
  }
  async function lock(client: PoolClient, claim: SyncClaim) {
    const row = (await client.query(`SELECT total,status FROM platform.local_sync_jobs
      WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4 AND capture_id=$5
        AND status IN ('running','imported') AND lease_until>clock_timestamp() FOR UPDATE`, parameters(claim))).rows[0];
    if (!row) throw new SyncJobError('STALE_LEASE'); return row as { total: number; status: string };
  }
  async function renew(client: PoolClient, claim: SyncClaim) {
    const result = await client.query(`UPDATE platform.local_sync_jobs SET lease_until=clock_timestamp()+interval '10 seconds',updated_at=clock_timestamp()
      WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4 AND capture_id=$5 AND lease_until>clock_timestamp()`, parameters(claim));
    if (result.rowCount !== 1) throw new SyncJobError('STALE_LEASE');
  }
  return {
    close: database.close,
    async register(input: SyncIdentity): Promise<string> {
      const value = identity(input);
      return transaction(async client => {
        const args = [value.workspace_key, value.capture_id, value.snapshot_sha256, value.total];
        const inserted = await client.query(`INSERT INTO platform.local_sync_jobs(workspace_key,capture_id,snapshot_sha256,total)
          VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_key,capture_id) DO NOTHING RETURNING job_ref`, args);
        if (inserted.rowCount) return inserted.rows[0].job_ref as string;
        const existing = (await client.query(`SELECT job_ref,(snapshot_sha256=$3 AND total=$4) AS matches FROM platform.local_sync_jobs WHERE workspace_key=$1 AND capture_id=$2`, args)).rows[0];
        if (!existing?.matches) throw new SyncJobError('SNAPSHOT_CONFLICT'); return existing.job_ref as string;
      });
    },
    async claim(input: SyncIdentity): Promise<{ status: 'claimed'; claim: SyncClaim } | { status: 'busy' | 'already_reconciled'; job_ref: string }> {
      const value = identity(input);
      return transaction(async client => {
        const job = (await client.query(`SELECT *,lease_until>clock_timestamp() AS active FROM platform.local_sync_jobs WHERE workspace_key=$1 AND capture_id=$2 FOR UPDATE`, [value.workspace_key, value.capture_id])).rows[0];
        if (!job || job.snapshot_sha256 !== value.snapshot_sha256 || job.total !== value.total) throw new SyncJobError('SNAPSHOT_CONFLICT');
        if (job.status === 'reconciled') return { status: 'already_reconciled', job_ref: job.job_ref };
        if (job.active) return { status: 'busy', job_ref: job.job_ref };
        if (job.attempt_number >= 32) throw new SyncJobError('ATTEMPT_LIMIT');
        if (job.lease_token) await client.query(`UPDATE platform.local_sync_attempts SET status='interrupted',error_code='LEASE_EXPIRED',finished_at=clock_timestamp()
          WHERE workspace_key=$1 AND job_ref=$2 AND attempt_number=$3 AND status='running'`, [value.workspace_key, job.job_ref, job.attempt_number]);
        const updated = (await client.query(`UPDATE platform.local_sync_jobs SET status='running',attempt_number=attempt_number+1,
          lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 seconds',updated_at=clock_timestamp()
          WHERE workspace_key=$1 AND job_ref=$2 RETURNING workspace_key,capture_id,job_ref,attempt_number,lease_token`, [value.workspace_key, job.job_ref])).rows[0] as SyncClaim;
        await client.query(`INSERT INTO platform.local_sync_attempts(workspace_key,job_ref,attempt_number,lease_token) VALUES ($1,$2,$3,$4)`, [updated.workspace_key, updated.job_ref, updated.attempt_number, updated.lease_token]);
        return { status: 'claimed', claim: updated };
      });
    },
    async append(input: SyncClaim, inputEvent: unknown, ordinal: number) {
      const claim = claimValue(input); const event = validateSourceEvent(inputEvent);
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= 400 || event.workspace_key !== claim.workspace_key || event.capture_epoch !== claim.capture_id
        || event.source_namespace !== 'synthetic_snapshot' || event.operation !== 'snapshot') throw new SyncJobError('INVALID_JOB');
      return transaction(async client => {
        const job = await lock(client, claim);
        if (job.status !== 'running' || ordinal >= job.total) throw new SyncJobError('INVALID_JOB');
        const attempt = (await client.query(`SELECT processed FROM platform.local_sync_attempts WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4`, parameters(claim).slice(0, 4))).rows[0];
        if (attempt?.processed !== ordinal) throw new SyncJobError('INVALID_JOB');
        const result = await appendSourceEvent(client, event);
        await client.query(`UPDATE platform.local_sync_attempts SET processed=processed+1,inserted=inserted+$5,duplicate=duplicate+$6
          WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4`, [...parameters(claim).slice(0, 4), result.status === 'inserted' ? 1 : 0, result.status === 'duplicate' ? 1 : 0]);
        // A post-write lease check rolls back both the event and checkpoint if ownership expired while waiting.
        await renew(client, claim); return result;
      });
    },
    async imported(input: SyncClaim) {
      const claim = claimValue(input);
      return transaction(async client => {
        const job = await lock(client, claim);
        const updated = await client.query(`UPDATE platform.local_sync_attempts SET import_completed=true
          WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4 AND processed=$5 AND status='running'`, [...parameters(claim).slice(0, 4), job.total]);
        if (job.status !== 'running' || updated.rowCount !== 1) throw new SyncJobError('INVALID_JOB');
        await client.query(`UPDATE platform.local_sync_jobs SET status='imported' WHERE workspace_key=$1 AND job_ref=$2`, [claim.workspace_key, claim.job_ref]);
        await renew(client, claim);
      });
    },
    async finish(input: SyncClaim, outcome: SyncOutcome): Promise<'reconciled' | 'failed' | 'needs_review'> {
      const claim = claimValue(input);
      if (!['PASS', 'FAIL', 'UNAVAILABLE', 'LIMIT_EXCEEDED', 'IMPORT_FAILED', 'EVENT_CONFLICT'].includes(outcome)) throw new SyncJobError('INVALID_JOB');
      return transaction(async client => {
        const job = await lock(client, claim); const reconciliation = ['PASS', 'FAIL', 'UNAVAILABLE', 'LIMIT_EXCEEDED'].includes(outcome);
        if (reconciliation && job.status !== 'imported') throw new SyncJobError('INVALID_JOB');
        const status = outcome === 'PASS' ? 'reconciled' : ['FAIL', 'EVENT_CONFLICT'].includes(outcome) ? 'needs_review' : 'failed';
        const error = { PASS: null, FAIL: 'RECONCILE_FAILED', UNAVAILABLE: 'RECONCILE_UNAVAILABLE', LIMIT_EXCEEDED: 'RECONCILE_LIMIT_EXCEEDED', IMPORT_FAILED: 'STORAGE_FAILED', EVENT_CONFLICT: 'EVENT_CONFLICT' }[outcome];
        const updated = await client.query(`UPDATE platform.local_sync_attempts SET status=$5,reconciliation_status=$6,error_code=$7,finished_at=clock_timestamp()
          WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4 AND status='running'`, [...parameters(claim).slice(0, 4), status, reconciliation ? outcome : null, error]);
        if (updated.rowCount !== 1) throw new SyncJobError('STALE_LEASE');
        const done = await client.query(`UPDATE platform.local_sync_jobs SET status=$6,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
          WHERE workspace_key=$1 AND job_ref=$2 AND lease_token=$3 AND attempt_number=$4 AND capture_id=$5 AND lease_until>clock_timestamp()`, [...parameters(claim), status]);
        if (done.rowCount !== 1) throw new SyncJobError('STALE_LEASE'); return status;
      });
    },
  };
}
