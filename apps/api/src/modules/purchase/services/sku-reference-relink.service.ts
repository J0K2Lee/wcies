import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  SkuReferenceRegistry,
  SkuReferenceRelink,
} from '../../product/services/sku-reference.registry';

/**
 * SKU 合并时的引用改指（2026-10-24）：把本模块指向源 SKU 的行改指目标 SKU。
 * 只碰本模块自己的表，经注册表被合并服务在**同一事务**内调用（AGENTS §9）。
 */
@Injectable()
export class SkuReferenceRelinkService implements SkuReferenceRelink, OnModuleInit {
  readonly name = 'purchase_order_items, purchase_receipt_items';

  constructor(
    private readonly registry: SkuReferenceRegistry,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async countReferences(skuId: string): Promise<number> {
    return (
      (await this.count('purchase_order_items', skuId)) +
      (await this.count('purchase_receipt_items', skuId))
    );
  }

  private async count(table: string, skuId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM ${table} WHERE sku_id = $1::uuid`,
      [skuId],
    );
    return rows[0]?.n ?? 0;
  }

  async relink(manager: EntityManager, sourceSkuId: string, targetSkuId: string): Promise<number> {
    let total = 0;
    const rows1 = await manager.query<Array<{ id: string }>>(
      `UPDATE purchase_order_items SET sku_id = $2::uuid, updated_at = now() WHERE sku_id = $1::uuid RETURNING id`,
      [sourceSkuId, targetSkuId],
    );
    total += countRows(rows1);
    const rows2 = await manager.query<Array<{ id: string }>>(
      `UPDATE purchase_receipt_items SET sku_id = $2::uuid, updated_at = now() WHERE sku_id = $1::uuid RETURNING id`,
      [sourceSkuId, targetSkuId],
    );
    total += countRows(rows2);
    return total;
  }
}

/** TypeORM 裸 UPDATE ... RETURNING 在部分驱动下返回 [rows, rowCount] 二元组。 */
function countRows(result: unknown): number {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return (result[0] as unknown[]).length;
  }
  return Array.isArray(result) ? result.length : 0;
}
