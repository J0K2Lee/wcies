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
}
