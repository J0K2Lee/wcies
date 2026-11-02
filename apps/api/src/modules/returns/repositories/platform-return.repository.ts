import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformReturnEntity } from '../entities/platform-return.entity';
import { PlatformReturnRaw } from '@wcies/platform-contracts';

/**
 * Data access for platform return records (dual-axis T5). Upserts are
 * compare-and-write: an unchanged record writes nothing (zero-churn
 * idempotency, same rule as order platform facts).
 */
@Injectable()
export class PlatformReturnRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByStoreAndReturnId(
    storeId: string,
    platformReturnId: string,
  ): Promise<PlatformReturnEntity | null> {
    return this.dataSource
      .getRepository(PlatformReturnEntity)
      .findOneBy({ storeId, platformReturnId });
  }

  /** 该店已落库的退货条数（0 = 首次同步，用来跳过一次提醒风暴）。 */
  async countByStore(storeId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM platform_returns WHERE store_id = $1`,
      [storeId],
    );
    return Number(rows[0]?.total ?? '0');
  }

  async insert(
    row: {
      storeId: string;
      platformReturnId: string;
      platformOrderId: string | null;
      orderId: string | null;
      state: string | null;
      refundState: string | null;
      platformSkuId: string | null;
      offerId: string | null;
      quantity: string;
      platformCreatedAt: Date | null;
      rawData: Record<string, unknown> | null;
    },
    manager?: EntityManager,
  ): Promise<PlatformReturnEntity> {
    const repository = (manager ?? this.dataSource).getRepository(PlatformReturnEntity);
    return repository.save(repository.create(row));
  }

  async updateFacts(
    id: string,
    patch: {
      platformOrderId?: string | null;
      orderId?: string | null;
      state?: string | null;
      refundState?: string | null;
      rawData?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        update[key] = value;
      }
    }
    await this.dataSource.getRepository(PlatformReturnEntity).update({ id }, update);
  }

  async list(filters: {
    storeId?: string;
    orderId?: string;
    linked?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ rows: PlatformReturnEntity[]; total: number }> {
    const qb = this.dataSource
      .getRepository(PlatformReturnEntity)
      .createQueryBuilder('r')
      .where('1 = 1');
    if (filters.storeId !== undefined) {
      qb.andWhere('r.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.orderId !== undefined) {
      qb.andWhere('r.order_id = :orderId', { orderId: filters.orderId });
    }
    if (filters.linked === false) {
      // Pending-reconciliation view: platform records no batch line consumed.
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM return_batch_items i WHERE i.platform_return_id = r.id)`,
      );
    }
    qb.orderBy('r.createdAt', 'DESC').skip(filters.offset).take(filters.limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async findById(id: string): Promise<PlatformReturnEntity | null> {
    return this.dataSource.getRepository(PlatformReturnEntity).findOneBy({ id });
  }

  /** Raw shape adapter for sync upserts. */
  static toRow(input: PlatformReturnRaw, storeId: string) {
    return {
      storeId,
      platformReturnId: input.platformReturnId,
      platformOrderId: input.platformOrderId,
      orderId: null,
      state: input.state,
      refundState: input.refundState,
      platformSkuId: input.platformSkuId,
      offerId: input.offerId,
      quantity: input.quantity,
      platformCreatedAt: input.createdAt,
      rawData: input.rawData,
    };
  }
}
