import { createRiskJobs, RiskJobError } from '@lmps/database';

export async function runRiskJob(dsn: string, id?: string) {
  const jobs = createRiskJobs(dsn);
  let claim;
  try {
    const result = await jobs.claim(id);
    if (result.status === 'idle') return { status: 'idle' as const };
    if (result.status === 'exhausted') return { status: 'failed' as const, job_ref: result.job_ref, error_code: 'JOB_LEASE_EXPIRED' };
    claim = result.claim;
    let step = await jobs.advance(claim);
    if (step.stage === 'alert') step = await jobs.advance(claim);
    return { status: 'completed' as const, job_ref: claim.job_ref, attempt_number: claim.attempt_number, ...step };
  } catch (error) {
    const code = error instanceof RiskJobError ? error.code : 'JOB_STORAGE_UNAVAILABLE';
    if (code === 'JOB_STALE_LEASE') return { status: 'stale' as const, job_ref: claim?.job_ref };
    if (!claim) throw new RiskJobError(code);
    try {
      const saved = await jobs.fail(claim, code);
      return { ...saved, job_ref: claim.job_ref, attempt_number: claim.attempt_number, error_code: code };
    } catch (failure) {
      return { status: failure instanceof RiskJobError && failure.code === 'JOB_STALE_LEASE' ? 'stale' as const : 'unavailable' as const, job_ref: claim.job_ref };
    }
  } finally { await jobs.close(); }
}
