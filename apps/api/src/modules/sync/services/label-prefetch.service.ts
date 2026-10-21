import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/** Job names on the `wcies.label` queue. */
export const LABEL_JOB = {
  /** 组包成功后预取归档（单笔或 ≤20 单一批）。 */
  prefetch: 'PREFETCH_LABELS',
  /** 终态面单清理扫描（repeatable）。 */
  purgeSweep: 'PURGE_SWEEP',
} as const;

export interface LabelPrefetchJobPayload {
  orderIds: string[];
}

interface LabelSettings {
  prefetchEnabled: boolean;
  prefetchDelayMs: number;
  prefetchMaxAttempts: number;
  prefetchFromSync: boolean;
  batchFetchChunk: number;
}

/**
 * 面单预取入队（用户指示 2026-10-21，A 方案）。
 *
 * 只负责把工作交给 BullMQ —— 绝不在这里调用平台，也绝不阻塞调用方
 * （组包接口）。入队失败只记日志：预取是性能优化，用户随时可以点「打单」
 * 走按需路径。
 *
 * 批量组包按 ≤20 单一块入队，而不是逐单入队——否则 50 单组包会变成 50 次
 * 平台面单调用，批量取单（B）就失去意义。
 */
@Injectable()
export class LabelPrefetchService {
  constructor(
    @InjectQueue(QUEUE_NAMES.label) private readonly queue: Queue,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  private get settings(): LabelSettings {
    return this.config.getOrThrow<LabelSettings>('app.label');
  }

  isEnabled(): boolean {
    return this.settings.prefetchEnabled;
  }

  /** 组包后到面单可取的等待时间（OZON 文档建议 45–60 秒）。 */
  delayMs(): number {
    return this.settings.prefetchDelayMs;
  }

  /** 同步/Webhook 观察到运单号首次出现时的补触发（可关闭）。 */
  private syncTriggerEnabled(): boolean {
    return this.settings.prefetchEnabled && this.settings.prefetchFromSync;
  }

  async enqueueForOrder(orderId: string, options: { delayMs?: number } = {}): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    await this.addJob(
      [orderId],
      options.delayMs ?? this.delayMs(),
      `label-prefetch-${orderId}`,
      'order',
    );
  }

  /**
   * 同步观察触发的补预取：只在 `LABEL_PREFETCH_FROM_SYNC` 打开时入队，
   * 用于覆盖「组包异步确认但预取重试已耗尽」的漏网单。
   */
  async enqueueFromSync(orderId: string): Promise<void> {
    if (!this.syncTriggerEnabled()) {
      return;
    }
    await this.addJob([orderId], 0, `label-prefetch-${orderId}`, 'order');
  }

  async enqueueBatch(
    orderIds: readonly string[],
    options: { delayMs?: number } = {},
  ): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const unique = [...new Set(orderIds)];
    if (unique.length === 0) {
      return;
    }
    const chunkSize = Math.max(1, this.settings.batchFetchChunk);
    for (let index = 0; index < unique.length; index += chunkSize) {
      const chunk = unique.slice(index, index + chunkSize);
      await this.addJob(
        chunk,
        options.delayMs ?? this.delayMs(),
        `label-prefetch-batch-${hashOf(chunk)}`,
        'batch',
      );
    }
  }

  private async addJob(
    orderIds: readonly string[],
    delayMs: number,
    jobId: string,
    kind: 'order' | 'batch',
  ): Promise<void> {
    try {
      await this.queue.add(
        LABEL_JOB.prefetch,
        { orderIds: [...orderIds] } satisfies LabelPrefetchJobPayload,
        {
          delay: Math.max(0, delayMs),
          attempts: Math.max(1, this.settings.prefetchMaxAttempts),
          // 未就绪时按指数退避重试：60s → 120s → 240s …（OZON 组包确认异步）。
          backoff: { type: 'exponential', delay: Math.max(1_000, this.delayMs()) },
          // BullMQ 自定义 jobId 不能包含 ':'。
          jobId,
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 1000 },
        },
      );
      this.logger.log(
        `label prefetch enqueued kind=${kind} orders=${orderIds.length} delayMs=${delayMs}`,
        'LabelPrefetchService',
      );
    } catch (error: unknown) {
      // 预取失败绝不影响组包结果（用户随时可点「打单」按需取）。
      this.logger.warn(
        `label prefetch enqueue failed kind=${kind} orders=${orderIds.length}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'LabelPrefetchService',
      );
    }
  }
}

function hashOf(orderIds: readonly string[]): string {
  return createHash('sha1')
    .update([...orderIds].sort().join(','))
    .digest('hex')
    .slice(0, 16);
}
