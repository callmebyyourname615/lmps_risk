import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PostgresService } from './postgres.service.js';

class LivenessResponse {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ enum: ['risk-api'] })
  service!: 'risk-api';
}

class BootstrapDependencies {
  @ApiProperty({ enum: ['not_configured', 'available', 'unavailable'] })
  postgres!: 'not_configured' | 'available' | 'unavailable';

  @ApiProperty({ enum: ['not_implemented'] })
  source_sync!: 'not_implemented';

  @ApiProperty({ enum: ['not_implemented'] })
  risk_engine!: 'not_implemented';
}

class ReadinessResponse {
  @ApiProperty({ enum: ['not_ready'] })
  status!: 'not_ready';

  @ApiProperty({ enum: ['risk-api'] })
  service!: 'risk-api';

  @ApiProperty({ enum: ['bootstrap_only'] })
  reason!: 'bootstrap_only';

  @ApiProperty({ type: BootstrapDependencies })
  dependencies!: BootstrapDependencies;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly postgres: PostgresService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Process liveness; does not indicate payment readiness' })
  @ApiOkResponse({ type: LivenessResponse })
  live(): LivenessResponse {
    return { status: 'ok', service: 'risk-api' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Unavailable until real dependencies and risk workflows exist' })
  @ApiResponse({ status: 503, type: ReadinessResponse })
  async ready(): Promise<never> {
    const response: ReadinessResponse = {
      status: 'not_ready',
      service: 'risk-api',
      reason: 'bootstrap_only',
      dependencies: {
        postgres: await this.postgres.status(),
        source_sync: 'not_implemented',
        risk_engine: 'not_implemented',
      },
    };
    throw new ServiceUnavailableException(response);
  }
}
