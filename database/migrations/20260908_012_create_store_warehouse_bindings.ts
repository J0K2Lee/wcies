import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Sprint 1 S1-09: store N:M warehouse bindings (task §42-§45).
 * Fulfillment semantics live here; the warehouse itself never carries a
 * store_id. Warehouse-type compatibility is validated in the service layer.
 */
export class CreateStoreWarehouseBindings1789000800012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'store_warehouse_bindings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'fulfillment_mode', type: 'varchar', length: 50, isNullable: false },
          { name: 'platform_warehouse_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'is_inventory_source', type: 'boolean', isNullable: false, default: 'true' },
          { name: 'is_inventory_push_enabled', type: 'boolean', isNullable: false, default: 'false' },
          { name: 'priority', type: 'integer', isNullable: false, default: '100' },
          { name: 'settings', type: 'jsonb', isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_swb_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_swb_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'store_warehouse_bindings',
      new TableIndex({ name: 'idx_swb_store', columnNames: ['store_id'] }),
    );
    await queryRunner.createIndex(
      'store_warehouse_bindings',
      new TableIndex({ name: 'idx_swb_warehouse', columnNames: ['warehouse_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('store_warehouse_bindings');
  }
}
