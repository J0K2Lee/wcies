import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformStatusHistoryEntity } from '../entities/platform-status-history.entity';

/**
 * Platform status history rows are append-only and written only on an
 * observed platform_status transition (Sprint 9 planning T1) - an idempotent
 * re-sync with an unchanged status writes nothing.
 */
@Injectable()
export class PlatformStatusHistoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    row: {
      orderId: string;
      fromStatus: string | null;
      toStatus: string;
      source: string | null;
      operatorName: string | null;
    },
  ): Promise<void> {
    const repository = manager.getRepository(PlatformStatusHistoryEntity);
    await repository.save(repository.create(row));
  }

  async listByOrderId(orderId: string): Promise<PlatformStatusHistoryEntity[]> {
    return this.dataSource
      .getRepository(PlatformStatusHistoryEntity)
      .find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }
}
