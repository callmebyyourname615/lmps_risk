import { Controller, Get, Inject, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { FEATURE_READS, FeatureServingService } from './feature-serving.service.js';
@ApiTags('local-synthetic-features')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE, 'risk:read')
@Controller('v1/local/features')
export class FeaturesController {
  constructor(@Inject(FEATURE_READS) private readonly features: FeatureServingService) {}
  @Get()
  read(@Req() request: ScopedRequest, @Query() query: Record<string, unknown>) {
    // Fastify query objects have a framework prototype; retain every own field for strict validation.
    return this.features.read(request.principal, { ...query });
  }
}
