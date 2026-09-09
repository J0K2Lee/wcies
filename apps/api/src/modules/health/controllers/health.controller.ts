import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { ServiceUnavailableError } from '../../../common/errors/common-errors';
import { Public } from '../../auth/decorators/public.decorator';
import { HealthService } from '../services/health.service';

export class LivenessData {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';
}

export class ReadinessChecksDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  postgres!: string;

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  redis!: string;
}

export class ReadinessData {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';
  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
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
  @ApiOkEnvelope(LivenessData)
  getLiveAlias(): { success: true; data: LivenessData } {
    return ok<LivenessData>({ status: 'ok' });
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - API process only' })
  @ApiOkEnvelope(LivenessData)
  getLive(): { success: true; data: LivenessData } {
    return ok<LivenessData>({ status: 'ok' });
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - checks PostgreSQL and Redis' })
  @ApiOkEnvelope(ReadinessData)
  async getReady(): Promise<{ success: true; data: ReadinessData }> {
    const result = await this.healthService.checkReadiness();
    if (!result.allUp) {
      throw new ServiceUnavailableError('One or more dependencies are not ready', {
        checks: result.checks,
      });
    }
    return ok<ReadinessData>({ status: 'ok', checks: result.checks });
  }
}
