import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SkuBarcodeEntity } from '../entities/sku-barcode.entity';

/**
 * Data access only - no business rules here (AGENTS.md §8).
 * Primary-barcode switches run in one transaction; the DB partial unique
 * index uq_sku_barcodes_one_primary is the final guard (task §31).
 */
@Injectable()
export class SkuBarcodeRepository {
  constructor(
    @InjectRepository(SkuBarcodeEntity)
    private readonly repository: Repository<SkuBarcodeEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async listBySkuId(skuId: string): Promise<SkuBarcodeEntity[]> {
    return this.repository.find({
      where: { skuId },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
  }

  async findById(id: string): Promise<SkuBarcodeEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findByBarcode(barcode: string): Promise<SkuBarcodeEntity | null> {
    return this.repository.findOneBy({ barcode });
  }

  async findPrimaryOfSku(skuId: string): Promise<SkuBarcodeEntity | null> {
    return this.repository.findOneBy({ skuId, isPrimary: true });
  }

  async nextInternalBarcode(): Promise<string> {
    const result = await this.dataSource.query<{ nextval: string }[]>(
      "SELECT nextval('seq_internal_barcode') AS nextval",
    );
    const value = Number(result[0]?.nextval ?? 1);
    return `WCSKU${String(value).padStart(8, '0')}`;
  }

  /** Creates a barcode; when isPrimary, demotes the existing primary atomically. */
  async insertWithPrimaryHandling(
    barcode: Omit<SkuBarcodeEntity, 'id' | 'createdAt' | 'isPrimary' | 'status'> & {
      isPrimary: boolean;
      status: string;
    },
  ): Promise<SkuBarcodeEntity> {
    return this.dataSource.transaction(async (manager) => {
      if (barcode.isPrimary) {
        await manager.update(
          SkuBarcodeEntity,
          { skuId: barcode.skuId, isPrimary: true },
          { isPrimary: false },
        );
      }
      const created = manager.create(SkuBarcodeEntity, barcode);
      return manager.save(created);
    });
  }

  /** Updates a barcode; when switching to primary, demotes the old primary atomically. */
  async updateWithPrimaryHandling(
    id: string,
    skuId: string,
    patch: { barcodeType?: string; isPrimary?: boolean; status?: string },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (patch.isPrimary === true) {
        await manager.update(SkuBarcodeEntity, { skuId, isPrimary: true }, { isPrimary: false });
      }
      await manager.update(SkuBarcodeEntity, { id }, patch);
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.repository.delete({ id });
  }
}
