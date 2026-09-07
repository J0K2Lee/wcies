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
