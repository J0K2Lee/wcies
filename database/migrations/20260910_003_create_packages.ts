import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 4: packages (task §10-§12/§44).
 *
 * Shipment 1:N Package, Package 1:N items (multi-SKU). REPACK_REQUIRED is the
 * auditable "sealed package lost a line to an interception" state (task §44
 * recommends it over silently re-opening).
 */
export class CreatePackages1789088400003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE package_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'packages',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'package_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'shipment_id', type: 'uuid', isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'OPEN'` },
          { name: 'tracking_number', type: 'varchar', length: 255, isNullable: true },
          { name: 'label_file_id', type: 'uuid', isNullable: true },
          { name: 'weight_kg', type: 'numeric', precision: 12, scale: 3, isNullable: true },
          { name: 'length_cm', type: 'numeric', precision: 12, scale: 2, isNullable: true },
          { name: 'width_cm', type: 'numeric', precision: 12, scale: 2, isNullable: true },
          { name: 'height_cm', type: 'numeric', precision: 12, scale: 2, isNullable: true },
          { name: 'sealed_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [new TableUnique({ name: 'uq_packages_no', columnNames: ['package_no'] })],
        indices: [
          new TableIndex({ name: 'idx_packages_shipment', columnNames: ['shipment_id'] }),
          new TableIndex({ name: 'idx_packages_status', columnNames: ['status'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_packages_status',
            expression: "status IN ('OPEN', 'SEALED', 'SHIPPED', 'CANCELLED', 'REPACK_REQUIRED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_packages_shipment',
            columnNames: ['shipment_id'],
            referencedTableName: 'shipments',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('packages');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS package_no_seq`);
  }
}
