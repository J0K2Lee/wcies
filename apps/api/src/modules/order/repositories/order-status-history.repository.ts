import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
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
}
