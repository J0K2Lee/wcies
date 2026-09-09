import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

/**
 * Sprint 4 follow-up: shipment_items become voidable instead of deletable.
 *
 * An interception return used to DELETE the snapshot row, which destroyed the
 * answer to "what did this shipment originally have to send, and why is that
 * line gone". The row is now kept as an auditable VOIDED record carrying who /
 * when / why / which source (e.g. the interception) voided it.
 *
 * Uniqueness is redefined as a PARTIAL index: an order line may have at most
 * one ACTIVE shipment_item at a time, while VOIDED history rows (possibly
 * several over time) never block a future re-fulfilment.
 *
 * Existing rows are explicitly backfilled to 'ACTIVE' before any CHECK /
 * partial-unique constraint is created - the backfill is never left to the
 * column DEFAULT alone.
 */
export class ExtendShipmentItemsVoid1789088400010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD COLUMN status VARCHAR(20) DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(`ALTER TABLE shipment_items ADD COLUMN voided_at TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE shipment_items ADD COLUMN voided_by UUID NULL`);
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD COLUMN voided_by_name VARCHAR(100) NULL`,
    );
    await queryRunner.query(`ALTER TABLE shipment_items ADD COLUMN void_reason TEXT NULL`);
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD COLUMN void_source_type VARCHAR(40) NULL`,
    );
    await queryRunner.query(`ALTER TABLE shipment_items ADD COLUMN void_source_id UUID NULL`);
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
    );

    // Explicit backfill of the historical rows (all Sprint 4 rows are ACTIVE).
    await queryRunner.query(`UPDATE shipment_items SET status = 'ACTIVE' WHERE status IS NULL`);

    await queryRunner.query(`ALTER TABLE shipment_items ALTER COLUMN status SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD CONSTRAINT ck_shipment_items_status CHECK (status IN ('ACTIVE', 'VOIDED'))`,
    );
    await queryRunner.createForeignKey(
      'shipment_items',
      new TableForeignKey({
        name: 'fk_shipment_items_voided_by',
        columnNames: ['voided_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
      }),
    );

    // One order line -> at most one ACTIVE shipment item, across all shipments.
    await queryRunner.query(
      `ALTER TABLE shipment_items DROP CONSTRAINT IF EXISTS uq_shipment_items_order_item`,
    );
    await queryRunner.query(
      `ALTER TABLE shipment_items DROP CONSTRAINT IF EXISTS uq_shipment_items_shipment_order_item`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_shipment_items_order_item_active ON shipment_items (order_item_id) WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items (shipment_id)`,
    );
    await queryRunner.query(`CREATE INDEX idx_shipment_items_status ON shipment_items (status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_shipment_items_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_shipment_items_order_item_active`);
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD CONSTRAINT uq_shipment_items_order_item UNIQUE (order_item_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE shipment_items ADD CONSTRAINT uq_shipment_items_shipment_order_item UNIQUE (shipment_id, order_item_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE shipment_items DROP CONSTRAINT IF EXISTS ck_shipment_items_status`,
    );
    await queryRunner.dropForeignKey('shipment_items', 'fk_shipment_items_voided_by');
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS updated_at`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS void_source_id`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS void_source_type`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS void_reason`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS voided_by_name`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS voided_by`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS voided_at`);
    await queryRunner.query(`ALTER TABLE shipment_items DROP COLUMN IF EXISTS status`);
  }
}
