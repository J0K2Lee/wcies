import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { SKU_EXPORT_JOB } from '../services/sku-export-queue.service';
import {
  SkuExportJobData,
  SkuExportResult,
  SkuExportService,
} from '../services/sku-export.service';

/**
 * 导出队列 processor（2026-11-04）。
 *
 * 只做 Job → Service（AGENTS §51）：不在这里拼 SQL、不判断业务规则。
 * 失败让异常冒出去，由 BullMQ 记为 failed，前端从 job.failedReason 读到原因。
 */
@Injectable()
@Processor(QUEUE_NAMES.export)
export class SkuExportProcessor extends WorkerHost {
  constructor(
    private readonly skuExportService: SkuExportService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<SkuExportJobData>): Promise<SkuExportResult> {
    if (job.name !== SKU_EXPORT_JOB) {
      throw new Error(`Unsupported export job: ${job.name}`);
    }
    const startedAt = Date.now();
    const result = await this.skuExportService.buildExport(job.data, async (percent) => {
      await job.updateProgress(percent);
    });
    this.logger.log(
      `sku export job=${String(job.id)} rows=${result.rowCount} columns=${job.data.columns.length} tookMs=${
        Date.now() - startedAt
      }`,
      'SkuExportProcessor',
    );
    return result;
  }
}
