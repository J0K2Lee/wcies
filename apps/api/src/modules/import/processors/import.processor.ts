import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { requestContextStorage } from '../../../common/context/request-context';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ImportExecutorService } from '../services/import-executor.service';

export interface ImportJobPayload {
  importJobId: string;
  operatorId: string | null;
  operatorName: string;
}

/**
 * Consumes confirmed import jobs (AGENTS.md §50: Excel Import is a queue
 * task). The processor only orchestrates - row business logic lives in the
 * executor + handlers (AGENTS.md §51).
 */
@Processor(QUEUE_NAMES.import)
export class ImportProcessor extends WorkerHost {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly executor: ImportExecutorService,
  ) {
    super();
  }

  async process(job: Job<ImportJobPayload>): Promise<string> {
    return requestContextStorage.run(
      { requestId: `job:${job.id ?? 'unknown'}`, jobId: job.id ?? undefined },
      async () => {
        const operator: OperatorContext = {
          userId: job.data.operatorId,
          username: job.data.operatorName,
        };
        await this.executor.execute(job.data.importJobId, operator);
        this.logger.info('Import job processed', {
          module: 'worker',
          queue: QUEUE_NAMES.import,
          importJobId: job.data.importJobId,
        });
        return `imported: ${job.data.importJobId}`;
      },
    );
  }
}
