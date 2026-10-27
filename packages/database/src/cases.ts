import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import {
  CaseError,
  caseIdentity,
  validateCaseCommand,
  riskHash,
  type CaseCommand,
  type CaseErrorCode,
  type CaseView,
  type CaseEvidence,
} from '@lmps/risk';
import { createDatabase } from './index.js';
import { readLocalAlert, type AlertView } from './alerts.js';

type Queryable = Pick<Pool, 'query'> | PoolClient;
function storage(error: unknown): never {
  if (error instanceof CaseError) throw error;
  throw new CaseError('CASE_STORAGE_UNAVAILABLE');
}
const viewQuery = `SELECT c.*,e.result AS last_result,o.dimensions,o.dimensions_sha256,o.review_cycle AS outcome_cycle,o.evidence_version AS outcome_evidence,
 o.actor_subject AS outcome_actor,o.review_status,o.maturity,o.training_eligible,
 (SELECT count(*)::int FROM platform.local_case_alerts l WHERE (l.workspace_key,l.case_id)=(c.workspace_key,c.case_id)) AS alert_count
 FROM platform.local_cases c JOIN platform.local_case_events e ON (e.workspace_key,e.case_id,e.version)=(c.workspace_key,c.case_id,c.version)
 LEFT JOIN platform.local_case_outcomes o ON (o.workspace_key,o.case_id,o.version)=(c.workspace_key,c.case_id,c.active_outcome_version)`;
function core(row: Record<string, any>) {
  return {
    case_id: row.case_id,
    state: row.state,
    version: row.version,
    assignee_subject: row.assignee_subject,
    review_cycle: row.review_cycle,
    evidence_version: row.evidence_version,
    active_outcome_version: row.active_outcome_version,
  };
}
function outcome(row: Record<string, any>) {
  try {
    const dimensions = row.dimensions;
    validateCaseCommand({
      action: 'record_outcome',
      request_id: '00000000-0000-4000-8000-000000000001',
      expected_version: 1,
      note: 'Validate stored dimensions',
      dimensions,
    });
    if (
      riskHash(dimensions) !== row.dimensions_sha256 ||
      row.review_status !== 'analyst_reviewed' ||
      row.maturity !== 'unverified' ||
      row.training_eligible !== false
    )
      throw new Error();
    return { dimensions, review_status: 'analyst_reviewed', maturity: 'unverified', training_eligible: false };
  } catch {
    throw new CaseError('CASE_STORAGE_UNAVAILABLE');
  }
}
function view(row: Record<string, any>, workspace: string) {
  try {
    if (
      row.workspace_key !== workspace ||
      row.recorded_by !== 'lmps_case' ||
      !isDeepStrictEqual(core(row), row.last_result) ||
      row.alert_count !== row.evidence_version ||
      row.alert_count < 1 ||
      row.alert_count > 20
    )
      throw new Error();
    if (
      row.active_outcome_version !== null &&
      (row.outcome_cycle !== row.review_cycle ||
        row.outcome_evidence !== row.evidence_version ||
        row.outcome_actor !== row.assignee_subject)
    )
      throw new Error();
    const record: CaseView = {
      ...core(row),
      title: row.title,
      created_by: row.created_by,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
      alert_count: row.alert_count,
    };
    return {
      ...record,
      current_outcome:
        row.active_outcome_version === null ? null : { version: row.active_outcome_version, ...outcome(row) },
    };
  } catch (error) {
    return storage(error);
  }
}
export function caseAlertEvidence(alert: AlertView): CaseEvidence {
  return {
    alert_id: alert.alert_id,
    alert_snapshot_sha256: alert.snapshot_sha256,
    assessment_run_id: alert.assessment.run_id,
    assessment_sha256: alert.snapshot.assessment_sha256,
    target: alert.assessment.target,
    risk_policy: alert.assessment.policy,
    alert_policy: {
      policy_id: alert.snapshot.policy.policy_id,
      version: alert.snapshot.policy.version,
      sha256: riskHash(alert.snapshot.policy),
    },
  };
}
export async function readLocalCase(pool: Queryable, workspace: string, id: string) {
  caseIdentity(workspace, id);
  try {
    const row = (await pool.query(viewQuery + ' WHERE c.workspace_key=$1 AND c.case_id=$2', [workspace, id])).rows[0];
    return row ? view(row, workspace) : null;
  } catch (error) {
    return storage(error);
  }
}
export interface CaseQuery {
  after?: string;
  limit?: number;
  state?: string;
  assignee?: string;
}
export async function listLocalCases(pool: Queryable, workspace: string, query: CaseQuery = {}) {
  caseIdentity(workspace, query.after);
  const limit = query.limit ?? 5;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10 ||
    Object.keys(query).some((k) => !['after', 'limit', 'state', 'assignee'].includes(k)) ||
    (query.state !== undefined && !['open', 'in_review', 'closed'].includes(query.state)) ||
    (query.assignee !== undefined && !/^synthetic_[a-z0-9_]{1,40}$/.test(query.assignee))
  )
    throw new CaseError('CASE_INVALID_INPUT');
  try {
    const rows = (
      await pool.query(
        viewQuery +
          ` WHERE c.workspace_key=$1 AND c.case_id>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
 AND ($3::text IS NULL OR c.state=$3) AND ($4::text IS NULL OR c.assignee_subject=$4) ORDER BY c.case_id LIMIT $5`,
        [workspace, query.after ?? null, query.state ?? null, query.assignee ?? null, limit + 1],
      )
    ).rows;
    const items = rows.slice(0, limit).map((row) => view(row, workspace));
    return {
      pagination: 'live_committed_view_uuid_order',
      items,
      next_cursor: rows.length > limit ? items.at(-1)!.case_id : null,
    };
  } catch (error) {
    return storage(error);
  }
}
async function readCaseHistorySnapshot(
  pool: Queryable,
  workspace: string,
  id: string,
  kind: 'events' | 'outcomes' | 'evidence',
  after = 0,
  limit = 5,
) {
  try {
    const current = await readLocalCase(pool, workspace, id);
    if (!current) return { case: null, items: [], next_cursor: null };
    const table = { events: 'local_case_events', outcomes: 'local_case_outcomes', evidence: 'local_case_alerts' }[kind],
      column = kind === 'evidence' ? 'added_version' : 'version';
    const records = (
      await pool.query(
        `SELECT * FROM platform.${table} WHERE workspace_key=$1 AND case_id=$2 AND ${column}>$3 ORDER BY ${column} LIMIT $4`,
        [workspace, id, after, limit + 1],
      )
    ).rows;
    const items = [];
    for (const row of records.slice(0, limit)) {
      if (kind === 'events') {
        const command = validateCaseCommand(row.command);
        if (
          command.action !== row.action ||
          command.request_id !== row.request_id ||
          command.expected_version !== row.version - 1 ||
          row.actor_role !== 'lmps_case' ||
          row.result.case_id !== id ||
          row.result.version !== row.version
        )
          throw new CaseError('CASE_STORAGE_UNAVAILABLE');
        items.push({
          version: row.version,
          request_id: row.request_id,
          action: row.action,
          actor_subject: row.actor_subject,
          actor_role: row.actor_role,
          note: command.note,
          result: row.result,
          occurred_at: new Date(row.occurred_at).toISOString(),
        });
      } else if (kind === 'outcomes') {
        items.push({
          version: row.version,
          review_cycle: row.review_cycle,
          evidence_version: row.evidence_version,
          actor_subject: row.actor_subject,
          occurred_at: new Date(row.occurred_at).toISOString(),
          effective_current: current.active_outcome_version === row.version,
          ...outcome(row),
        });
      } else {
        const alert = await readLocalAlert(pool, workspace, row.alert_id);
        if (
          !alert ||
          riskHash(row.evidence) !== row.evidence_sha256 ||
          !isDeepStrictEqual(row.evidence, caseAlertEvidence(alert))
        )
          throw new CaseError('CASE_STORAGE_UNAVAILABLE');
        items.push({ added_version: row.added_version, evidence_sha256: row.evidence_sha256, ...row.evidence });
      }
    }
    return {
      case: { case_id: id, version: current.version },
      pagination: 'live_committed_view_version_order',
      items,
      next_cursor: records.length > limit ? records[limit - 1][column] : null,
    };
  } catch (error) {
    return storage(error);
  }
}
export async function readCaseHistory(
  pool: Pool,
  workspace: string,
  id: string,
  kind: 'events' | 'outcomes' | 'evidence',
  after = 0,
  limit = 5,
) {
  caseIdentity(workspace, id);
  if (
    !['events', 'outcomes', 'evidence'].includes(kind) ||
    !Number.isInteger(after) ||
    after < 0 ||
    after > 1000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10
  )
    throw new CaseError('CASE_INVALID_INPUT');
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await readCaseHistorySnapshot(client, workspace, id, kind, after, limit);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* Discard below. */
      }
    }
    return storage(error);
  } finally {
    client?.release(true);
  }
}
async function verifyCaseEvidence(client: PoolClient, workspace: string, id: string) {
  const links = (
    await client.query(
      'SELECT alert_id,evidence,evidence_sha256 FROM platform.local_case_alerts WHERE workspace_key=$1 AND case_id=$2 ORDER BY added_version LIMIT 21',
      [workspace, id],
    )
  ).rows;
  if (links.length > 20) throw new CaseError('CASE_STORAGE_UNAVAILABLE');
  for (const row of links) {
    const alert = await readLocalAlert(client, workspace, row.alert_id);
    if (
      !alert ||
      riskHash(row.evidence) !== row.evidence_sha256 ||
      !isDeepStrictEqual(row.evidence, caseAlertEvidence(alert))
    )
      throw new CaseError('CASE_STORAGE_UNAVAILABLE');
  }
}
export function createLocalCases(dsn: string) {
  caseIdentity('synthetic_local');
  const database = createDatabase(dsn, 'case');
  return {
    close: database.close,
    async command(workspace: string, id: string, actor: string, input: unknown) {
      caseIdentity(workspace, id);
      const command = validateCaseCommand(input);
      if (workspace !== 'synthetic_local' || !/^synthetic_[a-z0-9_]{1,40}$/.test(actor))
        throw new CaseError('CASE_INVALID_INPUT');
      let client: PoolClient | undefined,
        active = false;
      try {
        client = await database.pool.connect();
        await client.query('BEGIN');
        active = true;
        let evidence: CaseEvidence | null = null;
        if (command.action === 'create' || command.action === 'link_alert') {
          const alert = await readLocalAlert(client, workspace, command.alert_id);
          if (!alert) throw new CaseError('CASE_ALERT_NOT_FOUND');
          evidence = caseAlertEvidence(alert);
        }
        if (command.action === 'record_outcome' || command.action === 'close')
          await verifyCaseEvidence(client, workspace, id);
        const hash = evidence
          ? riskHash(evidence)
          : command.action === 'record_outcome'
            ? riskHash(command.dimensions)
            : null;
        const result = (
          await client.query('SELECT platform.command_local_case($1,$2,$3,$4,$5,$6) AS result', [
            workspace,
            id,
            actor,
            JSON.stringify(command),
            evidence ? JSON.stringify(evidence) : null,
            hash,
          ])
        ).rows[0].result;
        await client.query('COMMIT');
        active = false;
        return result as { status: 'inserted' | 'duplicate'; result: Record<string, unknown> };
      } catch (error) {
        if (client && active) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* Discard below. */
          }
        }
        if (error instanceof CaseError) throw error;
        const codes: Record<string, CaseErrorCode> = {
          P3700: 'CASE_INVALID_INPUT',
          P3704: 'CASE_NOT_FOUND',
          P3705: 'CASE_ALERT_NOT_FOUND',
          P3708: 'CASE_ALERT_ALREADY_LINKED',
          P3709: 'CASE_CONFLICT',
          P3710: 'CASE_INVALID_TRANSITION',
          P3711: 'CASE_NOT_ASSIGNEE',
          P3712: 'CASE_OUTCOME_REQUIRED',
          P3713: 'CASE_LIMIT_REACHED',
        };
        throw new CaseError(codes[(error as { code?: string }).code ?? ''] ?? 'CASE_STORAGE_UNAVAILABLE');
      } finally {
        client?.release(true);
      }
    },
  };
}
