import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import { OrderStatusHistoryEntity } from '../entities/order-status-history.entity';

/** History rows are append-only (task §9/§82). */
@Injectable()
export class OrderStatusHistoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    row: {
      orderId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      operatorId: string | null;
      operatorName: string | null;
    },
  ): Promise<void> {
    const repository = manager.getRepository(OrderStatusHistoryEntity);
    await repository.save(repository.create(row));
  }

  async listByOrderId(orderId: string): Promise<OrderStatusHistoryEntity[]> {
    return this.dataSource
      .getRepository(OrderStatusHistoryEntity)
      .find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  /**
   * EXCEPTION 的前提（存在待履约的未映射行）消失时，用历史里最近一次
   * 非 EXCEPTION 的去向恢复持有态——订单曾被「已发货」后误判回异常时，
   * 恢复的是 SHIPPED 而不是 NEW（2026-10-20）。从未有过则返回 null，
   * 调用方回落 NEW。
   */
  async findLastStatusOtherThan(orderId: string, status: string): Promise<string | null> {
    const row = await this.dataSource.getRepository(OrderStatusHistoryEntity).findOne({
      where: { orderId, toStatus: Not(status) },
      order: { createdAt: 'DESC' },
    });
    return row?.toStatus ?? null;
  }
}
