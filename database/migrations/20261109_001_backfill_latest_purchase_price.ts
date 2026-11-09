import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 最近采购价回填（2026-11-09 用户口径）：
 *
 * 规则从「人工维护」改为「收货确认时自动更新」；本迁移按历史**已确认收货**
 * 明细回填存量：每个 SKU 取 `received_at` 最新一条（同日按明细创建时间），
 * `unit_cost` 为空的行不参与（成本未知不能臆造）。
 *
 * 幂等：只更新与目标值不一致的 SKU。草稿/取消的收货单不计入。
 */
export class BackfillLatestPurchasePrice1794200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH last AS (
        SELECT DISTINCT ON (pri.sku_id)
               pri.sku_id,
               pri.unit_cost
          FROM purchase_receipt_items pri
          JOIN purchase_receipts pr
            ON pr.id = pri.receipt_id
           AND pr.status = 'RECEIVED'
         WHERE pri.unit_cost IS NOT NULL
         ORDER BY pri.sku_id, pr.received_at DESC NULLS LAST, pri.created_at DESC
      )
      UPDATE skus s
         SET latest_purchase_price = last.unit_cost,
             updated_at = now()
        FROM last
       WHERE s.id = last.sku_id
         AND s.latest_purchase_price IS DISTINCT FROM last.unit_cost
    `);
  }

  public async down(): Promise<void> {
    // 回填不可逆：旧值（人工维护）没有留档，回滚没有意义。
  }
}
