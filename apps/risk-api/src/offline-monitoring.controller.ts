import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query, Req,
  ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DATASET_UUID } from '@lmps/contracts/offline-dataset';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { OFFLINE_MONITORING, OfflineMonitoringError, OfflineMonitoringService } from './offline-monitoring.js';

@ApiTags('offline-monitoring')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, ['source:read', 'transactions:read', 'risk:read'])
@Controller('v1/local/monitoring/offline/datasets')
export class OfflineMonitoringController {
  constructor(@Inject(OFFLINE_MONITORING) private readonly service: OfflineMonitoringService) {}
  private noQuery(input: Record<string, unknown>) {
    if (Object.keys(input).length) throw new BadRequestException({ code: 'OFFLINE_MONITORING_INVALID_QUERY' });
  }
  @Get()
  @ApiOperation({ summary: 'List explicitly granted offline CSV batches for this local principal; no source connection or tenant inference.' })
  list(@Req() request: ScopedRequest, @Query() input: Record<string, unknown>) {
    this.noQuery(input); return this.service.list(request.principal);
  }
  @Get(':batch/trends')
  @ApiOperation({ summary: 'Verify a granted staging batch and compare raw amounts with simulation thresholds; no Risk Assessment or Alert.' })
  async trends(@Req() request: ScopedRequest, @Param('batch') batch: string, @Query() input: Record<string, unknown>) {
    this.noQuery(input);
    if (!DATASET_UUID.test(batch)) throw new BadRequestException({ code: 'OFFLINE_MONITORING_INVALID_QUERY' });
    try { return await this.service.read(request.principal, batch); }
    catch (error) {
      if (error instanceof OfflineMonitoringError && error.code === 'OFFLINE_MONITORING_NOT_FOUND')
        throw new NotFoundException({ code: error.code });
      throw new ServiceUnavailableException({ code: 'OFFLINE_MONITORING_UNAVAILABLE' });
    }
  }
  @Get(':batch/monitoring')
  @ApiOperation({ summary: 'Read the same verified source snapshot for Intake monitoring pages; preserves unassessed risk and unresolved identity.' })
  monitoring(@Req() request: ScopedRequest, @Param('batch') batch: string, @Query() input: Record<string, unknown>) {
    return this.trends(request, batch, input);
  }
}
