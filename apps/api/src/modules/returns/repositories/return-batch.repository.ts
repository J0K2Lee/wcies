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
    keyword?: string;
    limit: number;
    offset: number;
  }): Promise<{
    rows: Array<{ batch: ReturnBatchEntity; itemCount: number; pendingItems: number }>;
    total: number;
  }> {
    const qb = this.dataSource
      .getRepository(ReturnBatchEntity)
      .createQueryBuilder('b')
      .addSelect(
        `(SELECT COUNT(*) FROM return_batch_items i WHERE i.batch_id = b.id)`,
        'item_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM return_batch_items i WHERE i.batch_id = b.id AND i.condition = 'PENDING')`,
        'pending_count',
      );
    if (filters.status !== undefined) {
      qb.andWhere('b.status = :status', { status: filters.status });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('b.warehouse_id = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
      // 批次号 / 来源说明 / 关联的平台退货单号 / 行上的内部 SKU 编码。
      qb.andWhere(
        `(b.batch_no ILIKE :kw
          OR COALESCE(b.source_note, '') ILIKE :kw
          OR EXISTS (
            SELECT 1
              FROM return_batch_items i
              LEFT JOIN platform_returns pr ON pr.id = i.platform_return_id
              LEFT JOIN skus s ON s.id = i.sku_id
             WHERE i.batch_id = b.id
               AND (pr.platform_return_id ILIKE :kw OR s.sku_code ILIKE :kw OR s.name_zh ILIKE :kw)
          ))`,
        { kw: `%${filters.keyword.trim()}%` },
      );
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
        pendingItems: Number(rawList[index]?.['pending_count'] ?? 0),
      })),
      total,
    };
  }

  /** 平台退货记录是否已被某个批次行消费（建批前预检，给出可读错误）。 */
  async findItemPlatformReturnIds(platformReturnIds: string[]): Promise<Map<string, string>> {
    if (platformReturnIds.length === 0) {
      return new Map();
    }
    const rows = await this.dataSource.query<
      Array<{ platform_return_id: string; batch_no: string }>
    >(
      `SELECT i.platform_return_id, b.batch_no
         FROM return_batch_items i
         JOIN return_batches b ON b.id = i.batch_id
        WHERE i.platform_return_id = ANY($1::uuid[])`,
      [platformReturnIds],
    );
    return new Map(rows.map((row) => [row.platform_return_id, row.batch_no]));
  }

  /** 追加一个已扫序列号（SN 退货行），返回追加后的完整列表。 */
  async appendReceivedSerial(
    manager: EntityManager,
    itemId: string,
    serialNumber: string,
  ): Promise<string[]> {
    const result: unknown = await manager.query(
      `UPDATE return_batch_items
          SET received_serial_numbers = array_append(COALESCE(received_serial_numbers, '{}'), $2),
              updated_at = now()
        WHERE id = $1
        RETURNING received_serial_numbers AS serials`,
      [itemId, serialNumber],
    );
    // TypeORM 的 UPDATE ... RETURNING 在不同驱动下单/双元组返回（见 2026-10-15 经验）。
    const rows =
      (Array.isArray(result) && Array.isArray((result as unknown[])[0])
        ? ((result as unknown[])[0] as Array<{ serials: string[] }>)
        : (result as Array<{ serials: string[] }>)) ?? [];
    return rows[0]?.serials ?? [];
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
