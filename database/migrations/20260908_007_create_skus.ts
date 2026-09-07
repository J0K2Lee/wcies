import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 1 S1-04: internal SKUs + sku-code sequence (task §20/§21).
 * volume_cm3 is written only by the backend (task §23); moving_average_cost
 * is a reserved column and stays null until the purchase sprint (task §24).
 */
export class CreateSkus1789000800007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SEQUENCE seq_sku_code START 1');
    await queryRunner.createTable(
      new Table({
        name: 'skus',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'product_id', type: 'uuid', isNullable: false },
          { name: 'sku_code', type: 'varchar', length: 100, isNullable: false },
          { name: 'name_zh', type: 'varchar', length: 500, isNullable: false },
          { name: 'name_ru', type: 'varchar', length: 500, isNullable: true },
          { name: 'model', type: 'varchar', length: 200, isNullable: true },
          { name: 'color', type: 'varchar', length: 100, isNullable: true },
          { name: 'size', type: 'varchar', length: 100, isNullable: true },
          { name: 'weight_kg', type: 'numeric', precision: 12, scale: 4, isNullable: true },
          { name: 'length_cm', type: 'numeric', precision: 12, scale: 3, isNullable: true },
          { name: 'width_cm', type: 'numeric', precision: 12, scale: 3, isNullable: true },
          { name: 'height_cm', type: 'numeric', precision: 12, scale: 3, isNullable: true },
          { name: 'volume_cm3', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'latest_purchase_price', type: 'numeric', precision: 18, scale: 4, isNullable: true },
          { name: 'moving_average_cost', type: 'numeric', precision: 18, scale: 4, isNullable: true },
          { name: 'cost_currency', type: 'varchar', length: 10, isNullable: false, default: `'CNY'` },
          { name: 'serial_tracking', type: 'boolean', isNullable: false, default: 'false' },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [{ name: 'uq_skus_sku_code', columnNames: ['sku_code'] }],
        foreignKeys: [
          {
            name: 'fk_skus_product',
            columnNames: ['product_id'],
            referencedTableName: 'products',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'skus',
      new TableIndex({ name: 'idx_skus_product', columnNames: ['product_id'] }),
    );
    await queryRunner.createIndex(
      'skus',
      new TableIndex({ name: 'idx_skus_status', columnNames: ['status'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('skus');
    await queryRunner.query('DROP SEQUENCE seq_sku_code');
  }
}
