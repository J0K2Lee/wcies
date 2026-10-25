import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PageMeta } from '@wcies/shared';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import {
  NotificationRepository,
  NotificationListFilters,
} from '../repositories/notification.repository';
import { FeishuProvider } from '../providers/feishu.provider';
import { NotificationType } from '../enums/notification.constants';
import {
  NotificationNotFoundError,
  NotificationRetryInvalidError,
} from '../errors/notification.errors';

export interface NotificationDto {
  id: string;
  type: string;
  channel: string;
  referenceType: string;
  referenceId: string;
  recipient: string | null;
  title: string;
  content: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  sentAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
}

interface PublishInput {
  title: string;
  content: string;
  recipient?: string | null;
}

/**
 * Notification module (Sprint 4 task §46-§51).
 *
 * Business modules never deliver anything themselves - they call the typed
 * notify* methods (the domain-event boundary). Delivery rules:
 *   SYSTEM  - the in-app fact; row is created already SENT (always works).
 *   FEISHU  - only when a webhook URL is configured: row PENDING + BullMQ
 *             job; the worker delivers and marks SENT/FAILED (retryable).
 * Notification failures are swallowed here (logged): they must never break
 * the business transaction that published the event (task §51).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: NotificationRepository,
    private readonly feishu: FeishuProvider,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.notification)
    private readonly notificationQueue: Queue,
  ) {}

  // --------------------------------------------------------------------------
  // Domain events (task §50)
  // --------------------------------------------------------------------------

  /**
   * ORDER_INTERCEPTION_REQUIRED: a PICKED line's ORDER was cancelled (task §50).
   *
   * 文案必须陈述事实（2026-10-25 用户反馈）：订单是被取消的那一方，**商品仍是
   * 「已拣货」**、并没有被取消。此前写「拣货商品已取消」，读起来像拣货被撤销，
   * 与订单行状态自相矛盾。
   */
  async notifyInterceptionRequired(input: {
    orderNo: string;
    orderItemId: string;
    interceptionId: string;
    interceptionNo: string;
    skuCode: string | null;
    warehouseCode: string | null;
    remainingQty: string;
  }): Promise<void> {
    const content = [
      `订单 ${input.orderNo} 已取消；该行商品已拣货完成（未出库，库存仍为「已拣货」），需要拦截找回实体商品。`,
      `拦截任务：${input.interceptionNo}`,
      `SKU：${input.skuCode ?? '未知'}`,
      `仓库：${input.warehouseCode ?? '未知'}`,
      `待找回数量：${input.remainingQty}`,
      `请到 仓库作业 → 拦截 处理该任务。`,
    ].join('\n');
    await this.publish('ORDER_INTERCEPTION_REQUIRED', 'ORDER_INTERCEPTION', input.interceptionId, {
      title: `需要拦截：订单 ${input.orderNo}（${input.interceptionNo}）`,
      content,
    });
  }

  /** ORDER_INTERCEPTION_FAILED: physical unit could not be found (task §42). */
  async notifyInterceptionFailed(input: {
    interceptionNo: string;
    interceptionId: string;
    orderNo: string;
    reason?: string;
  }): Promise<void> {
    const content = [
      `拦截任务 ${input.interceptionNo} 标记失败：未找到实体商品。`,
      `订单：${input.orderNo}`,
      input.reason === undefined || input.reason === '' ? null : `原因：${input.reason}`,
      `库存保持 Picked 状态，需人工跟进。`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    await this.publish('ORDER_INTERCEPTION_FAILED', 'ORDER_INTERCEPTION', input.interceptionId, {
      title: `拦截失败：${input.interceptionNo}`,
      content,
    });
  }

  // --------------------------------------------------------------------------
  // Reads + retry (task §55)
  // --------------------------------------------------------------------------

  async list(
    filters: NotificationListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: NotificationDto[]; meta: PageMeta }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getById(id: string): Promise<NotificationDto> {
    const row = await this.repository.findById(id);
    if (row === null) {
      throw new NotificationNotFoundError(id);
    }
    return this.toDto(row);
  }

  /** Re-enqueues a FAILED FEISHU delivery (SYSTEM rows cannot fail). */
  async retry(id: string): Promise<NotificationDto> {
    return this.dataSource.transaction(async (manager) => {
      const row = await this.repository.lockById(manager, id);
      if (row === null) {
        throw new NotificationNotFoundError(id);
      }
      if (row.channel !== 'FEISHU') {
        throw new NotificationRetryInvalidError('仅 FEISHU 通道的失败通知可以重试');
      }
      if (row.status !== 'FAILED') {
        throw new NotificationRetryInvalidError(`通知状态 ${row.status} 不允许重试`);
      }
      await this.repository.updateDelivery(manager, id, {
        status: 'PENDING',
        failedAt: null,
      });
      await this.enqueue(id);
      return this.toDto({ ...row, status: 'PENDING', failedAt: null });
    });
  }

  // --------------------------------------------------------------------------
  // Delivery (worker entrypoint)
  // --------------------------------------------------------------------------

  /**
   * Delivers one FEISHU notification. Called by the queue processor.
   * Increments attempt_count regardless of outcome and lands on SENT/FAILED.
   */
  async deliverFeishu(id: string): Promise<void> {
    const webhookUrl = this.feishuWebhookUrl();
    await this.dataSource.transaction(async (manager) => {
      const row = await this.repository.lockById(manager, id);
      if (row === null || row.status !== 'PENDING') {
        return;
      }
      if (webhookUrl === null) {
        await this.repository.updateDelivery(manager, id, {
          status: 'FAILED',
          attemptCount: row.attemptCount + 1,
          lastError: 'FEISHU_WEBHOOK_URL 未配置',
          failedAt: new Date(),
        });
        return;
      }
      try {
        await this.feishu.sendText(webhookUrl, { title: row.title, content: row.content });
      } catch (error: unknown) {
        await this.repository.updateDelivery(manager, id, {
          status: 'FAILED',
          attemptCount: row.attemptCount + 1,
          lastError: String(error).slice(0, 1000),
          failedAt: new Date(),
        });
        return;
      }
      await this.repository.updateDelivery(manager, id, {
        status: 'SENT',
        attemptCount: row.attemptCount + 1,
        sentAt: new Date(),
      });
    });
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * Publishes one domain event: always a SYSTEM row (created SENT), plus a
   * queued FEISHU row when a webhook is configured (task §49-§50). Best
   * effort by contract - failures are logged, never thrown (task §51).
   */
  private async publish(
    type: NotificationType,
    referenceType: string,
    referenceId: string,
    input: PublishInput,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.repository.insert(manager, {
          type,
          channel: 'SYSTEM',
          referenceType,
          referenceId,
          title: input.title,
          content: input.content,
          recipient: input.recipient ?? null,
          status: 'SENT',
          attemptCount: 1,
          sentAt: new Date(),
        });
      });
      if (this.feishuWebhookUrl() !== null) {
        const feishuRow = await this.dataSource.transaction(async (manager) =>
          this.repository.insert(manager, {
            type,
            channel: 'FEISHU',
            referenceType,
            referenceId,
            title: input.title,
            content: input.content,
            recipient: input.recipient ?? null,
            status: 'PENDING',
          }),
        );
        await this.enqueue(feishuRow.id);
      }
    } catch (error: unknown) {
      this.logger.error(
        `notification publish failed type=${type} reference=${referenceType}/${referenceId}: ${String(error)}`,
      );
    }
  }

  private feishuWebhookUrl(): string | null {
    return this.config.get<string | null>('app.feishuWebhookUrl', { infer: true }) ?? null;
  }

  private async enqueue(notificationId: string): Promise<void> {
    try {
      await this.notificationQueue.add(
        'deliver',
        { notificationId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      );
    } catch (error: unknown) {
      // The row stays PENDING; retry() can re-enqueue it later.
      this.logger.warn(`notification enqueue failed id=${notificationId}: ${String(error)}`);
    }
  }

  private toDto(row: {
    id: string;
    type: string;
    channel: string;
    referenceType: string;
    referenceId: string;
    recipient: string | null;
    title: string;
    content: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    sentAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      channel: String(row.channel),
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      recipient: row.recipient,
      title: row.title,
      content: row.content,
      status: row.status,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      sentAt: row.sentAt,
      failedAt: row.failedAt,
      createdAt: row.createdAt,
    };
  }
}
