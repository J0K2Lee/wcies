import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ReturnBatchEntity } from '../entities/return-batch.entity';
import { ReturnBatchItemEntity } from '../entities/return-batch-item.entity';

/** Data access for return batches and their lines (dual-axis T5). */
@Injectable()
export class ReturnBatchRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(id: string): Promise<ReturnBatchEntity | null> {
    return this.dataSource.getRepository(ReturnBatchEntity).findOneBy({ id });
  }

  async list(filters: {
    status?: string;
    warehouseId?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: Array<{ batch: ReturnBatchEntity; itemCount: number }>; total: number }> {
    const qb = this.dataSource
      .getRepository(ReturnBatchEntity)
      .createQueryBuilder('b')
      .addSelect(
        `(SELECT COUNT(*) FROM return_batch_items i WHERE i.batch_id = b.id)`,
        'item_count',
      );
    if (filters.status !== undefined) {
      qb.andWhere('b.status = :status', { status: filters.status });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('b.warehouse_id = :warehouseId', { warehouseId: filters.warehouseId });
    }
    qb.orderBy('b.createdAt', 'DESC').skip(filters.offset).take(filters.limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((batch, index) => ({
        batch,
        itemCount: Number(rawList[index]?.['item_count'] ?? 0),
      })),
      total,
    };
  }

  async insertBatch(
    manager: EntityManager,
    header: {
      batchNo: string;
      warehouseId: string;
      status: 'DRAFT';
      sourceNote: string | null;
      remark: string | null;
      createdBy: string | null;
    },
    items: Array<{
      platformReturnId: string | null;
      skuId: string;
      quantity: string;
      remark: string | null;
    }>,
  ): Promise<ReturnBatchEntity> {
    const repository = manager.getRepository(ReturnBatchEntity);
    const created = await repository.save(repository.create(header));
    const itemRepository = manager.getRepository(ReturnBatchItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          batchId: created.id,
          platformReturnId: item.platformReturnId,
          skuId: item.skuId,
          quantity: item.quantity,
          condition: 'PENDING' as const,
          remark: item.remark,
        })),
      );
    }
    return created;
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    status: ReturnBatchEntity['status'],
  ): Promise<void> {
    await manager
      .getRepository(ReturnBatchEntity)
      .update({ id }, { status, updatedAt: new Date() });
  }

  async findItemsByBatchId(batchId: string): Promise<ReturnBatchItemEntity[]> {
    return this.dataSource
      .getRepository(ReturnBatchItemEntity)
      .find({ where: { batchId }, order: { createdAt: 'ASC' } });
  }

  async findItemById(itemId: string): Promise<ReturnBatchItemEntity | null> {
    return this.dataSource.getRepository(ReturnBatchItemEntity).findOneBy({ id: itemId });
  }

  async updateItem(
    manager: EntityManager,
    itemId: string,
    patch: { condition?: ReturnBatchItemEntity['condition']; binId?: string | null },
  ): Promise<void> {
    await manager
      .getRepository(ReturnBatchItemEntity)
      .update({ id: itemId }, { ...patch, updatedAt: new Date() });
  }
}
