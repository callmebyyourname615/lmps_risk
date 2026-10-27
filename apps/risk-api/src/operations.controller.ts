import { BadRequestException, Controller, Get, Inject, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

class PoolView {
  @ApiProperty() total!: number;
  @ApiProperty() idle!: number;
  @ApiProperty() waiting!: number;
  @ApiProperty() limit!: number;
}
class OutboxCounts {
  @ApiProperty() pending!: number;
  @ApiProperty() leased!: number;
  @ApiProperty() accepted!: number;
  @ApiProperty() expired!: number;
  @ApiProperty() dead!: number;
}
class OperationsView {
  @ApiProperty({ enum: ['local_synthetic'] }) provenance!: 'local_synthetic';
  @ApiProperty({ enum: ['test'] }) execution_mode!: 'test';
  @ApiProperty() workspace_key!: string;
  @ApiProperty({ enum: ['available', 'unavailable', 'limit_exceeded'] }) status!: 'available' | 'unavailable' | 'limit_exceeded';
  @ApiProperty({ type: PoolView }) pool!: PoolView;
  @ApiProperty({ type: OutboxCounts, nullable: true }) outbox!: OutboxCounts | null;
}

@ApiTags('local-operations')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'operations:read')
@Controller('v1/local/operations')
export class OperationsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database) {}
  @Get()
  @ApiOperation({ summary: 'Current process pool and bounded workspace fake-outbox counts; not production readiness' })
  @ApiOkResponse({ type: OperationsView })
  @ApiResponse({ status: 400, description: 'INVALID_QUERY' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async status(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>): Promise<OperationsView> {
    if (Object.keys(query).length) throw new BadRequestException({ code: 'INVALID_QUERY', message: 'Invalid local operations query.' });
    const response: OperationsView = { provenance: 'local_synthetic', execution_mode: 'test', workspace_key: request.principal.workspace,
      status: 'unavailable', pool: { total: 0, idle: 0, waiting: 0, limit: this.database.pool.options.max ?? 4 }, outbox: null };
    try {
      const row = (await this.database.pool.query(`WITH bounded AS (
        SELECT state FROM platform.local_outbox_intents WHERE workspace_key=$1 LIMIT 1001
      ) SELECT count(*)::int AS total, count(*) FILTER (WHERE state='pending')::int AS pending,
        count(*) FILTER (WHERE state='leased')::int AS leased, count(*) FILTER (WHERE state='accepted')::int AS accepted,
        count(*) FILTER (WHERE state='expired')::int AS expired, count(*) FILTER (WHERE state='dead')::int AS dead FROM bounded`, [request.principal.workspace])).rows[0];
      response.status = row.total > 1000 ? 'limit_exceeded' : 'available';
      if (response.status === 'available') response.outbox = { pending: row.pending, leased: row.leased, accepted: row.accepted, expired: row.expired, dead: row.dead };
    } catch { /* Unknown counts stay null during database failure. */ }
    response.pool.total = this.database.pool.totalCount; response.pool.idle = this.database.pool.idleCount; response.pool.waiting = this.database.pool.waitingCount;
    return response;
  }
}
