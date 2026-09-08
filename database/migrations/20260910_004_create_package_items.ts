import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 4: package items (task §11).
 *
 * One package holds many SKUs; quantities accumulate per (package, order
 * item). An order's picked goods may be split across several packages of the
 * same (or different) shipments.
 */
export class CreatePackageItems1789088400004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'package_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'package_id', type: 'uuid', isNullable: false },
          { name: 'order_item_id', type: 'uuid', isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'quantity', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_package_items_package_order_item', columnNames: ['package_id', 'order_item_id'] }),
        ],
        indices: [
          new TableIndex({ name: 'idx_package_items_package', columnNames: ['package_id'] }),
          new TableIndex({ name: 'idx_package_items_order_item', columnNames: ['order_item_id'] }),
        ],
        checks: [new TableCheck({ name: 'ck_package_items_qty_positive', expression: 'quantity >= 0' })],
        foreignKeys: [
          {
            name: 'fk_package_items_package',
            columnNames: ['package_id'],
            referencedTableName: 'packages',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'fk_package_items_order_item',
            columnNames: ['order_item_id'],
            referencedTableName: 'order_items',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_package_items_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('package_items');
  }
}
