import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 4: package item serials (task §18).
 *
 * Serial-tracked SKUs record the exact SN packed into each package item. The
 * serial_number is globally UNIQUE here: a physical unit can be packed by at
 * most one package at a time (rows are removed when an interception unpacks a
 * line, task §43). Packed SNs must already belong to the order item's
 * reservation - never another order's SN.
 */
export class CreatePackageItemSerials1789088400005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'package_item_serials',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'package_item_id', type: 'uuid', isNullable: false },
          { name: 'package_id', type: 'uuid', isNullable: false },
          { name: 'order_item_id', type: 'uuid', isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'serial_number', type: 'varchar', length: 255, isNullable: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_package_item_serials_serial', columnNames: ['serial_number'] }),
        ],
        indices: [
          new TableIndex({ name: 'idx_package_item_serials_package_item', columnNames: ['package_item_id'] }),
          new TableIndex({ name: 'idx_package_item_serials_package', columnNames: ['package_id'] }),
          new TableIndex({ name: 'idx_package_item_serials_order_item', columnNames: ['order_item_id'] }),
        ],
        foreignKeys: [
          {
            name: 'fk_package_item_serials_package_item',
            columnNames: ['package_item_id'],
            referencedTableName: 'package_items',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'fk_package_item_serials_package',
            columnNames: ['package_id'],
            referencedTableName: 'packages',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_package_item_serials_order_item',
            columnNames: ['order_item_id'],
            referencedTableName: 'order_items',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_package_item_serials_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('package_item_serials');
  }
}
