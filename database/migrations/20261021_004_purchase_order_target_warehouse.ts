import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 采购单目标仓（2026-10-21，用户拍板）。
 *
 * 采购从「为某个订单行买货」改为「为某个仓的某个 SKU 补缺口」：采购单头
 * 必须记录收货仓库，收货/库位/覆盖都以此为准。`receiving_warehouse_id`
 * 字段早已存在（nilable），但订单入口从未写入：96 张里 95 张为空。
 *
 * 回填口径（按物理事实优先，其次采购意图）：
 *   1. 有收货的采购单 → 收货库位所属仓（仅单仓收货可确定）；
 *   2. 其余 → 关联订单店铺的 ACTIVE 绑定仓（仅唯一绑定可确定）。
 *
 * **不再强制 NOT NULL，也不再因无法确定而中止**（2026-10-24 修正）：
 * 历史采购单里存在既无收货、也无单绑定仓可推的（测试库实测 650/908 张），
 * 给它们硬塞一个默认仓等于编造业务事实（AGENTS §89）。改为「新单在 API/DTO
 * 层必填、历史单据保持 NULL」——NULL 表示「目标仓未登记」，不参与任何按仓的
 * 在途/缺口计算，也不会被当成某个仓的意图。
 *
 * 回填仍是纯增量：不修改/删除既有业务数据，源数据（收货记录、订单链接）保留。
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
    await queryRunner.query(
      `CREATE INDEX idx_purchase_orders_receiving_wh
         ON purchase_orders (receiving_warehouse_id, status)
       WHERE status <> 'CANCELLED'`,
    );
  }

  /** 回退只删索引；不回退已回填的值（源数据仍在，重算即可）。 */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_purchase_orders_receiving_wh`);
  }
}
