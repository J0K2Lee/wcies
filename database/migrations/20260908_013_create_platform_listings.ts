import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 1 S1-10: platform_listings (task §46).
 * Unique (store_id, platform_product_id); the same platform product id may
 * exist under another store.
 */
export class CreatePlatformListings1789000800013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'platform_listings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'platform_id', type: 'uuid', isNullable: false },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'platform_product_id', type: 'varchar', length: 255, isNullable: false },
          { name: 'title', type: 'text', isNullable: true },
          { name: 'url', type: 'text', isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'raw_data', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          {
            name: 'uq_platform_listings_store_ppid',
            columnNames: ['store_id', 'platform_product_id'],
          },
        ],
        foreignKeys: [
          {
            name: 'fk_platform_listings_platform',
            columnNames: ['platform_id'],
            referencedTableName: 'platforms',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_platform_listings_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'platform_listings',
      new TableIndex({ name: 'idx_platform_listings_platform', columnNames: ['platform_id'] }),
    );
    await queryRunner.createIndex(
      'platform_listings',
      new TableIndex({ name: 'idx_platform_listings_store', columnNames: ['store_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('platform_listings');
  }
}
