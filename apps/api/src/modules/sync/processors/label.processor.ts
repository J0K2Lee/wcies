import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { OrderPlatformShipService } from '../services/order-platform-ship.service';
import { ShippingLabelPurgeService } from '../services/shipping-label-purge.service';
import { LABEL_JOB, LabelPrefetchJobPayload } from '../services/label-prefetch.service';

const SYSTEM_OPERATOR: OperatorContext = { userId: null, username: 'system' };

/**
 * 面单后台任务（用户指示 2026-10-21）：预取归档 + 终态清理扫描。
 *
 * Processor 只做分发与结果判读，业务全部在 service 里（AGENTS §51）。
 * 预取失败不写异常中心、不阻塞任何用户操作——它只是把「打印时的等待」
 * 提前到后台完成。
 */
@Processor(QUEUE_NAMES.label)
export class LabelProcessor extends WorkerHost {
  constructor(
    private readonly platformShip: OrderPlatformShipService,
    private readonly purgeService: ShippingLabelPurgeService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<LabelPrefetchJobPayload>): Promise<string> {
    if (job.name === LABEL_JOB.purgeSweep) {
      const result = await this.purgeService.sweep();
      return `purged=${result.purged} failed=${result.failed}`;
    }
    if (job.name !== LABEL_JOB.prefetch) {
      this.logger.warn(`unknown label job: ${job.name}`, 'LabelProcessor');
      return 'skipped';
    }

    const orderIds = job.data.orderIds ?? [];
    if (orderIds.length === 0) {
      return 'empty';
    }

    const { items } = await this.platformShip.ensureLabelsArchived(orderIds, SYSTEM_OPERATOR, {
      refresh: false,
    });
    const archived = items.filter((item) => item.ok && !item.fromArchive).length;
    const reused = items.filter((item) => item.ok && item.fromArchive).length;
    const notReady = items.filter((item) => item.code === 'PLATFORM_LABEL_NOT_READY');
    const blocked = items.filter((item) => item.code === 'ORDER_LABEL_NOT_PRINTABLE');
    const failed = items.filter(
      (item) =>
        !item.ok &&
        item.code !== 'PLATFORM_LABEL_NOT_READY' &&
        item.code !== 'ORDER_LABEL_NOT_PRINTABLE',
    );

    this.logger.log(
      `label prefetch job=${job.id ?? 'n/a'} attempt=${job.attemptsMade + 1} archived=${archived} reused=${reused} notReady=${notReady.length} blocked=${blocked.length} failed=${failed.length}`,
      'LabelProcessor',
    );

    if (notReady.length > 0) {
      // 组包确认是异步的：交给 BullMQ 按 backoff 重试，重试时已归档的单会被跳过。
      throw new Error(`platform label not ready for ${notReady.length}/${items.length} order(s)`);
    }
    if (failed.length > 0) {
      // 只记日志：用户点「打单」时仍会看到真实错误。
      this.logger.warn(
        `label prefetch finished with ${failed.length} failure(s): ${failed
          .map((item) => `${item.orderNo ?? item.orderId}:${item.code ?? 'UNKNOWN'}`)
          .join(', ')}`,
        'LabelProcessor',
      );
    }
    return `archived=${archived} reused=${reused}`;
  }
}
