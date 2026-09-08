import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderInterceptionHistoryEntity } from '../entities/order-interception-history.entity';

/** Append-only history log for interception transitions (task §41). */
@Injectable()
export class OrderInterceptionHistoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    row: {
      interceptionId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      operatorId: string | null;
      operatorName: string;
      details?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const repository = manager.getRepository(OrderInterceptionHistoryEntity);
    await repository.save(repository.create({ ...row, details: row.details ?? null }));
  }

  async listByInterceptionId(interceptionId: string): Promise<OrderInterceptionHistoryEntity[]> {
    return this.dataSource
      .getRepository(OrderInterceptionHistoryEntity)
      .find({ where: { interceptionId }, order: { createdAt: 'ASC' } });
  }
}
