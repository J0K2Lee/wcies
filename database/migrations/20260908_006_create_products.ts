import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 1 S1-03: products + business-code sequence (task §15/§16).
 * main_image_id logically references sku_images (no FK: circular chain
 * products -> sku_images -> skus -> products).
 */
export class CreateProducts1789000800006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SEQUENCE seq_product_code START 1');
    await queryRunner.createTable(
      new Table({
        name: 'products',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'product_code', type: 'varchar', length: 100, isNullable: false },
          { name: 'name_zh', type: 'varchar', length: 500, isNullable: false },
          { name: 'name_ru', type: 'varchar', length: 500, isNullable: true },
          { name: 'category_id', type: 'uuid', isNullable: true },
          { name: 'brand_id', type: 'uuid', isNullable: true },
          { name: 'main_image_id', type: 'uuid', isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'DRAFT'` },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'created_by', type: 'uuid', isNullable: true },
          { name: 'updated_by', type: 'uuid', isNullable: true },
        ],
        uniques: [{ name: 'uq_products_product_code', columnNames: ['product_code'] }],
        foreignKeys: [
          {
            name: 'fk_products_category',
            columnNames: ['category_id'],
            referencedTableName: 'categories',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_products_brand',
            columnNames: ['brand_id'],
            referencedTableName: 'brands',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'products',
      new TableIndex({ name: 'idx_products_status', columnNames: ['status'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('products');
    await queryRunner.query('DROP SEQUENCE seq_product_code');
  }
}
