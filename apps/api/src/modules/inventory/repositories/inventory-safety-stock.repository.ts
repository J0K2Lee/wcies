import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InventorySafetyStockEntity } from '../entities/inventory-safety-stock.entity';
import { rawStr } from '../../../common/utils/raw';

/** Data access for the safety-stock policy table. */
@Injectable()
export class InventorySafetyStockRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findBySkuWarehouse(
    skuId: string,
    warehouseId: string,
  ): Promise<InventorySafetyStockEntity | null> {
    return this.dataSource
      .getRepository(InventorySafetyStockEntity)
      .findOneBy({ skuId, warehouseId });
  }

  async findBySku(skuId: string): Promise<InventorySafetyStockEntity[]> {
    return this.dataSource.getRepository(InventorySafetyStockEntity).find({ where: { skuId } });
  }

  /** Upsert on (sku_id, warehouse_id); no transaction needed - single row. */
  async upsert(
    skuId: string,
    warehouseId: string,
    safetyQty: string,
  ): Promise<InventorySafetyStockEntity> {
    const repository = this.dataSource.getRepository(InventorySafetyStockEntity);
    const existing = await this.findBySkuWarehouse(skuId, warehouseId);
    if (existing === null) {
      return repository.save(repository.create({ skuId, warehouseId, safetyQty }));
    }
    await repository.update({ id: existing.id }, { safetyQty });
    return (await this.findBySkuWarehouse(skuId, warehouseId)) as InventorySafetyStockEntity;
  }

  async list(
    filters: { skuId?: string; warehouseId?: string },
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<{
      safety: InventorySafetyStockEntity;
      skuCode: string;
      warehouseCode: string;
    }>;
    total: number;
  }> {
    const qb = this.dataSource
      .getRepository(InventorySafetyStockEntity)
      .createQueryBuilder('s')
      .innerJoin('skus', 'sku', 'sku.id = s.sku_id')
      .innerJoin('warehouses', 'wh', 'wh.id = s.warehouse_id')
      .addSelect('sku.sku_code', 'sku_code')
      .addSelect('wh.warehouse_code', 'warehouse_code');
    if (filters.skuId !== undefined) {
      qb.andWhere('s.skuId = :skuId', { skuId: filters.skuId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('s.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    }
    qb.orderBy('s.createdAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((safety, index) => ({
        safety,
        skuCode: rawStr(rawList[index]?.['sku_code']),
        warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
      })),
      total,
    };
  }
}
