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
import {
  NotificationInvalidInputError,
  NotificationNotFoundError,
} from '../errors/notification.errors';
import {
  NotificationEventData,
  buildFeishuCard,
  conditionsMatch,
  eventDefinition,
} from '../events/notification-events';

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
  /**
   * 关联订单的**当前** ERP 状态（2026-10-26 用户要求：通知状态与订单状态分成两列）。
   * 仅 ORDER / ORDER_INTERCEPTION 类型的通知有值；其它类型为 null。
   */
  orderStatus: string | null;
  /** 拦截类通知的「实物现在在哪」；其它类型为 null。 */
  goods: {
    interceptionStatus: string;
    pickBinCodes: string[];
    targetBinCode: string | null;
    packageNos: string[];
  } | null;
  /** 当前用户是否已读（2026-10-26）。 */
  isRead: boolean;
  /** 当前用户自己最近一次推送的状态（未订阅为 null）。 */
  deliveryStatus: string | null;
}

/** 派生上下文：关联订单状态 + 拦截货物的位置（均不落库）。 */
interface NotificationReferenceContext {
  orderStatus: string | null;
  goods: NotificationDto['goods'];
}

/**
 * 通知模块（Sprint 4 §46-§55；2026-10-26 订阅化改造）。
 *
 * 三层职责：
 * 1. **事件**：`notifyXxx()` 由业务模块调用，写一条站内事件（全局可见，不受订阅影响）；
 * 2. **订阅**：按事件类型 + 条件解析出「谁、走哪条通道」，fan-out 成投递行；
 * 3. **投递**：飞书私聊 / 群卡片经 BullMQ 异步发送，状态落在投递行上，可重试。
 *
 * 默认**没有任何订阅**（用户指示：全不订阅）——只有显式订阅才会推送。
 * 通知失败绝不影响发布方的业务事务（AGENTS §51）。
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
  // 领域事件（发布方 API）
  // --------------------------------------------------------------------------

  async notifyInterceptionRequired(input: {
    orderNo: string;
    orderItemId: string;
    interceptionId: string;
    interceptionNo: string;
    skuCode: string | null;
    warehouseCode: string | null;
    remainingQty: string;
    storeId?: string | null;
  }): Promise<void> {
    await this.publishEvent({
      type: 'ORDER_INTERCEPTION_REQUIRED',
      title: `需要拦截：订单 ${input.orderNo}（${input.interceptionNo}）`,
      level: 'WARN',
      factors: compactFactors({
        storeId: input.storeId ?? null,
        warehouseCode: input.warehouseCode,
        skuCode: input.skuCode,
        interceptionNo: input.interceptionNo,
        orderNo: input.orderNo,
      }),
      lines: [
        `订单 ${input.orderNo} 已取消；该行商品已拣货完成（未出库，库存仍为「已拣货」），需要拦截找回实体商品。`,
        `拦截任务：${input.interceptionNo}`,
        `SKU：${input.skuCode ?? '未知'}`,
        `仓库：${input.warehouseCode ?? '未知'}`,
        `待找回数量：${input.remainingQty}`,
      ],
      linkPath: eventDefinition('ORDER_INTERCEPTION_REQUIRED').linkPath,
      dedupeKey: `interception:${input.interceptionId}`,
      referenceType: 'ORDER_INTERCEPTION',
      referenceId: input.interceptionId,
    });
  }

  async notifyInterceptionFailed(input: {
    interceptionNo: string;
    interceptionId: string;
    orderNo: string;
    reason?: string;
    storeId?: string | null;
    warehouseCode?: string | null;
  }): Promise<void> {
    await this.publishEvent({
      type: 'ORDER_INTERCEPTION_FAILED',
      title: `拦截失败：${input.interceptionNo}`,
      level: 'HIGH',
      factors: compactFactors({
        storeId: input.storeId ?? null,
        warehouseCode: input.warehouseCode ?? null,
        interceptionNo: input.interceptionNo,
        orderNo: input.orderNo,
      }),
      lines: [
        `拦截任务 ${input.interceptionNo} 标记失败：未找到实体商品。`,
        `订单：${input.orderNo}`,
        ...(input.reason === undefined || input.reason === '' ? [] : [`原因：${input.reason}`]),
        '库存保持 Picked 状态，需人工跟进。',
      ],
      linkPath: eventDefinition('ORDER_INTERCEPTION_FAILED').linkPath,
      dedupeKey: `interception:${input.interceptionId}:failed`,
      referenceType: 'ORDER_INTERCEPTION',
      referenceId: input.interceptionId,
    });
  }

  /**
   * API Key 到期提醒（2026-10-26 用户需求）：到期前 7 天起每天一条，过期后按
   * 已过期事件继续提醒（直到换绑新 Key）。dedupeKey 带日期，保证「每天一次」。
   */
  async notifyCredentialExpiry(input: {
    credentialId: string;
    storeId: string;
    storeCode: string;
    platform: string;
    credentialType: string;
    expiresAt: Date;
    daysLeft: number;
  }): Promise<void> {
    const expired = input.daysLeft <= 0;
    const expiresOn = input.expiresAt.toISOString().slice(0, 10);
    const daysText =
      input.daysLeft > 0 ? `还有 ${input.daysLeft} 天到期` : `已于 ${expiresOn} 过期`;
    await this.publishEvent({
      type: expired ? 'STORE_CREDENTIAL_EXPIRED' : 'STORE_CREDENTIAL_EXPIRING',
      title: expired
        ? `API Key 已过期：${input.storeCode}（${input.credentialType}）`
        : `API Key 即将到期：${input.storeCode}（${input.credentialType}，${input.daysLeft} 天）`,
      level: expired ? 'HIGH' : 'WARN',
      factors: compactFactors({
        storeId: input.storeId,
        platform: input.platform,
        credentialType: input.credentialType,
        storeCode: input.storeCode,
      }),
      lines: [
        `店铺：${input.storeCode}`,
        `平台：${input.platform}`,
        `凭证类型：${input.credentialType}`,
        `到期时间：${expiresOn}（${daysText}）`,
        '请尽快在「店铺管理 → 凭证」中换绑新的 API Key，并重新声明有效期。',
      ],
      linkPath: eventDefinition('STORE_CREDENTIAL_EXPIRING').linkPath,
      dedupeKey: `credential:${input.credentialId}:${new Date().toISOString().slice(0, 10)}`,
      referenceType: 'PLATFORM_CREDENTIAL',
      referenceId: input.credentialId,
    });
  }

  /**
   * 写事件 + 解析订阅 + 生成投递。同一 (type, dedupeKey) 在 30 分钟内只记一条，
   * 避免同一拦截任务反复失败时刷屏。
   */
  private async publishEvent(data: NotificationEventData): Promise<void> {
    try {
      if (data.dedupeKey !== null) {
        const recent = await this.repository.findRecentByDedupe(data.type, data.dedupeKey, 30);
        if (recent !== null) {
          this.logger.debug(`notification deduped type=${data.type} key=${data.dedupeKey}`);
          return;
        }
      }
      const content = data.lines.join('\n');
      const event = await this.dataSource.transaction(async (manager) =>
        this.repository.insert(manager, {
          type: data.type,
          channel: 'SYSTEM',
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          title: data.title,
          content,
          status: 'SENT',
          attemptCount: 1,
          sentAt: new Date(),
          dedupeKey: data.dedupeKey,
        }),
      );
      await this.fanOut(event.id, data);
    } catch (error: unknown) {
      this.logger.error(
        `notification publish failed type=${data.type} reference=${data.referenceType}/${data.referenceId}: ${String(error)}`,
      );
    }
  }

  /** 订阅解析：满足条件的规则 → 投递行（一人一通道一行；群通道每条事件只发一次）。 */
  private async fanOut(notificationId: string, data: NotificationEventData): Promise<void> {
    const subscriptions = await this.repository.listEnabledSubscriptions(data.type);
    if (subscriptions.length === 0) {
      return;
    }
    const rows: Array<{
      notificationId: string;
      userId: string | null;
      channel: string;
      ruleId: string | null;
    }> = [];
    const seen = new Set<string>();
    for (const rule of subscriptions) {
      if (!conditionsMatch(rule.conditions, data)) {
        continue;
      }
      if (rule.channel === 'FEISHU_DM') {
        const binding = await this.repository.findBinding(rule.userId, 'FEISHU_DM');
        if (binding === null || !binding.enabled) {
          this.logger.warn(
            `subscription skipped: user ${rule.userId} has no FEISHU_DM binding (rule ${rule.id})`,
          );
          continue;
        }
        const key = `FEISHU_DM:${rule.userId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        rows.push({ notificationId, userId: rule.userId, channel: 'FEISHU_DM', ruleId: rule.id });
      } else if (rule.channel === 'FEISHU_GROUP') {
        if (this.feishuWebhookUrl() === null) {
          continue;
        }
        if (seen.has('FEISHU_GROUP')) {
          continue;
        }
        seen.add('FEISHU_GROUP');
        rows.push({ notificationId, userId: null, channel: 'FEISHU_GROUP', ruleId: rule.id });
      }
    }
    if (rows.length === 0) {
      return;
    }
    const deliveries = await this.dataSource.transaction(async (manager) =>
      this.repository.insertDeliveries(manager, rows),
    );
    for (const delivery of deliveries) {
      await this.enqueueDelivery(delivery.id);
    }
  }

  // --------------------------------------------------------------------------
  // 投递（worker 入口）
  // --------------------------------------------------------------------------

  /** 投递一条推送；失败只落 FAILED，不抛出（由重试接口再入队）。 */
  async deliver(deliveryId: string): Promise<void> {
    const delivery = await this.repository.findDelivery(deliveryId);
    if (delivery === null || delivery.status === 'SENT') {
      return;
    }
    const event = await this.repository.findById(delivery.notificationId);
    if (event === null) {
      await this.markDelivery(deliveryId, {
        status: 'FAILED',
        attemptCount: delivery.attemptCount + 1,
        lastError: 'notification event missing',
        failedAt: new Date(),
      });
      return;
    }
    const data = this.toEventData(
      event.type,
      event.title,
      event.content,
      event.referenceType,
      event.referenceId,
    );
    const card = buildFeishuCard(data, { webBaseUrl: this.webBaseUrl() });
    try {
      if (delivery.channel === 'FEISHU_DM') {
        const binding =
          delivery.userId === null
            ? null
            : await this.repository.findBinding(delivery.userId, 'FEISHU_DM');
        if (binding === null || !binding.enabled) {
          throw new Error('FEISHU_DM binding missing');
        }
        await this.feishu.sendCardToOpenId(binding.address, card);
      } else if (delivery.channel === 'FEISHU_GROUP') {
        const webhook = this.feishuWebhookUrl();
        if (webhook === null) {
          throw new Error('FEISHU_WEBHOOK_URL not configured');
        }
        await this.feishu.sendCardToWebhook(webhook, card);
      } else {
        throw new Error(`unsupported channel ${delivery.channel}`);
      }
      await this.markDelivery(deliveryId, {
        status: 'SENT',
        attemptCount: delivery.attemptCount + 1,
        lastError: null,
        sentAt: new Date(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`notification delivery failed id=${deliveryId}: ${message}`);
      await this.markDelivery(deliveryId, {
        status: 'FAILED',
        attemptCount: delivery.attemptCount + 1,
        lastError: message.slice(0, 1000),
        failedAt: new Date(),
      });
    }
  }

  /** 重试事件下所有失败的推送（界面「重试」按钮）。 */
  async retry(notificationId: string): Promise<{ retried: number }> {
    const failed = await this.repository.findDeliveriesByNotification(notificationId, 'FAILED');
    if (failed.length === 0) {
      return { retried: 0 };
    }
    for (const delivery of failed) {
      await this.markDelivery(delivery.id, { status: 'PENDING', lastError: null });
      await this.enqueueDelivery(delivery.id);
    }
    return { retried: failed.length };
  }

  private async markDelivery(
    id: string,
    patch: {
      status: string;
      attemptCount?: number;
      lastError?: string | null;
      sentAt?: Date | null;
      failedAt?: Date | null;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) =>
      this.repository.updateDelivery(manager, id, patch),
    );
  }

  private async enqueueDelivery(deliveryId: string): Promise<void> {
    try {
      await this.notificationQueue.add(
        'deliver',
        { deliveryId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
          jobId: `notify-delivery-${deliveryId}`,
        },
      );
    } catch (error: unknown) {
      this.logger.warn(`enqueue delivery failed id=${deliveryId}: ${String(error)}`);
      await this.markDelivery(deliveryId, {
        status: 'FAILED',
        lastError: `enqueue failed: ${String(error)}`.slice(0, 1000),
        failedAt: new Date(),
      });
    }
  }

  // --------------------------------------------------------------------------
  // 读取 / 未读
  // --------------------------------------------------------------------------

  async list(
    filters: NotificationListFilters,
    page: { page: number; pageSize: number },
    userId: string | null,
  ): Promise<{ items: NotificationDto[]; meta: PageMeta; unreadTotal: number }> {
    const { rows, total } = await this.repository.listForUser(
      userId ?? '00000000-0000-0000-0000-000000000000',
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    const contexts = await this.collectReferenceContexts(rows.map((row) => row.event));
    const unreadTotal = userId === null ? 0 : await this.repository.countUnread(userId);
    return {
      items: rows.map((row) => {
        const context = contexts.get(row.event.referenceId) ?? null;
        return this.toDto(row.event, context, row.read, row.deliveryStatus);
      }),
      meta: { page: page.page, pageSize: page.pageSize, total },
      unreadTotal,
    };
  }

  async getById(id: string, userId: string | null): Promise<NotificationDto> {
    const row = await this.repository.findById(id);
    if (row === null) {
      throw new NotificationNotFoundError(id);
    }
    const contexts = await this.collectReferenceContexts([
      { referenceType: row.referenceType, referenceId: row.referenceId },
    ]);
    const read = userId === null ? false : await this.repository.isRead(id, userId);
    return this.toDto(row, contexts.get(row.referenceId) ?? null, read, null);
  }

  async markRead(notificationId: string, userId: string): Promise<{ unreadTotal: number }> {
    const row = await this.repository.findById(notificationId);
    if (row === null) {
      throw new NotificationNotFoundError(notificationId);
    }
    await this.dataSource.transaction(async (manager) =>
      this.repository.markRead(manager, notificationId, userId),
    );
    return { unreadTotal: await this.repository.countUnread(userId) };
  }

  async markAllRead(userId: string): Promise<{ marked: number; unreadTotal: number }> {
    const marked = await this.dataSource.transaction(async (manager) =>
      this.repository.markAllRead(manager, userId),
    );
    return { marked, unreadTotal: 0 };
  }

  async unreadCount(userId: string | null): Promise<number> {
    return userId === null ? 0 : this.repository.countUnread(userId);
  }

  // --------------------------------------------------------------------------
  // 订阅与绑定
  // --------------------------------------------------------------------------

  async listSubscriptions(userId: string) {
    return this.repository.listSubscriptions(userId);
  }

  async createSubscription(input: {
    userId: string;
    channel: string;
    eventType: string;
    conditions: Record<string, string[]>;
    enabled: boolean;
  }) {
    this.assertSubscriptionInput(input.channel, input.eventType, input.conditions);
    return this.dataSource.transaction(async (manager) =>
      this.repository.insertSubscription(manager, input),
    );
  }

  async updateSubscription(
    id: string,
    userId: string,
    patch: { conditions?: Record<string, string[]>; enabled?: boolean },
  ) {
    const result = await this.dataSource.transaction(async (manager) =>
      this.repository.updateSubscription(manager, id, userId, patch),
    );
    if (result === null) {
      throw new NotificationNotFoundError(id);
    }
    return result;
  }

  async deleteSubscription(id: string, userId: string): Promise<void> {
    const deleted = await this.dataSource.transaction(async (manager) =>
      this.repository.deleteSubscription(manager, id, userId),
    );
    if (!deleted) {
      throw new NotificationNotFoundError(id);
    }
  }

  async listBindings(userId: string) {
    return this.repository.listBindings(userId);
  }

  async upsertBinding(input: {
    userId: string;
    channel: string;
    address: string;
    enabled: boolean;
  }) {
    if (input.channel !== 'FEISHU_DM' && input.channel !== 'EMAIL') {
      throw new NotificationInvalidInputError(`不支持按用户绑定通道：${input.channel}`);
    }
    const address = input.address.trim();
    if (address === '') {
      throw new NotificationInvalidInputError('投递地址不能为空');
    }
    return this.dataSource.transaction(async (manager) =>
      this.repository.upsertBinding(manager, { ...input, address }),
    );
  }

  private assertSubscriptionInput(
    channel: string,
    eventType: string,
    conditions: Record<string, string[]>,
  ): void {
    if (channel !== 'FEISHU_DM' && channel !== 'FEISHU_GROUP') {
      throw new NotificationInvalidInputError(`暂不支持的订阅通道：${channel}`);
    }
    const definition = eventDefinition(eventType);
    const allowed = new Set(['level', ...definition.conditionFields.map((field) => field.key)]);
    for (const key of Object.keys(conditions)) {
      if (!allowed.has(key)) {
        throw new NotificationInvalidInputError(
          `事件 ${eventType} 不支持按字段 ${key} 过滤（可选：${[...allowed].join('、')}）`,
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // 展示辅助
  // --------------------------------------------------------------------------

  private toEventData(
    type: string,
    title: string,
    content: string,
    referenceType: string,
    referenceId: string,
  ): NotificationEventData {
    const definition = eventDefinition(type);
    return {
      type,
      title,
      level: definition.level,
      factors: {},
      lines: content.split('\n'),
      linkPath: definition.linkPath,
      dedupeKey: null,
      referenceType,
      referenceId,
    };
  }

  private toDto(
    row: {
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
    },
    context: NotificationReferenceContext | null,
    isRead: boolean,
    deliveryStatus: string | null,
  ): NotificationDto {
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
      orderStatus: context?.orderStatus ?? null,
      goods: context?.goods ?? null,
      isRead,
      deliveryStatus,
    };
  }

  /** 一页内按 referenceType 各查一次，避免逐行查询。 */
  private async collectReferenceContexts(
    rows: ReadonlyArray<{ referenceType: string; referenceId: string }>,
  ): Promise<Map<string, NotificationReferenceContext>> {
    const byType = new Map<string, string[]>();
    for (const row of rows) {
      const list = byType.get(row.referenceType) ?? [];
      list.push(row.referenceId);
      byType.set(row.referenceType, list);
    }
    const merged = new Map<string, NotificationReferenceContext>();
    for (const [referenceType, ids] of byType) {
      const contexts = await this.repository.findReferenceContexts(referenceType, ids);
      for (const [id, context] of contexts) {
        merged.set(id, context);
      }
    }
    return merged;
  }

  private feishuWebhookUrl(): string | null {
    return this.config.get<string | null>('app.feishuWebhookUrl', { infer: true }) ?? null;
  }

  private webBaseUrl(): string | null {
    return this.config.get<string>('app.webBaseUrl', { infer: true }) ?? null;
  }
}

/** 去掉空值字段：条件匹配缺字段视为不匹配，不能把 '' 当事实。 */
function compactFactors(input: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined && value !== '') {
      out[key] = value;
    }
  }
  return out;
}
