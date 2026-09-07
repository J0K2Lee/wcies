import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { requestContextStorage } from '../../common/context/request-context';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { TestJobPayload } from '../../modules/dev/controllers/dev.controller';

/**
 * Consumes jobs from the `wcies.test` queue and emits a structured log line,
 * closing the API -> BullMQ -> Redis -> Worker chain (Sprint 0 task §16).
 * Processors only orchestrate: they must never contain business logic
 * (AGENTS.md §51).
 */
@Processor(QUEUE_NAMES.test)
export class TestProcessor extends WorkerHost {
  constructor(private readonly logger: AppLoggerService) {
    super();
  }

  async process(job: Job<TestJobPayload>): Promise<string> {
    return requestContextStorage.run(
      { requestId: `job:${job.id ?? 'unknown'}`, jobId: job.id ?? undefined },
      () => {
        this.logger.info('Test job processed', {
          module: 'worker',
          queue: QUEUE_NAMES.test,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          message: job.data.message,
        });
        return `processed: ${job.data.message}`;
      },
    );
  }
}
