import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Order fulfillment flow (2026-09-18): platform waybill number + order-scoped
 * platform labels.
 *
 * 1. `orders.platform_tracking_no` - the platform's OWN waybill/tracking
 *    number (OZON `tracking_number`). A platform FACT for display and for
 *    filling the internal Shipment's tracking number at outbound time. This is
 *    NOT the banned `orders.tracking_number` logistics model (orders.md §3):
 *    Shipment / Package stay the only logistics carrier (AGENTS.md §37), this
 *    column is a read-only fact slot like platform_status / platform_stage.
 *
 * 2. `shipping_labels.order_id` + nullable `shipment_id` - the platform label
 *    can be fetched as soon as the platform accepts the order for dispatch,
 *    which is BEFORE an internal Shipment exists (a Shipment may only be
 *    created from PICKED lines, orders.md §15A 进入条件). `shipping_labels`
 *    stays THE single 面单 home instead of growing a parallel table
 *    (AGENTS.md §85/§99); every existing row keeps its shipment_id and is
 *    untouched.
 */
export class OrderPlatformShipping1791759201000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN platform_tracking_no varchar(255) NULL`);

    // Best-effort backfill from the verbatim raw_data (AGENTS.md §34): today
    // the value only lives there. Non-string / empty values keep NULL - never
    // guess a coerced number (AGENTS.md §89).
    await queryRunner.query(
      `UPDATE orders
          SET platform_tracking_no = NULLIF(btrim(raw_data->>'tracking_number'), '')
        WHERE platform_tracking_no IS NULL
          AND jsonb_typeof(raw_data->'tracking_number') = 'string'`,
    );

    await queryRunner.query(`ALTER TABLE shipping_labels ADD COLUMN order_id uuid NULL`);
    await queryRunner.query(`ALTER TABLE shipping_labels ALTER COLUMN shipment_id DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE shipping_labels
         ADD CONSTRAINT fk_shipping_labels_order
         FOREIGN KEY (order_id) REFERENCES orders(id)`,
    );
    // A label must always belong to SOMETHING (order-level or shipment-level).
    await queryRunner.query(
      `ALTER TABLE shipping_labels
         ADD CONSTRAINT ck_shipping_labels_owner
         CHECK (shipment_id IS NOT NULL OR order_id IS NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_shipping_labels_order ON shipping_labels (order_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_shipping_labels_order`);
    await queryRunner.query(
      `ALTER TABLE shipping_labels DROP CONSTRAINT IF EXISTS ck_shipping_labels_owner`,
    );
    await queryRunner.query(
      `ALTER TABLE shipping_labels DROP CONSTRAINT IF EXISTS fk_shipping_labels_order`,
    );
    await queryRunner.query(`ALTER TABLE shipping_labels DROP COLUMN order_id`);
    // Order-scoped labels have no shipment to fall back to; removing the rows
    // is the only way back to NOT NULL (their object-storage files remain).
    await queryRunner.query(`DELETE FROM shipping_labels WHERE shipment_id IS NULL`);
    await queryRunner.query(`ALTER TABLE shipping_labels ALTER COLUMN shipment_id SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN platform_tracking_no`);
  }
}
