import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 采购单目标仓（2026-10-21，用户拍板）。
 *
 * 采购从「为某个订单行买货」改为「为某个仓的某个 SKU 补缺口」：采购单头
 * 必须记录收货仓库，收货/库位/覆盖都以此为准。`receiving_warehouse_id`
 * 字段早已存在（nilable），但订单入口从未写入：96 张里 95 张为空。
 *
 * 回填口径（按物理事实优先，其次采购意图；无法唯一确定则中止，不猜）：
 *   1. 有收货的采购单 → 收货库位所属仓（预检：0 张跨仓收货）；
 *   2. 其余 → 关联订单店铺的 ACTIVE 绑定仓（预检：关联店铺均恰好 1 个绑定）。
 *
 * 整段在一个事务里执行：任一步失败（含存在无法确定的行）整体回滚。
 * 不修改/删除任何既有业务数据；源数据（收货记录、订单链接）保留，可重算。
 */
export class PurchaseOrderTargetWarehouse1792543000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 物理事实：收货库位所属仓（仅单仓收货的采购单）
    await queryRunner.query(`
      UPDATE purchase_orders po
         SET receiving_warehouse_id = src.warehouse_id
        FROM (
          SELECT poi.po_id, MIN(b.warehouse_id::text)::uuid AS warehouse_id
            FROM purchase_receipt_items ri
            JOIN purchase_order_items poi ON poi.id = ri.purchase_order_item_id
            JOIN warehouse_bins b ON b.id = ri.bin_id
           GROUP BY poi.po_id
          HAVING COUNT(DISTINCT b.warehouse_id) = 1
        ) src
       WHERE po.id = src.po_id
         AND po.receiving_warehouse_id IS NULL
    `);

    // 2) 采购意图：关联订单店铺的默认绑定仓（仅唯一绑定可确定）
    await queryRunner.query(`
      UPDATE purchase_orders po
         SET receiving_warehouse_id = src.warehouse_id
        FROM (
          SELECT poi.po_id, MIN(b.warehouse_id::text)::uuid AS warehouse_id
            FROM purchase_order_items poi
            JOIN order_items oi ON oi.id = poi.order_item_id
            JOIN orders o ON o.id = oi.order_id
            JOIN warehouse_platform_bindings b
              ON b.store_id = o.store_id AND b.status = 'ACTIVE'
           WHERE poi.order_item_id IS NOT NULL
           GROUP BY poi.po_id
          HAVING COUNT(DISTINCT b.warehouse_id) = 1
        ) src
       WHERE po.id = src.po_id
         AND po.receiving_warehouse_id IS NULL
    `);

    // 3) 仍有空值 = 数据存在歧义：中止（事务回滚，schema 不变）
    await queryRunner.query(`
      DO $$
      DECLARE missing int;
      BEGIN
        SELECT count(*) INTO missing
          FROM purchase_orders
         WHERE receiving_warehouse_id IS NULL;
        IF missing > 0 THEN
          RAISE EXCEPTION 'purchase_orders: % 张无法确定目标仓，请人工处理后再迁移', missing;
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE purchase_orders ALTER COLUMN receiving_warehouse_id SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_orders_receiving_wh
         ON purchase_orders (receiving_warehouse_id, status)
       WHERE status <> 'CANCELLED'`,
    );
  }

  /**
   * 回退只放松约束、保留已回填的值（源数据仍在，重算即可）。
   * 不做数据回退：把仓库置空会重新制造“无法确定目标仓”的状态。
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_purchase_orders_receiving_wh`);
    await queryRunner.query(
      `ALTER TABLE purchase_orders ALTER COLUMN receiving_warehouse_id DROP NOT NULL`,
    );
  }
}
