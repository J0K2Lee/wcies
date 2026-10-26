import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationChannel, NotificationStatus } from '../enums/notification.constants';
import { NotificationEntity } from '../entities/notification.entity';
import {
  NotificationDeliveryEntity,
  NotificationReadEntity,
  UserChannelBindingEntity,
} from '../entities/notification-channel.entities';
import { NotificationSubscriptionEntity } from '../entities/notification-subscription.entity';
export interface NotificationListFilters {
  type?: string;
  channel?: string;
  status?: string;
  referenceType?: string;
  referenceId?: string;
}

/** 当前用户视角的列表行（事件 + 未读 + 自己的投递状态）。 */
export interface NotificationListRow {
  event: {
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
  };
  read: boolean;
  deliveryStatus: string | null;
}

/** Data access for notification rows. */
@Injectable()
export class NotificationRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    row: {
      type: string;
      channel: NotificationChannel;
      referenceType: string;
      referenceId: string;
      recipient?: string | null;
      title: string;
      content: string;
      status: NotificationStatus;
      attemptCount?: number;
      sentAt?: Date | null;
      dedupeKey?: string | null;
    },
  ): Promise<NotificationEntity> {
    const repository = manager.getRepository(NotificationEntity);
    const entity = repository.create({
      ...row,
      recipient: row.recipient ?? null,
      attemptCount: row.attemptCount ?? 0,
      sentAt: row.sentAt ?? null,
    });
    return repository.save(entity);
  }

  async findById(id: string): Promise<NotificationEntity | null> {
    return this.dataSource.getRepository(NotificationEntity).findOneBy({ id });
  }

  async lockById(manager: EntityManager, id: string): Promise<NotificationEntity | null> {
    return manager
      .getRepository(NotificationEntity)
      .createQueryBuilder('n')
      .where('n.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  /** 旧的事件行投递状态更新（保留兼容：SYSTEM 事件行直接 SENT）。 */
  async updateEventDelivery(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<NotificationEntity, 'status' | 'attemptCount' | 'lastError' | 'sentAt' | 'failedAt'>
    >,
  ): Promise<void> {
    await manager.getRepository(NotificationEntity).update({ id }, patch);
  }

  /**
   * 关联对象的展示上下文（2026-10-26 用户要求）：
   * - `orderStatus`：关联订单**当前**的 ERP 状态（通知状态与订单状态分两列）；
   * - `goods`：拦截类通知对应的**实物现在在哪**——拦截进度 + 原拣货库位 /
   *   已回库目标库位 / 已装包裹。
   *
   * 只读派生查询（一页最多两次），直接联查订单/拦截表是为了避免
   * notification ↔ order/interception 的模块循环（AGENTS §9 禁止的是读对方
   * 内部实现并据此做业务判断，这里只是展示用的事实读取）。
   */
  async findReferenceContexts(
    referenceType: string,
    referenceIds: readonly string[],
  ): Promise<
    Map<
      string,
      {
        orderStatus: string | null;
        goods: {
          interceptionStatus: string;
          pickBinCodes: string[];
          targetBinCode: string | null;
          packageNos: string[];
        } | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        orderStatus: string | null;
        goods: {
          interceptionStatus: string;
          pickBinCodes: string[];
          targetBinCode: string | null;
          packageNos: string[];
        } | null;
      }
    >();
    if (referenceIds.length === 0) {
      return result;
    }
    if (referenceType === 'ORDER') {
      const rows = await this.dataSource.query<Array<{ reference_id: string; erp_status: string }>>(
        `SELECT o.id AS reference_id, o.erp_status
           FROM orders o
          WHERE o.id = ANY($1::uuid[])`,
        [[...referenceIds]],
      );
      for (const row of rows) {
        result.set(row.reference_id, { orderStatus: row.erp_status, goods: null });
      }
      return result;
    }
    if (referenceType === 'ORDER_INTERCEPTION') {
      const rows = await this.dataSource.query<
        Array<{
          reference_id: string;
          erp_status: string;
          interception_status: string;
          target_bin_code: string | null;
          pick_bin_codes: string[] | null;
          package_nos: string[] | null;
        }>
      >(
        `SELECT oi.id AS reference_id,
                o.erp_status,
                oi.status AS interception_status,
                ob.bin_code AS target_bin_code,
                (SELECT array_agg(DISTINCT pb.bin_code)
                   FROM order_items i
                   JOIN inventory_reservation_lines rl ON rl.reservation_id = i.reservation_id
                   JOIN warehouse_bins pb ON pb.id = rl.bin_id
                  WHERE i.id = oi.order_item_id AND rl.picked_qty > 0) AS pick_bin_codes,
                (SELECT array_agg(DISTINCT p.package_no)
                   FROM package_items pi
                   JOIN packages p ON p.id = pi.package_id
                  WHERE pi.order_item_id = oi.order_item_id AND pi.status = 'ACTIVE') AS package_nos
           FROM order_interceptions oi
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN warehouse_bins ob ON ob.id = oi.target_bin_id
          WHERE oi.id = ANY($1::uuid[])`,
        [[...referenceIds]],
      );
      for (const row of rows) {
        result.set(row.reference_id, {
          orderStatus: row.erp_status,
          goods: {
            interceptionStatus: row.interception_status,
            pickBinCodes: row.pick_bin_codes ?? [],
            targetBinCode: row.target_bin_code,
            packageNos: row.package_nos ?? [],
          },
        });
      }
      return result;
    }
    return result;
  }

  async list(
    filters: NotificationListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: NotificationEntity[]; total: number }> {
    const qb = this.dataSource.getRepository(NotificationEntity).createQueryBuilder('n');
    if (filters.type !== undefined) {
      qb.andWhere('n.type = :type', { type: filters.type });
    }
    if (filters.channel !== undefined) {
      qb.andWhere('n.channel = :channel', { channel: filters.channel });
    }
    if (filters.status !== undefined) {
      qb.andWhere('n.status = :status', { status: filters.status });
    }
    if (filters.referenceType !== undefined) {
      qb.andWhere('n.referenceType = :referenceType', { referenceType: filters.referenceType });
    }
    if (filters.referenceId !== undefined) {
      qb.andWhere('n.referenceId = :referenceId', { referenceId: filters.referenceId });
    }
    qb.orderBy('n.createdAt', 'DESC').skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  // --------------------------------------------------------------------------
  // 订阅 / 绑定 / 投递 / 未读（2026-10-26）
  // --------------------------------------------------------------------------

  /** 去重：同类型 + 同 dedupeKey 在窗口内已存在就复用（不重复建事件）。 */
  async findRecentByDedupe(
    type: string,
    dedupeKey: string,
    sinceMinutes: number,
  ): Promise<NotificationEntity | null> {
    const row = await this.dataSource
      .getRepository(NotificationEntity)
      .findOne({ where: { type, dedupeKey }, order: { createdAt: 'DESC' } });
    if (row === null) {
      return null;
    }
    return row.createdAt.getTime() >= Date.now() - sinceMinutes * 60_000 ? row : null;
  }

  async listSubscriptions(userId: string): Promise<NotificationSubscriptionEntity[]> {
    return this.dataSource
      .getRepository(NotificationSubscriptionEntity)
      .find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async listEnabledSubscriptions(eventType: string): Promise<NotificationSubscriptionEntity[]> {
    return this.dataSource
      .getRepository(NotificationSubscriptionEntity)
      .find({ where: { eventType, enabled: true } });
  }

  async insertSubscription(
    manager: EntityManager,
    row: {
      userId: string;
      channel: string;
      eventType: string;
      conditions: Record<string, string[]>;
      enabled: boolean;
    },
  ): Promise<NotificationSubscriptionEntity> {
    const repository = manager.getRepository(NotificationSubscriptionEntity);
    return repository.save(repository.create(row));
  }

  async updateSubscription(
    manager: EntityManager,
    id: string,
    userId: string,
    patch: { conditions?: Record<string, string[]>; enabled?: boolean },
  ): Promise<NotificationSubscriptionEntity | null> {
    const repository = manager.getRepository(NotificationSubscriptionEntity);
    const row = await repository.findOne({ where: { id, userId } });
    if (row === null) {
      return null;
    }
    if (patch.conditions !== undefined) {
      row.conditions = patch.conditions;
    }
    if (patch.enabled !== undefined) {
      row.enabled = patch.enabled;
    }
    return repository.save(row);
  }

  async deleteSubscription(manager: EntityManager, id: string, userId: string): Promise<boolean> {
    const result = await manager
      .getRepository(NotificationSubscriptionEntity)
      .delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }

  async listBindings(userId: string): Promise<UserChannelBindingEntity[]> {
    return this.dataSource
      .getRepository(UserChannelBindingEntity)
      .find({ where: { userId }, order: { channel: 'ASC' } });
  }

  async findBinding(userId: string, channel: string): Promise<UserChannelBindingEntity | null> {
    return this.dataSource
      .getRepository(UserChannelBindingEntity)
      .findOne({ where: { userId, channel } });
  }

  async upsertBinding(
    manager: EntityManager,
    row: { userId: string; channel: string; address: string; enabled: boolean },
  ): Promise<UserChannelBindingEntity> {
    const repository = manager.getRepository(UserChannelBindingEntity);
    const existing = await repository.findOne({
      where: { userId: row.userId, channel: row.channel },
    });
    if (existing === null) {
      return repository.save(repository.create({ ...row, verifiedAt: new Date() }));
    }
    existing.address = row.address;
    existing.enabled = row.enabled;
    existing.verifiedAt = new Date();
    return repository.save(existing);
  }

  async insertDeliveries(
    manager: EntityManager,
    rows: Array<{
      notificationId: string;
      userId: string | null;
      channel: string;
      ruleId: string | null;
    }>,
  ): Promise<NotificationDeliveryEntity[]> {
    if (rows.length === 0) {
      return [];
    }
    const repository = manager.getRepository(NotificationDeliveryEntity);
    return repository.save(repository.create(rows));
  }

  async findDelivery(id: string): Promise<NotificationDeliveryEntity | null> {
    return this.dataSource.getRepository(NotificationDeliveryEntity).findOneBy({ id });
  }

  async updateDelivery(
    manager: EntityManager,
    id: string,
    patch: {
      status: string;
      attemptCount?: number;
      lastError?: string | null;
      sentAt?: Date | null;
      failedAt?: Date | null;
    },
  ): Promise<void> {
    await manager.getRepository(NotificationDeliveryEntity).update({ id }, patch);
  }

  async findDeliveriesByNotification(
    notificationId: string,
    status?: string,
  ): Promise<NotificationDeliveryEntity[]> {
    return this.dataSource.getRepository(NotificationDeliveryEntity).find({
      where: { notificationId, ...(status === undefined ? {} : { status }) },
      order: { createdAt: 'ASC' },
    });
  }

  /** 当前用户视角：事件 + 是否已读 + 自己最近一次投递状态。 */
  async listForUser(
    userId: string,
    filters: NotificationListFilters,
    limit: number,
    offset: number,
  ): Promise<{
    rows: NotificationListRow[];
    total: number;
  }> {
    const result = await this.dataSource.query<
      Array<{
        id: string;
        type: string;
        channel: string;
        reference_type: string;
        reference_id: string;
        recipient: string | null;
        title: string;
        content: string;
        status: string;
        attempt_count: number;
        last_error: string | null;
        sent_at: Date | null;
        failed_at: Date | null;
        created_at: Date;
        is_read: boolean;
        delivery_status: string | null;
      }>
    >(
      `SELECT n.*, (r.user_id IS NOT NULL) AS is_read, d.status AS delivery_status
         FROM notifications n
         LEFT JOIN notification_reads r
                ON r.notification_id = n.id AND r.user_id = $1::uuid
         LEFT JOIN LATERAL (
                SELECT status FROM notification_deliveries
                 WHERE notification_id = n.id AND user_id = $1::uuid
                 ORDER BY created_at DESC LIMIT 1) d ON TRUE
        WHERE ($2::text IS NULL OR n.type = $2)
          AND ($3::text IS NULL OR n.channel = $3)
          AND ($4::text IS NULL OR n.reference_type = $4)
          AND ($5::uuid IS NULL OR n.reference_id = $5::uuid)
        ORDER BY n.created_at DESC
        LIMIT $6 OFFSET $7`,
      [
        userId,
        filters.type ?? null,
        filters.channel ?? null,
        filters.referenceType ?? null,
        filters.referenceId ?? null,
        limit,
        offset,
      ],
    );
    const count = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM notifications n
        WHERE ($1::text IS NULL OR n.type = $1)
          AND ($2::text IS NULL OR n.channel = $2)
          AND ($3::text IS NULL OR n.reference_type = $3)
          AND ($4::uuid IS NULL OR n.reference_id = $4::uuid)`,
      [
        filters.type ?? null,
        filters.channel ?? null,
        filters.referenceType ?? null,
        filters.referenceId ?? null,
      ],
    );
    return {
      rows: result.map((row) => ({
        event: {
          id: row.id,
          type: row.type,
          channel: row.channel,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          recipient: row.recipient,
          title: row.title,
          content: row.content,
          status: row.status,
          attemptCount: row.attempt_count,
          lastError: row.last_error,
          sentAt: row.sent_at,
          failedAt: row.failed_at,
          createdAt: row.created_at,
        },
        read: row.is_read,
        deliveryStatus: row.delivery_status,
      })),
      total: Number(count[0]?.total ?? 0),
    };
  }

  async markRead(manager: EntityManager, notificationId: string, userId: string): Promise<void> {
    await manager
      .getRepository(NotificationReadEntity)
      .createQueryBuilder()
      .insert()
      .into(NotificationReadEntity)
      .values({ notificationId, userId })
      .orIgnore()
      .execute();
  }

  async markAllRead(manager: EntityManager, userId: string): Promise<number> {
    const result = await manager.query<Array<{ notification_id: string }>>(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1::uuid FROM notifications n
        WHERE NOT EXISTS (SELECT 1 FROM notification_reads r
                           WHERE r.notification_id = n.id AND r.user_id = $1::uuid)
       ON CONFLICT DO NOTHING
       RETURNING notification_id`,
      [userId],
    );
    return result.length;
  }

  async isRead(notificationId: string, userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ one: number }>>(
      `SELECT 1 AS one FROM notification_reads
        WHERE notification_id = $1::uuid AND user_id = $2::uuid`,
      [notificationId, userId],
    );
    return rows.length > 0;
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*)::text AS n FROM notifications n
        WHERE NOT EXISTS (SELECT 1 FROM notification_reads r
                           WHERE r.notification_id = n.id AND r.user_id = $1::uuid)`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
