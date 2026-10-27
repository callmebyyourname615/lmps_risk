import { BadRequestException, Controller, Get, Header, Inject, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

class SourceEventView {
  @ApiProperty({ type: String, pattern: '^[1-9][0-9]*$' }) event_id!: string;
  @ApiProperty({ format: 'uuid' }) record_ref!: string;
  @ApiProperty({ enum: ['transfer', 'transfer_hist', 'transfer_old', 'member'] }) source_table!: string;
  @ApiProperty() source_generation!: string;
  @ApiProperty() event_key!: string;
  @ApiProperty({ enum: ['snapshot', 'insert', 'update', 'delete'] }) operation!: string;
  @ApiProperty({ enum: [1] }) schema_version!: number;
  @ApiProperty({ format: 'date-time' }) observed_at!: string;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: { type: 'string', nullable: true }, description: 'Approved synthetic source fields only; amounts are decimal strings, raw codes remain uninterpreted.' }) fields!: Record<string, string | null> | null;
}
class SourcePage {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty({ format: 'uuid' }) capture_id!: string;
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ type: [SourceEventView] }) items!: SourceEventView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

@ApiTags('local-source')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'source:read')
@Controller('v1/local/source')
export class SourceController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  @Get('captures/:capture_id/events')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read synthetic source evidence in the authenticated workspace; not a payment/score API' })
  @ApiParam({ name: 'capture_id', format: 'uuid' })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Exclusive ascending event_id cursor, default0' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: SourcePage })
  @ApiResponse({ status: 400, description: 'INVALID_QUERY' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 503, description: 'SOURCE_UNAVAILABLE' })
  async events(@Req() request: ScopedRequest, @Param('capture_id') capture: string, @Query() query: Record<string, unknown>): Promise<SourcePage> {
    const after = query.after ?? '0'; const limit = query.limit ?? '25';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(capture)
      || Object.keys(query).some(key => !['after', 'limit'].includes(key))
      || typeof after !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n
      || typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local source query.' });
    try {
      const result = await this.database.pool.query(`SELECT e.event_id, r.record_ref, r.source_table, e.source_generation, e.event_key, e.operation, e.schema_version,
        to_char(e.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at, e.fields
        FROM platform.source_events e JOIN platform.source_records r
          ON (r.workspace_key,r.source_namespace,r.source_generation,r.record_id)=(e.workspace_key,e.source_namespace,e.source_generation,e.record_id)
        WHERE e.workspace_key=$1 AND e.source_namespace='synthetic_snapshot' AND e.capture_epoch=$2 AND e.event_id>$3::bigint
        ORDER BY e.event_id LIMIT $4`, [request.principal.workspace, capture, after, Number(limit) + 1]);
      const items = result.rows.slice(0, Number(limit)) as SourceEventView[];
      return { provenance: 'local_synthetic', execution_mode: 'test', capture_id: capture, workspace_key: request.principal.workspace,
        items, next_cursor: result.rows.length > Number(limit) ? items.at(-1)!.event_id : null };
    } catch { throw new ServiceUnavailableException({ code: 'SOURCE_UNAVAILABLE', message: 'Local source evidence is unavailable.' }); }
  }
}
