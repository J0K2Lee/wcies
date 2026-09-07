import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 1 S1-08: warehouse_bins (task §38-§40).
 * Unique (warehouse_id, bin_code); same bin_code allowed in other warehouses.
 * Deliberately no sku_id: SKU<->Bin is N:M via future inventory records.
 */
export class CreateWarehouseBins1789000800011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'warehouse_bins',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'bin_code', type: 'varchar', length: 100, isNullable: false },
          { name: 'zone', type: 'varchar', length: 100, isNullable: true },
          { name: 'rack', type: 'varchar', length: 100, isNullable: true },
          { name: 'level', type: 'varchar', length: 100, isNullable: true },
          { name: 'position', type: 'varchar', length: 100, isNullable: true },
          { name: 'barcode', type: 'varchar', length: 255, isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          { name: 'uq_warehouse_bins_wh_code', columnNames: ['warehouse_id', 'bin_code'] },
        ],
        foreignKeys: [
          {
            name: 'fk_warehouse_bins_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'warehouse_bins',
      new TableIndex({ name: 'idx_warehouse_bins_warehouse', columnNames: ['warehouse_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('warehouse_bins');
  }
}
