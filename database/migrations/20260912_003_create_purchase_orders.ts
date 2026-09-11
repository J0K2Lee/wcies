import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 7 task §10 (T3): purchase registration documents.
 *
 * A purchase order registers INTENT (already bought?) and never touches
 * stock - that is what separates it from the receipt (T4, decision 0013).
 * order_item_id is nullable: stock-up purchases have no order to link.
 * Anti-duplicate ordering is enforced by the service (a line may be
 * re-registered after its PO is cancelled), not by a DB unique index.
 */
export class CreatePurchaseOrders1791000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        po_no varchar(50) NOT NULL UNIQUE,
        supplier_id uuid NULL REFERENCES suppliers(id),
        source_note varchar(500) NULL,
        status varchar(30) NOT NULL DEFAULT 'ORDERED',
        ordered_at timestamptz NOT NULL DEFAULT now(),
        expected_at timestamptz NULL,
        remark text NULL,
        created_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_purchase_orders_status
          CHECK (status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_purchase_orders_supplier ON purchase_orders (supplier_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_orders_status ON purchase_orders (status)`,
    );
    await queryRunner.query(`
      CREATE TABLE purchase_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        sku_id uuid NOT NULL REFERENCES skus(id),
        order_item_id uuid NULL REFERENCES order_items(id),
        quantity numeric(18,3) NOT NULL,
        unit_cost numeric(18,4) NULL,
        received_quantity numeric(18,3) NOT NULL DEFAULT 0,
        remark text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_purchase_order_items_qty CHECK (quantity > 0),
        CONSTRAINT ck_purchase_order_items_received CHECK (received_quantity >= 0 AND received_quantity <= quantity)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_purchase_order_items_po ON purchase_order_items (po_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_order_items_order_item ON purchase_order_items (order_item_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_purchase_order_items_sku ON purchase_order_items (sku_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE purchase_order_items`);
    await queryRunner.query(`DROP TABLE purchase_orders`);
  }
}
