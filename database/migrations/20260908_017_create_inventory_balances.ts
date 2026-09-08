import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 2: physical inventory balances (task §5-§9).
 *
 * One row per (sku, warehouse, bin, condition). Quantities are NUMERIC(18,3)
 * and DB-checked non-negative with reserved+picked <= on_hand; bin_id is
 * NOT NULL - warehouses without physical bins use a virtual DEFAULT bin
 * (task §6). Balance rows are kept even at zero so "record with 0" stays
 * distinguishable from "never initialized" (task §78 / §89).
 */
export class CreateInventoryBalances1789000800017 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'inventory_balances',
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
          { name: 'bin_id', type: 'uuid', isNullable: false },
          { name: 'inventory_condition', type: 'varchar', length: 30, isNullable: false, default: "'SELLABLE'" },
          { name: 'on_hand_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'reserved_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'picked_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'version', type: 'bigint', isNullable: false, default: '0' },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_inventory_balances_dim',
            columnNames: ['sku_id', 'warehouse_id', 'bin_id', 'inventory_condition'],
          }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_inventory_balances_non_negative',
            expression: 'on_hand_qty >= 0 AND reserved_qty >= 0 AND picked_qty >= 0',
          }),
          new TableCheck({ name: 'ck_inventory_balances_occupancy', expression: `reserved_qty + picked_qty <= on_hand_qty` }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_balances_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_balances_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_balances_bin',
            columnNames: ['bin_id'],
            referencedTableName: 'warehouse_bins',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'inventory_balances',
      new TableIndex({ name: 'idx_inventory_balances_wh_sku', columnNames: ['warehouse_id', 'sku_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_balances');
  }
}
