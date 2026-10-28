import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Post, Param, Query, Req, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseDetectionFilters } from '@lmps/contracts/detection-health';
import { DetectionError, readDetectionHealth, type Database } from '@lmps/database';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';
import { DETECTION_RUNTIME, DetectionRuntime } from './detection-runtime.js';

const invalid = (): never => { throw new BadRequestException({ code: 'DETECTION_INVALID_QUERY', message: 'Invalid detection request.' }); };
@ApiTags('local-detection')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@Controller('v1/local/detection')
export class DetectionController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database, @Inject(DETECTION_RUNTIME) private readonly runtime: DetectionRuntime) {}
  @Get('health')
  @SetMetadata(LOCAL_SCOPE, ['transactions:read', 'risk:read', 'risk-jobs:read', 'policies:read'])
  @ApiOperation({ summary: 'Read bounded current-revision detection coverage, queue state and missing inputs without raw account context.' })
  async health(@Req() request: ScopedRequest, @Query() input: Record<string, unknown>) {
    let filters; try { filters = parseDetectionFilters(input); } catch { return invalid(); }
    try { return await readDetectionHealth(this.database.pool, request.principal.workspace, filters, this.runtime.snapshot()); }
    catch (error) {
      const code = error instanceof DetectionError ? error.code : 'DETECTION_UNAVAILABLE';
      throw new ServiceUnavailableException({ code, message: code === 'DETECTION_SCOPE_TOO_LARGE' ? 'Narrow the detection scope; no partial counts were returned.' : 'Detection evidence is unavailable.' });
    }
  }
  @Post('jobs/:id/retry')
  @SetMetadata(LOCAL_SCOPE, ['risk-jobs:read', 'risk-jobs:retry'])
  @ApiOperation({ summary: 'Make a recorded transient retry due now with optimistic concurrency; never reset attempts, change inputs or retry permanent/exhausted jobs.' })
  async retry(@Req() request: ScopedRequest, @Param('id') id: string, @Query() query: Record<string, unknown>, @Body() input: Record<string, unknown>) {
    if (Object.keys(query).length || !input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'attempt_number,updated_at'
      || !Number.isInteger(input.attempt_number) || typeof input.updated_at !== 'string') return invalid();
    if (!this.runtime.service) throw new ServiceUnavailableException({ code: 'DETECTION_NOT_CONFIGURED', message: 'Detection retry storage is not configured.' });
    try { return await this.runtime.service.retry(request.principal.workspace, id, input.attempt_number as number, input.updated_at); }
    catch (error) {
      if (error instanceof DetectionError && error.code === 'DETECTION_INVALID_QUERY') return invalid();
      if (error instanceof DetectionError && error.code === 'DETECTION_RETRY_CONFLICT') throw new ConflictException({ code: error.code, message: 'Job changed or is not eligible. Refresh its state.' });
      throw new ServiceUnavailableException({ code: 'DETECTION_UNAVAILABLE', message: 'Detection retry state is unavailable. Refresh before trying again.' });
    }
  }
}
