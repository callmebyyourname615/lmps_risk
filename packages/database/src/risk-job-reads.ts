import type { PoolClient } from 'pg';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import { JOB_ERRORS, JOB_STAGES, JOB_STATES, MAX_JOB_ATTEMPTS } from '@lmps/contracts/risk-job';
import { alertLocalMode } from '@lmps/risk';
import { RiskJobError } from './risk-jobs.js';

type Reader = Pick<PoolClient, 'query'>;
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const uuid = (v: unknown) => typeof v === 'string' && ALERT_UUID.test(v);
const resultCodes = ['ALERT_CREATED', 'ALERT_NO_MATCH', 'ALERT_PARTIAL_EXCLUDED', 'ALERT_ASSESSMENT_INELIGIBLE'];
const timestamps = (alias: string, fields: string[]) => fields.map(name => `to_char(${alias}.${name} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${name}`).join(',');
const jobColumns = `j.job_ref::text,j.namespace,j.transaction_id,j.revision_number,j.status,j.stage,j.attempt_number,j.assessment_run_id::text,j.alert_id::text,j.result_code,j.error_code,
  CASE WHEN j.status='running' AND j.lease_until<=clock_timestamp() THEN 'interrupted' ELSE j.status END AS effective_status,
  ${timestamps('j', ['created_at', 'updated_at', 'next_attempt_at'])}`;
function scope(workspace: string) { alertLocalMode(); if (!/^synthetic_[a-z0-9_]{1,40}$/.test(workspace)) throw new RiskJobError('JOB_INVALID_INPUT'); }
function page(after: string | null, limit: number) {
  if ((after !== null && !uuid(after)) || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new RiskJobError('JOB_INVALID_INPUT');
}
function jobView(row: Record<string, any>) {
  if (!uuid(row.job_ref) || typeof row.namespace !== 'string' || !/^synthetic_[a-z0-9_]{1,40}$/.test(row.namespace)
    || typeof row.transaction_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.transaction_id) || !Number.isInteger(row.revision_number) || row.revision_number<1
    || !JOB_STATES.includes(row.status) || !JOB_STAGES.includes(row.stage)
    || ![...JOB_STATES, 'interrupted'].includes(row.effective_status) || !Number.isInteger(row.attempt_number) || row.attempt_number < 0 || row.attempt_number > MAX_JOB_ATTEMPTS
    || (row.effective_status !== row.status && !(row.status === 'running' && row.effective_status === 'interrupted'))
    || !date(row.created_at) || !date(row.updated_at) || (row.next_attempt_at !== null && !date(row.next_attempt_at))
    || (row.error_code !== null && !JOB_ERRORS.includes(row.error_code)) || (row.result_code !== null && !resultCodes.includes(row.result_code))
    || (row.assessment_run_id !== null && row.assessment_run_id !== row.job_ref) || (row.alert_id !== null && !uuid(row.alert_id))
    || (row.stage === 'assessment' ? row.assessment_run_id !== null : row.assessment_run_id !== row.job_ref)
    || (row.status === 'completed' ? row.stage !== 'done' || row.result_code === null || row.error_code !== null : row.stage === 'done' || row.result_code !== null || row.alert_id !== null)
    || ((row.result_code === 'ALERT_CREATED') !== (row.alert_id !== null))) throw new RiskJobError('JOB_STORAGE_UNAVAILABLE');
  // Explicit allowlist: never echo source/context/manifest/hash/lease material, even if a driver returns extra columns.
  return Object.fromEntries(['job_ref', 'namespace', 'transaction_id', 'revision_number', 'status', 'effective_status', 'stage', 'attempt_number', 'assessment_run_id', 'alert_id', 'result_code', 'error_code', 'created_at', 'updated_at', 'next_attempt_at'].map(key => [key, row[key]]));
}
export async function listRiskJobs(db: Reader, workspace: string, after: string | null = null, limit = 5) {
  scope(workspace); page(after, limit);
  try {
    const rows = (await db.query(`SELECT ${jobColumns} FROM platform.local_risk_jobs j WHERE j.workspace_key=$1 AND j.job_ref>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000') ORDER BY j.job_ref LIMIT $3`, [workspace, after, limit + 1])).rows;
    const items = rows.slice(0, limit).map(jobView);
    return { items, pagination: 'live_committed_view_uuid_order', next_cursor: rows.length > limit ? items.at(-1)!.job_ref : null };
  } catch { throw new RiskJobError('JOB_STORAGE_UNAVAILABLE'); }
}
export async function readRiskJob(db: Reader, workspace: string, id: string) {
  scope(workspace); if (!uuid(id)) throw new RiskJobError('JOB_INVALID_INPUT');
  try {
    const row = (await db.query(`SELECT ${jobColumns} FROM platform.local_risk_jobs j WHERE j.workspace_key=$1 AND j.job_ref=$2`, [workspace, id])).rows[0];
    return row ? jobView(row) : null;
  } catch { throw new RiskJobError('JOB_STORAGE_UNAVAILABLE'); }
}
export async function readRiskJobAttempts(db: Reader, workspace: string, id: string, after = 0, limit = 5) {
  scope(workspace); page(null, limit);
  if (!uuid(id) || !Number.isInteger(after) || after < 0 || after > MAX_JOB_ATTEMPTS) throw new RiskJobError('JOB_INVALID_INPUT');
  try {
    const rows = (await db.query(`SELECT a.attempt_number,a.status,a.started_stage,a.finished_stage,a.error_code,
      CASE WHEN a.status='running' AND j.lease_until<=clock_timestamp() THEN 'interrupted' ELSE a.status END AS effective_status,
      ${timestamps('a', ['started_at', 'finished_at'])} FROM platform.local_risk_job_attempts a JOIN platform.local_risk_jobs j USING(workspace_key,job_ref)
      WHERE a.workspace_key=$1 AND a.job_ref=$2 AND a.attempt_number>$3 ORDER BY a.attempt_number LIMIT $4`, [workspace, id, after, limit + 1])).rows;
    const items = rows.slice(0, limit).map(row => {
      if (!Number.isInteger(row.attempt_number) || row.attempt_number < 1 || row.attempt_number > MAX_JOB_ATTEMPTS
        || !['running', 'completed', 'retry_wait', 'failed', 'interrupted'].includes(row.status)
        || !['running', 'completed', 'retry_wait', 'failed', 'interrupted'].includes(row.effective_status)
        || (row.effective_status !== row.status && !(row.status === 'running' && row.effective_status === 'interrupted'))
        || !['assessment', 'alert'].includes(row.started_stage) || !date(row.started_at)
        || (row.error_code !== null && !JOB_ERRORS.includes(row.error_code))
        || (row.status === 'running' ? row.finished_at !== null || row.finished_stage !== null || row.error_code !== null
          : !date(row.finished_at) || !JOB_STAGES.includes(row.finished_stage))
        || (row.status === 'completed' ? row.finished_stage !== 'done' || row.error_code !== null : row.status !== 'running' && row.error_code === null)) throw new Error();
      return Object.fromEntries(['attempt_number', 'status', 'effective_status', 'started_stage', 'finished_stage', 'error_code', 'started_at', 'finished_at'].map(key => [key, row[key]]));
    });
    return { items, next_cursor: rows.length > limit ? String(items.at(-1)!.attempt_number) : null };
  } catch { throw new RiskJobError('JOB_STORAGE_UNAVAILABLE'); }
}
