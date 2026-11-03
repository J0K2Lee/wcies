import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 采购短装结案（2026-11-03，用户批准）。
 *
 * 背景：部分收货本身已支持（多张收货单累加 received_quantity），但供应商
 * 少发且不再补时没有任何出口——采购单永远停在 PARTIALLY_RECEIVED，未收数量
 * 永久计入「在途」，缺口被虚覆盖，补货采购被 `PURCHASE_SKU_GAP_COVERED` 拒绝，
 * 订单的缺货永远补不上。
 *
 * `closed_quantity` = 供应商不再发、由操作员显式结案的数量：
 * - **不写 received_quantity**（不伪造收货）、不产生库存流水、不动成本；
 * - 剩余口径统一改为 `quantity - received_quantity - closed_quantity`
 *   （草稿预填 / 超收守卫 / 在途 / 补货缺口）；
 * - `received + closed >= quantity` 时采购单重算为 RECEIVED，列表打
 *   「短装结案」标签（不新增状态，避免状态机扩散）。
 *
 * 约束 `received + closed <= quantity` 保证不会「结案超过订购量」。
 * 存量数据实测 288 行、无超收（received > quantity 0 行），约束可安全添加。
 */
export class PurchaseShortClose1793740000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_items
        ADD COLUMN closed_quantity numeric(18,3) NOT NULL DEFAULT 0,
        ADD COLUMN closed_at timestamptz NULL,
        ADD COLUMN closed_by uuid NULL,
        ADD COLUMN close_reason varchar(500) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_order_items
        ADD CONSTRAINT ck_po_items_closed_nonneg CHECK (closed_quantity >= 0),
        ADD CONSTRAINT ck_po_items_received_closed_within
          CHECK (received_quantity + closed_quantity <= quantity)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_items
        DROP CONSTRAINT IF EXISTS ck_po_items_received_closed_within,
        DROP CONSTRAINT IF EXISTS ck_po_items_closed_nonneg
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_order_items
        DROP COLUMN IF EXISTS closed_quantity,
        DROP COLUMN IF EXISTS closed_at,
        DROP COLUMN IF EXISTS closed_by,
        DROP COLUMN IF EXISTS close_reason
    `);
  }
}
