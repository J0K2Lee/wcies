import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SkuImageEntity } from '../entities/sku-image.entity';

/**
 * Data access only - no business rules here (AGENTS.md §8).
 * Primary-image switches run in one transaction; the DB partial unique index
 * uq_sku_images_one_primary is the final guard (task §34).
 */
@Injectable()
export class SkuImageRepository {
  constructor(
    @InjectRepository(SkuImageEntity)
    private readonly repository: Repository<SkuImageEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async listBySkuId(skuId: string): Promise<SkuImageEntity[]> {
    return this.repository.find({
      where: { skuId },
      order: { isPrimary: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * 批量取「每 SKU 的主图」（2026-10-24）：采购单展开明细要一屏显示多个 SKU
   * 的图片，逐 SKU 查询会变成 N 次往返。排序与 `listBySkuId` 一致
   * （primary 优先，其次 sortOrder/createdAt），每个 SKU 只取第一张。
   */
  async listPrimaryBySkuIds(
    skuIds: readonly string[],
  ): Promise<Array<{ skuId: string; objectKey: string }>> {
    if (skuIds.length === 0) {
      return [];
    }
    const rows = await this.dataSource.query<Array<{ sku_id: string; object_key: string }>>(
      `SELECT DISTINCT ON (sku_id) sku_id, object_key
         FROM sku_images
        WHERE sku_id = ANY($1::uuid[])
        ORDER BY sku_id, is_primary DESC, sort_order ASC, created_at ASC`,
      [[...skuIds]],
    );
    return rows.map((row) => ({ skuId: row.sku_id, objectKey: row.object_key }));
  }

  async findById(id: string): Promise<SkuImageEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async insert(image: Omit<SkuImageEntity, 'id' | 'createdAt'>): Promise<SkuImageEntity> {
    return this.dataSource.transaction(async (manager) => {
      if (image.isPrimary) {
        await manager.update(
          SkuImageEntity,
          { skuId: image.skuId, isPrimary: true },
          { isPrimary: false },
        );
      }
      const created = manager.create(SkuImageEntity, image);
      return manager.save(created);
    });
  }

  async updateWithPrimaryHandling(
    id: string,
    skuId: string,
    patch: { sortOrder?: number; isPrimary?: boolean },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (patch.isPrimary === true) {
        await manager.update(SkuImageEntity, { skuId, isPrimary: true }, { isPrimary: false });
      }
      await manager.update(SkuImageEntity, { id }, patch);
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.repository.delete({ id });
  }
}
