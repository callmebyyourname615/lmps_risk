import { BadRequestException, Controller, Get, Inject, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

// shortcut: live cursors can miss late lower-ID commits; use an approved stable export protocol for feeds.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = () => new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local sync query.' });
function page(query: Record<string, unknown>, extra: string[] = []) {
  const after = query.after ?? '0'; const limit = query.limit ?? '25';
  if (Object.keys(query).some(key => !['after', 'limit', ...extra].includes(key))
    || typeof after !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n
    || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) throw invalid();
  return { after, limit: Number(limit) };
}
class SyncAttemptView {
  @ApiProperty() attempt_number!: number;
  @ApiProperty() status!: string;
  @ApiProperty() effective_status!: string;
  @ApiProperty() processed!: number;
  @ApiProperty() inserted!: number;
  @ApiProperty() duplicate!: number;
  @ApiProperty() import_completed!: boolean;
  @ApiProperty({ type: String, nullable: true }) reconciliation_status!: string | null;
  @ApiProperty({ type: String, nullable: true }) error_code!: string | null;
  @ApiProperty({ format: 'date-time' }) started_at!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finished_at!: string | null;
}
class SyncJobView {
  @ApiProperty({ type: String }) job_id!: string;
  @ApiProperty({ format: 'uuid' }) job_ref!: string;
  @ApiProperty({ format: 'uuid' }) capture_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() effective_status!: string;
  @ApiProperty() total!: number;
  @ApiProperty() attempt_number!: number;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ format: 'date-time' }) updated_at!: string;
  @ApiProperty({ type: SyncAttemptView, nullable: true }) last_attempt!: SyncAttemptView | null;
}
class SyncJobPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: 'live_committed_view';
  @ApiProperty({ type: [SyncJobView] }) items!: SyncJobView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class SyncAttemptPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ format: 'uuid' }) job_ref!: string;
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: 'live_committed_view';
  @ApiProperty({ type: [SyncAttemptView] }) items!: SyncAttemptView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
// Explicit projection excludes fingerprints, source payloads and all lease/credential material.
const attemptColumns = `a.attempt_number,a.status,
  CASE WHEN a.status='running' AND j.lease_until<=clock_timestamp() THEN 'interrupted' ELSE a.status END AS effective_status,
  a.processed,a.inserted,a.duplicate,a.import_completed,a.reconciliation_status,a.error_code,
  to_char(a.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
  to_char(a.finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS finished_at`;

@ApiTags('local-sync')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'sync:read')
@Controller('v1/local/sync/jobs')
export class SyncController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  @Get()
  @ApiOperation({ summary: 'Browse workspace snapshot import jobs; recorded reconciliation is a historical result, not current source readiness' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'capture_id', required: false, type: String, format: 'uuid' })
  @ApiOkResponse({ type: SyncJobPage })
  @ApiResponse({ status: 400, description: 'INVALID_QUERY' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 503, description: 'SYNC_UNAVAILABLE' })
  async jobs(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<SyncJobPage> {
    const { after, limit } = page(query, ['capture_id']); const capture = query.capture_id;
    if (capture !== undefined && (typeof capture !== 'string' || !UUID.test(capture))) throw invalid();
    try {
      const args = capture === undefined ? [request.principal.workspace, after, limit + 1] : [request.principal.workspace, after, limit + 1, capture];
      const result = await this.database.pool.query(`SELECT j.job_id,j.job_ref,j.capture_id,j.status,j.total,j.attempt_number,
        CASE WHEN j.status IN ('running','imported') AND j.lease_until<=clock_timestamp() THEN 'interrupted' ELSE j.status END AS effective_status,
        to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
        to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
        (SELECT row_to_json(last_attempt) FROM (SELECT ${attemptColumns}) last_attempt WHERE a.job_ref IS NOT NULL) AS last_attempt
        FROM platform.local_sync_jobs j LEFT JOIN platform.local_sync_attempts a
          ON a.workspace_key=j.workspace_key AND a.job_ref=j.job_ref AND a.attempt_number=j.attempt_number
        WHERE j.workspace_key=$1 AND j.job_id>$2::bigint ${capture === undefined ? '' : 'AND j.capture_id=$4::uuid'} ORDER BY j.job_id LIMIT $3`, args);
      const items = result.rows.slice(0, limit) as SyncJobView[];
      return { provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.principal.workspace, pagination: 'live_committed_view',
        items, next_cursor: result.rows.length > limit ? items.at(-1)!.job_id : null };
    } catch { throw new ServiceUnavailableException({ code: 'SYNC_UNAVAILABLE', message: 'Local sync status is unavailable.' }); }
  }
  @Get(':job_ref/attempts')
  @ApiOperation({ summary: 'Read bounded workspace job attempt history; unknown or foreign jobs return an empty page' })
  @ApiParam({ name: 'job_ref', format: 'uuid' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: SyncAttemptPage })
  @ApiResponse({ status: 400, description: 'INVALID_QUERY' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 503, description: 'SYNC_UNAVAILABLE' })
  async attempts(@Req() request: ScopedRequest, @Param('job_ref') ref: string, @Query() query: Record<string, unknown>): Promise<SyncAttemptPage> {
    const { after, limit } = page(query); if (!UUID.test(ref)) throw invalid();
    try {
      const result = await this.database.pool.query(`SELECT ${attemptColumns} FROM platform.local_sync_attempts a JOIN platform.local_sync_jobs j
        ON j.workspace_key=a.workspace_key AND j.job_ref=a.job_ref WHERE a.workspace_key=$1 AND a.job_ref=$2 AND a.attempt_number>$3::bigint
        ORDER BY a.attempt_number LIMIT $4`, [request.principal.workspace, ref, after, limit + 1]);
      const items = result.rows.slice(0, limit) as SyncAttemptView[];
      return { provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.principal.workspace, job_ref: ref, pagination: 'live_committed_view',
        items, next_cursor: result.rows.length > limit ? String(items.at(-1)!.attempt_number) : null };
    } catch { throw new ServiceUnavailableException({ code: 'SYNC_UNAVAILABLE', message: 'Local sync status is unavailable.' }); }
  }
}
