import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3 (S3-SN): inventory serials (task §42-§44).
 *
 * Serials are per-unit TRACKING detail, never a second stock fact source -
 * quantities remain on inventory_balances; both are written in the same
 * transaction. SHIPPED is reserved for the Shipment sprint.
 */
export class CreateInventorySerials1789002000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'inventory_serials',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'serial_number', type: 'varchar', length: 255, isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'bin_id', type: 'uuid', isNullable: true },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: `'IN_STOCK'` },
          { name: 'reservation_id', type: 'uuid', isNullable: true },
          { name: 'picking_task_item_id', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [new TableUnique({ name: 'uq_inventory_serials_serial', columnNames: ['serial_number'] })],
        indices: [
          new TableIndex({
            name: 'idx_inventory_serials_sku_wh_status',
            columnNames: ['sku_id', 'warehouse_id', 'status'],
          }),
          new TableIndex({ name: 'idx_inventory_serials_reservation', columnNames: ['reservation_id'] }),
          new TableIndex({ name: 'idx_inventory_serials_picking_item', columnNames: ['picking_task_item_id'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_inventory_serials_status',
            expression: "status IN ('IN_STOCK', 'RESERVED', 'PICKED', 'SHIPPED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_serials_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_serials_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_serials_bin',
            columnNames: ['bin_id'],
            referencedTableName: 'warehouse_bins',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_serials_reservation',
            columnNames: ['reservation_id'],
            referencedTableName: 'inventory_reservations',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_serials');
  }
}
