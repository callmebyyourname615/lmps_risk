import { BadRequestException, Controller, Get, Inject, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

class AuditEventView {
  @ApiProperty({ type: String }) audit_id!: string;
  @ApiProperty({ format: 'uuid' }) event_ref!: string;
  @ApiProperty({ enum: [1, 2] }) schema_version!: number;
  @ApiProperty({ enum: ['lmps_outbox', 'lmps_intake', 'lmps_migrator', 'lmps_bootstrap'] }) actor_role!: string;
  @ApiProperty({ enum: ['service', 'database_operator'] }) actor_type!: string;
  @ApiProperty({ enum: ['outbox.intent_created', 'outbox.intent_updated', 'outbox.attempt_started', 'outbox.attempt_finished', 'sync.job_created', 'sync.job_updated', 'sync.attempt_finished'] }) action!: string;
  @ApiProperty({ enum: ['local_outbox_intent', 'local_sync_job'] }) target_type!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) capture_id!: string | null;
  @ApiProperty({ type: String, nullable: true }) job_status!: string | null;
  @ApiProperty({ type: String, nullable: true }) previous_job_status!: string | null;
  @ApiProperty({ format: 'uuid' }) target_ref!: string;
  @ApiProperty({ format: 'uuid', description: 'Stable target reference linking these service events; not an HTTP request/trace ID.' }) correlation_id!: string;
  @ApiProperty({ type: String, nullable: true }) previous_state!: string | null;
  @ApiProperty({ type: String, nullable: true }) state!: string | null;
  @ApiProperty() attempt_number!: number;
  @ApiProperty({ type: String, nullable: true }) outcome!: string | null;
  @ApiProperty({ format: 'date-time' }) occurred_at!: string;
}
class AuditPage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ enum: ['live_committed_view'] }) pagination!: 'live_committed_view';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ type: [AuditEventView] }) items!: AuditEventView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

@ApiTags('local-audit')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'audit:read')
@Controller('v1/local/audit/events')
export class AuditController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  @Get()
  @ApiOperation({ summary: 'Read workspace synthetic outbox/sync service evidence; live pages are not a complete or stable audit export' })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Exclusive ascending audit_id, default0. IDs are allocation order, not commit order; restart from0 after writers settle for a complete bounded review.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'intent_ref', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'job_ref', required: false, type: String, format: 'uuid' })
  @ApiOkResponse({ type: AuditPage })
  @ApiResponse({ status: 400, description: 'INVALID_QUERY' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 503, description: 'AUDIT_UNAVAILABLE' })
  async events(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<AuditPage> {
    const after = query.after ?? '0'; const limit = query.limit ?? '25'; const intent = query.intent_ref ?? query.job_ref;
    if (query.intent_ref !== undefined && query.job_ref !== undefined) throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local audit query.' });
    if (Object.keys(query).some(key => !['after', 'limit', 'intent_ref', 'job_ref'].includes(key))
      || typeof after !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n
      || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100
      || (intent !== undefined && (typeof intent !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent)))) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local audit query.' });
    }
    try {
      // Fixed SQL variants retain the workspace+target index for filtered reviews.
      const parameters = intent === undefined ? [request.principal.workspace, after, Number(limit) + 1] : [request.principal.workspace, after, Number(limit) + 1, intent];
      const result = await this.database.pool.query(`SELECT audit_id,event_ref,schema_version,actor_role,actor_type,action,target_ref,correlation_id,
        target_type,capture_id,job_status,previous_job_status,previous_state,state,attempt_number,outcome,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
        FROM platform.audit_events WHERE workspace_key=$1 AND audit_id>$2::bigint ${intent === undefined ? '' : query.job_ref === undefined ? "AND target_ref=$4::uuid AND target_type='local_outbox_intent'" : "AND target_ref=$4::uuid AND target_type='local_sync_job'"}
        ORDER BY audit_id LIMIT $3`, parameters);
      const items = result.rows.slice(0, Number(limit)) as AuditEventView[];
      return { provenance: 'local_synthetic', execution_mode: 'test', pagination: 'live_committed_view', workspace_key: request.principal.workspace,
        items, next_cursor: result.rows.length > Number(limit) ? items.at(-1)!.audit_id : null };
    } catch { throw new ServiceUnavailableException({ code: 'AUDIT_UNAVAILABLE', message: 'Local audit evidence is unavailable.' }); }
  }
}
