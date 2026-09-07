import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 1 S1-06: sku_images (task §33/§34). Binary lives in object storage
 * (private bucket, signed URLs); at most one primary per SKU via partial
 * unique index.
 */
export class CreateSkuImages1789000800009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'sku_images',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'object_key', type: 'text', isNullable: false },
          { name: 'mime_type', type: 'varchar', length: 100, isNullable: false },
          { name: 'file_size', type: 'bigint', isNullable: false },
          { name: 'width', type: 'integer', isNullable: true },
          { name: 'height', type: 'integer', isNullable: true },
          { name: 'sort_order', type: 'integer', isNullable: false, default: '0' },
          { name: 'is_primary', type: 'boolean', isNullable: false, default: 'false' },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_sku_images_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'sku_images',
      new TableIndex({ name: 'idx_sku_images_sku', columnNames: ['sku_id'] }),
    );
    await queryRunner.query(
      "CREATE UNIQUE INDEX uq_sku_images_one_primary ON sku_images (sku_id) WHERE is_primary = true",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sku_images');
  }
}
