import { createHash } from 'node:crypto';
import { createSyncJobs, SyncJobError, type SyncClaim, type SyncIdentity } from '@lmps/database';
import { validateSnapshot, type Snapshot } from './snapshot.js';
import { reconcileSnapshot } from './reconcile.js';

export function snapshotIdentity(input: unknown): SyncIdentity {
  const snapshot = validateSnapshot(input);
  // Sort object keys recursively; JSON formatting/property order does not change frozen evidence identity.
  const canonical = JSON.stringify(snapshot, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  return { workspace_key: 'synthetic_local', capture_id: snapshot.capture_id,
    snapshot_sha256: createHash('sha256').update(canonical).digest('hex'), total: snapshot.events.length };
}
export type SyncRunReport = { capture_id: string; job_ref: string | null; attempt_number: number | null;
  status: 'reconciled' | 'failed' | 'needs_review' | 'busy' | 'already_reconciled' | 'unavailable' | 'stale' };

export async function runSyncJob(input: unknown, intakeDsn: string, readDsn: string): Promise<SyncRunReport> {
  const snapshot: Snapshot = validateSnapshot(input); const identity = snapshotIdentity(snapshot);
  const jobs = createSyncJobs(intakeDsn);
  const report: SyncRunReport = { capture_id: snapshot.capture_id, job_ref: null, attempt_number: null, status: 'unavailable' };
  let claim: SyncClaim | undefined;
  try {
    report.job_ref = await jobs.register(identity);
    const result = await jobs.claim(identity);
    if (result.status !== 'claimed') return { ...report, status: result.status };
    claim = result.claim; report.attempt_number = claim.attempt_number;
    try {
      for (let ordinal = 0; ordinal < snapshot.events.length; ordinal++) await jobs.append(claim, snapshot.events[ordinal], ordinal);
      await jobs.imported(claim);
    } catch (error) {
      if (error instanceof SyncJobError && error.code === 'STALE_LEASE') return { ...report, status: 'stale' };
      report.status = await jobs.finish(claim, error instanceof SyncJobError && error.code === 'EVENT_CONFLICT' ? 'EVENT_CONFLICT' : 'IMPORT_FAILED');
      return report;
    }
    const reconciliation = await reconcileSnapshot(snapshot, readDsn);
    report.status = await jobs.finish(claim, reconciliation.status);
    return report;
  } catch (error) {
    if (error instanceof SyncJobError) {
      if (error.code === 'STORAGE_FAILED') return report;
      if (error.code === 'STALE_LEASE') return { ...report, status: 'stale' };
    }
    throw error;
  } finally { await jobs.close(); }
}
