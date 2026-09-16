import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 10 T3: warehouse-to-warehouse transfer orders
 * (docs/business-rules/transfer.md, frozen 2026-09-17).
 *
 * DRAFT -> CONFIRMED (single transaction moves every line through the
 * inventory TRANSFER_OUT/TRANSFER_IN primitives) | DRAFT -> CANCELLED.
 * The order itself carries no money; both legs are booked against the
 * inventory ledger with referenceId = transfer line id (transfer.md §5).
 */
export class CreateTransfers1791600003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE transfer_orders (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transfer_no        varchar(50) NOT NULL UNIQUE,
        from_warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
        to_warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
        status             varchar(20) NOT NULL DEFAULT 'DRAFT',
        remark             text NULL,
        created_by         uuid NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_transfer_orders_warehouses_different CHECK (from_warehouse_id <> to_warehouse_id),
        CONSTRAINT ck_transfer_orders_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED'))
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_transfer_orders_status ON transfer_orders (status, created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE transfer_order_lines (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transfer_id    uuid NOT NULL REFERENCES transfer_orders(id),
        sku_id         uuid NOT NULL REFERENCES skus(id),
        quantity       numeric(18,3) NOT NULL,
        from_bin_id    uuid NULL,
        to_bin_id      uuid NULL,
        out_event_no   varchar(50) NULL,
        in_event_no    varchar(50) NULL,
        remark         text NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_transfer_lines_quantity_positive CHECK (quantity > 0)
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_transfer_order_lines_transfer ON transfer_order_lines (transfer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transfer_order_lines_sku ON transfer_order_lines (sku_id)`,
    );

    await queryRunner.query(`
      INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
      VALUES ('transfer_order', 1, now())
      ON CONFLICT (scope_key) DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transfer_order_lines`);
    await queryRunner.query(`DROP TABLE IF EXISTS transfer_orders`);
    await queryRunner.query(
      `DELETE FROM business_code_sequences WHERE scope_key = 'transfer_order'`,
    );
  }
}
