import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { requestContextStorage } from '../../../common/context/request-context';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import {
  SkuImageImportJobPayload,
  SkuImageImportService,
} from '../services/sku-image-import.service';

/**
 * Consumes wcies.media image-import jobs (Sprint 8.5 T6). Orchestration
 * only (AGENTS.md §51): claim the payload, delegate to the service. A
 * thrown error keeps the job visible for BullMQ's retry/backoff.
 */
@Processor(QUEUE_NAMES.media)
export class SkuImageImportProcessor extends WorkerHost {
  constructor(
    private readonly importService: SkuImageImportService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<SkuImageImportJobPayload>): Promise<string> {
    return requestContextStorage.run({ requestId: `sku-image-${job.id}` }, async () => {
      try {
        const status = await this.importService.process(job.data);
        return status;
      } catch (error: unknown) {
        this.logger.warn('sku image import attempt failed (will retry)', {
          module: 'product',
          skuId: job.data.skuId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }
}
