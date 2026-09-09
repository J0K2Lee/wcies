import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';

export class CreateTestJobDto {
  @ApiPropertyOptional({ example: 'hello', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export interface TestJobPayload {
  message: string;
}

export class TestJobResultDto {
  @ApiProperty({ example: '42' })
  jobId!: string;

  @ApiProperty({ example: 'wcies.test' })
  queue!: string;
}

/**
 * Development-only helper endpoints. The whole DevModule is not registered
 * in production, so these routes return 404 there (Sprint 0 task §17).
 */
@ApiTags('dev')
@Controller('dev')
export class DevController {
  constructor(@InjectQueue(QUEUE_NAMES.test) private readonly testQueue: Queue<TestJobPayload>) {}

  @Post('test-job')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[DEV ONLY] Enqueue a test job into wcies.test queue' })
  @ApiOkEnvelope(TestJobResultDto)
  async createTestJob(
    @Body() dto: CreateTestJobDto,
  ): Promise<{ success: true; data: TestJobResultDto }> {
    const job = await this.testQueue.add(
      'test',
      { message: dto.message ?? 'hello' },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    return ok({ jobId: job.id ?? 'unknown', queue: QUEUE_NAMES.test });
  }
}
