import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationChannel, NotificationStatus } from '../enums/notification.constants';
import { NotificationEntity } from '../entities/notification.entity';
export interface NotificationListFilters {
  type?: string;
  channel?: string;
  status?: string;
  referenceType?: string;
  referenceId?: string;
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

  async updateDelivery(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<NotificationEntity, 'status' | 'attemptCount' | 'lastError' | 'sentAt' | 'failedAt'>
    >,
  ): Promise<void> {
    await manager.getRepository(NotificationEntity).update({ id }, patch);
  }

  /**
   * 关联订单的 ERP 状态（2026-10-26 用户要求：通知状态与订单状态分两列）。
   *
   * 只读派生查询：通知的 reference 可能是订单本身，也可能是拦截任务
   * （`ORDER_INTERCEPTION` → `order_interceptions.order_id`）。这里直接读这两张表，
   * 是为了避免 notification ↔ order/interception 的模块循环（AGENTS §9 的精神是
   * 不读对方**内部实现**；这里是展示用的只读联查，不含业务判断）。
   */
  async findOrderStatuses(
    referenceType: string,
    referenceIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (referenceIds.length === 0) {
      return new Map();
    }
    if (referenceType === 'ORDER_INTERCEPTION') {
      const rows = await this.dataSource.query<Array<{ reference_id: string; erp_status: string }>>(
        `SELECT oi.id AS reference_id, o.erp_status
           FROM order_interceptions oi
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.id = ANY($1::uuid[])`,
        [[...referenceIds]],
      );
      return new Map(rows.map((row) => [row.reference_id, row.erp_status]));
    }
    if (referenceType === 'ORDER') {
      const rows = await this.dataSource.query<Array<{ reference_id: string; erp_status: string }>>(
        `SELECT o.id AS reference_id, o.erp_status
           FROM orders o
          WHERE o.id = ANY($1::uuid[])`,
        [[...referenceIds]],
      );
      return new Map(rows.map((row) => [row.reference_id, row.erp_status]));
    }
    return new Map();
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
}
