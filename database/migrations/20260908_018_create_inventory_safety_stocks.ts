import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableUnique } from 'typeorm';

/**
 * Sprint 2: safety stock policy per (sku, warehouse) (task §11-§12).
 * Safety stock is an inventory POLICY, never a physical movement: it does
 * not touch balances and produces no InventoryTransaction
 * (inventory.md §41).
 */
export class CreateInventorySafetyStocks1789000800018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'inventory_safety_stocks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'safety_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_inventory_safety_stocks_dim',
            columnNames: ['sku_id', 'warehouse_id'],
          }),
        ],
        checks: [
          new TableCheck({ name: 'ck_inventory_safety_stocks_non_negative', expression: 'safety_qty >= 0' }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_safety_stocks_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_safety_stocks_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_safety_stocks');
  }
}
