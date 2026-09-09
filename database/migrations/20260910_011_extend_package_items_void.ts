import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

/**
 * Sprint 4 follow-up: package_items / package_item_serials become voidable
 * instead of deletable (same audit pattern as shipment_items).
 *
 * Unpacking an intercepted line used to DELETE package_items (and cascade the
 * packed serials away), so the shipment-level audit trail would have survived
 * while the package-level one stayed broken. Both are now kept as VOIDED
 * history carrying who / when / why / which source voided them.
 *
 * The packed serial unique index MUST become partial as well: keeping a VOIDED
 * serial row while re-packing the same SN into another package after a
 * REPACK_REQUIRED would otherwise violate the global UNIQUE(serial_number).
 *
 * Existing rows are explicitly backfilled to 'ACTIVE' before any CHECK or
 * partial-unique index is created.
 */
export class ExtendPackageItemsVoid1789088400011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- package_items -----------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE package_items ADD COLUMN status VARCHAR(20) DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(`ALTER TABLE package_items ADD COLUMN voided_at TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE package_items ADD COLUMN voided_by UUID NULL`);
    await queryRunner.query(
      `ALTER TABLE package_items ADD COLUMN voided_by_name VARCHAR(100) NULL`,
    );
    await queryRunner.query(`ALTER TABLE package_items ADD COLUMN void_reason TEXT NULL`);
    await queryRunner.query(
      `ALTER TABLE package_items ADD COLUMN void_source_type VARCHAR(40) NULL`,
    );
    await queryRunner.query(`ALTER TABLE package_items ADD COLUMN void_source_id UUID NULL`);
    await queryRunner.query(`UPDATE package_items SET status = 'ACTIVE' WHERE status IS NULL`);
    await queryRunner.query(`ALTER TABLE package_items ALTER COLUMN status SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE package_items ADD CONSTRAINT ck_package_items_status CHECK (status IN ('ACTIVE', 'VOIDED'))`,
    );
    await queryRunner.createForeignKey(
      'package_items',
      new TableForeignKey({
        name: 'fk_package_items_voided_by',
        columnNames: ['voided_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
      }),
    );
    // One ACTIVE line per (package, order item); VOIDED history rows may repeat.
    await queryRunner.query(
      `ALTER TABLE package_items DROP CONSTRAINT IF EXISTS uq_package_items_package_order_item`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_package_items_package_order_item_active ON package_items (package_id, order_item_id) WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(`CREATE INDEX idx_package_items_status ON package_items (status)`);

    // ---- package_item_serials ---------------------------------------------
    await queryRunner.query(
      `ALTER TABLE package_item_serials ADD COLUMN status VARCHAR(20) DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE package_item_serials ADD COLUMN voided_at TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(`ALTER TABLE package_item_serials ADD COLUMN voided_by UUID NULL`);
    await queryRunner.query(
      `UPDATE package_item_serials SET status = 'ACTIVE' WHERE status IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE package_item_serials ALTER COLUMN status SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE package_item_serials ADD CONSTRAINT ck_package_item_serials_status CHECK (status IN ('ACTIVE', 'VOIDED'))`,
    );
    await queryRunner.createForeignKey(
      'package_item_serials',
      new TableForeignKey({
        name: 'fk_package_item_serials_voided_by',
        columnNames: ['voided_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
      }),
    );
    await queryRunner.query(
      `ALTER TABLE package_item_serials DROP CONSTRAINT IF EXISTS uq_package_item_serials_serial`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_package_item_serials_serial_active ON package_item_serials (serial_number) WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_package_item_serials_status ON package_item_serials (status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_package_item_serials_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_package_item_serials_serial_active`);
    await queryRunner.query(
      `ALTER TABLE package_item_serials ADD CONSTRAINT uq_package_item_serials_serial UNIQUE (serial_number)`,
    );
    await queryRunner.query(
      `ALTER TABLE package_item_serials DROP CONSTRAINT IF EXISTS ck_package_item_serials_status`,
    );
    await queryRunner.dropForeignKey('package_item_serials', 'fk_package_item_serials_voided_by');
    await queryRunner.query(`ALTER TABLE package_item_serials DROP COLUMN IF EXISTS voided_by`);
    await queryRunner.query(`ALTER TABLE package_item_serials DROP COLUMN IF EXISTS voided_at`);
    await queryRunner.query(`ALTER TABLE package_item_serials DROP COLUMN IF EXISTS status`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_package_items_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_package_items_package_order_item_active`);
    await queryRunner.query(
      `ALTER TABLE package_items ADD CONSTRAINT uq_package_items_package_order_item UNIQUE (package_id, order_item_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE package_items DROP CONSTRAINT IF EXISTS ck_package_items_status`,
    );
    await queryRunner.dropForeignKey('package_items', 'fk_package_items_voided_by');
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS void_source_id`);
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS void_source_type`);
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS void_reason`);
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS voided_by_name`);
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS voided_by`);
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS voided_at`);
    await queryRunner.query(`ALTER TABLE package_items DROP COLUMN IF EXISTS status`);
  }
}
