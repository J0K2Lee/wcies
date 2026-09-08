import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Sprint 4: shipping labels (task §19-§20).
 *
 * Platform-agnostic label metadata: Sprint 4 only supports MANUAL_UPLOAD via
 * ObjectStorageService (private bucket + signed URLs); PLATFORM_API is a
 * reserved value for the platform-integration sprint. File bytes never live
 * in the DB - only the object key.
 */
export class CreateShippingLabels1789088400006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'shipping_labels',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'shipment_id', type: 'uuid', isNullable: false },
          { name: 'package_id', type: 'uuid', isNullable: true },
          { name: 'label_type', type: 'varchar', length: 30, isNullable: false, default: `'SHIPPING'` },
          { name: 'object_key', type: 'varchar', length: 500, isNullable: false },
          { name: 'file_name', type: 'varchar', length: 255, isNullable: false },
          { name: 'mime_type', type: 'varchar', length: 100, isNullable: false },
          { name: 'file_size', type: 'integer', isNullable: false },
          { name: 'source', type: 'varchar', length: 30, isNullable: false, default: `'MANUAL_UPLOAD'` },
          { name: 'external_label_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'uploaded_by', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        indices: [
          new TableIndex({ name: 'idx_shipping_labels_shipment', columnNames: ['shipment_id'] }),
          new TableIndex({ name: 'idx_shipping_labels_package', columnNames: ['package_id'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_shipping_labels_source',
            expression: "source IN ('MANUAL_UPLOAD', 'PLATFORM_API')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_shipping_labels_shipment',
            columnNames: ['shipment_id'],
            referencedTableName: 'shipments',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'fk_shipping_labels_package',
            columnNames: ['package_id'],
            referencedTableName: 'packages',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shipping_labels');
  }
}
