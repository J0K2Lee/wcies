import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ERP 建议#4 (2026-09-28): persist the receiving-warehouse INTENT on the
 * purchase order header. The stock facts stay on the receipt (decision 0013
 * untouched) - this column only echoes "which warehouse the operator chose
 * at creation" so the PO detail can display it and 收货页「从采购单生成」
 * can prefill it.
 *
 * Backfill (AGENTS.md §89: idempotent, ambiguous rows are NEVER guessed):
 * a PO inherits the warehouse from receipts that reference it ONLY when
 * every such receipt agrees on one warehouse; POs with no receipts or with
 * conflicting warehouses keep NULL and are counted in the audit log.
 */
export class AddPurchaseOrdersReceivingWarehouse1792800001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE purchase_orders ADD COLUMN receiving_warehouse_id uuid NULL',
    );
    await queryRunner.query(
      'ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_receiving_warehouse ' +
        'FOREIGN KEY (receiving_warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL',
    );

    // Backfill from receipt facts, only when unambiguous. (array_agg)[1]
    // instead of MIN(): PG has no min(uuid) aggregate, and HAVING already
    // guarantees exactly one distinct warehouse per PO here.
    await queryRunner.query(
      `UPDATE purchase_orders po
       SET receiving_warehouse_id = r.warehouse_id
       FROM (
         SELECT purchase_order_id, (array_agg(warehouse_id ORDER BY created_at))[1] AS warehouse_id
         FROM purchase_receipts
         WHERE purchase_order_id IS NOT NULL
         GROUP BY purchase_order_id
         HAVING COUNT(DISTINCT warehouse_id) = 1
       ) r
       WHERE po.id = r.purchase_order_id AND po.receiving_warehouse_id IS NULL`,
    );

    // Audit trail: how much history stays NULL and why (never silently dropped).
    const counts = (await queryRunner.query(
      `SELECT
          COUNT(*) FILTER (WHERE po.receiving_warehouse_id IS NOT NULL) AS filled,
          COUNT(*) FILTER (WHERE po.receiving_warehouse_id IS NULL) AS unfilled,
          (SELECT COUNT(*) FROM (
             SELECT purchase_order_id FROM purchase_receipts
             WHERE purchase_order_id IS NOT NULL
             GROUP BY purchase_order_id
             HAVING COUNT(DISTINCT warehouse_id) > 1
           ) c) AS conflicting
       FROM purchase_orders po`,
    )) as Array<{ filled: string; unfilled: string; conflicting: string }>;
    const row = counts[0];
    // eslint-disable-next-line no-console
    console.log(
      `[migration add_purchase_orders_receiving_warehouse] filled=${row?.filled ?? 0} ` +
        `unfilled=${row?.unfilled ?? 0} conflicting_skipped=${row?.conflicting ?? 0}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS fk_purchase_orders_receiving_warehouse',
    );
    await queryRunner.query('ALTER TABLE purchase_orders DROP COLUMN receiving_warehouse_id');
  }
}
