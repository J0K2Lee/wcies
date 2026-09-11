import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 7 task §11 (T4): purchase receipts - the irreversible stock facts.
 *
 * Confirmation writes stock ONLY through InventoryService.receiveStockInTx
 * with reference PURCHASE_RECEIPT:<receiptId> (decision 0013 par5). Items
 * carry serial_numbers (jsonb string[]) so SN-tracked receiving keeps its
 * input record next to the quantity; the structured SN facts live in
 * inventory_serials as everywhere else.
 */
export class CreatePurchaseReceipts1791000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_no varchar(50) NOT NULL UNIQUE,
        purchase_order_id uuid NULL REFERENCES purchase_orders(id),
        supplier_id uuid NULL REFERENCES suppliers(id),
        source_note varchar(500) NULL,
        warehouse_id uuid NOT NULL REFERENCES warehouses(id),
        status varchar(30) NOT NULL DEFAULT 'DRAFT',
        received_at timestamptz NULL,
        remark text NULL,
        created_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_purchase_receipts_status CHECK (status IN ('DRAFT', 'RECEIVED', 'CANCELLED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_purchase_receipts_po ON purchase_receipts (purchase_order_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_receipts_warehouse ON purchase_receipts (warehouse_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_receipts_status ON purchase_receipts (status)`,
    );
    await queryRunner.query(`
      CREATE TABLE purchase_receipt_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_id uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
        purchase_order_item_id uuid NULL REFERENCES purchase_order_items(id),
        sku_id uuid NOT NULL REFERENCES skus(id),
        quantity numeric(18,3) NOT NULL,
        unit_cost numeric(18,4) NULL,
        bin_id uuid NULL REFERENCES warehouse_bins(id),
        serial_numbers jsonb NULL,
        remark text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_purchase_receipt_items_qty CHECK (quantity > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_purchase_receipt_items_receipt ON purchase_receipt_items (receipt_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_receipt_items_po_item ON purchase_receipt_items (purchase_order_item_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_receipt_items_sku ON purchase_receipt_items (sku_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE purchase_receipt_items`);
    await queryRunner.query(`DROP TABLE purchase_receipts`);
  }
}
