import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ServiceUnavailableError } from '../../../common/errors/common-errors';
import { Public } from '../../auth/decorators/public.decorator';
import { HealthService } from '../services/health.service';

export class LivenessData {
  status!: 'ok';
}

export class LivenessResponseDto {
  success!: true;
  data!: LivenessData;
}

export class ReadinessChecksDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  postgres!: string;

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  redis!: string;
}

export class ReadinessData {
  status!: 'ok';
  checks!: ReadinessChecksDto;
}

export class ReadinessResponseDto {
  success!: true;
  data!: ReadinessData;
}

/**
 * Health endpoints are mounted WITHOUT the /api/v1 prefix so they work as
 * plain infrastructure probes (see exclude list in main.ts).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe (alias of /health/live)' })
  @ApiOkResponse({ type: LivenessResponseDto })
  getLiveAlias(): LivenessResponseDto {
    return ok<LivenessData>({ status: 'ok' });
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - API process only' })
  @ApiOkResponse({ type: LivenessResponseDto })
  getLive(): LivenessResponseDto {
    return ok<LivenessData>({ status: 'ok' });
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - checks PostgreSQL and Redis' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  async getReady(): Promise<ReadinessResponseDto> {
    const result = await this.healthService.checkReadiness();
    if (!result.allUp) {
      throw new ServiceUnavailableError('One or more dependencies are not ready', {
        checks: result.checks,
      });
    }
    return ok<ReadinessData>({ status: 'ok', checks: result.checks });
  }
}
