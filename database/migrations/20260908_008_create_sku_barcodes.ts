import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 1 S1-05: sku_barcodes (task §28-§32).
 * - barcode globally unique (one barcode never maps two SKUs);
 * - partial unique index guarantees at most one primary per SKU;
 * - seq_internal_barcode backs generated INTERNAL codes (WCSKU%08d).
 */
export class CreateSkuBarcodes1789000800008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SEQUENCE seq_internal_barcode START 1');
    await queryRunner.createTable(
      new Table({
        name: 'sku_barcodes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'barcode', type: 'varchar', length: 255, isNullable: false },
          { name: 'barcode_type', type: 'varchar', length: 30, isNullable: false },
          { name: 'is_primary', type: 'boolean', isNullable: false, default: 'false' },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [{ name: 'uq_sku_barcodes_barcode', columnNames: ['barcode'] }],
        foreignKeys: [
          {
            name: 'fk_sku_barcodes_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'sku_barcodes',
      new TableIndex({ name: 'idx_sku_barcodes_sku', columnNames: ['sku_id'] }),
    );
    await queryRunner.query(
      "CREATE UNIQUE INDEX uq_sku_barcodes_one_primary ON sku_barcodes (sku_id) WHERE is_primary = true",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sku_barcodes');
    await queryRunner.query('DROP SEQUENCE seq_internal_barcode');
  }
}
