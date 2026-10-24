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
  readonly name = 'transfer_order_lines';

  constructor(
    private readonly registry: SkuReferenceRegistry,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async countReferences(skuId: string): Promise<number> {
    return await this.count('transfer_order_lines', skuId);
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
    const rows = await manager.query<Array<{ id: string }>>(
      `UPDATE transfer_order_lines SET sku_id = $2::uuid WHERE sku_id = $1::uuid RETURNING id`,
      [sourceSkuId, targetSkuId],
    );
    total += countRows(rows);
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
