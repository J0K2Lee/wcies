import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Sprint 1 S1-11: platform_listing_skus (task §47/§50).
 *
 * Deliberately NO unique constraints besides the PK:
 * - no UNIQUE(sku_id, store_id): one internal SKU maps to many listings,
 *   even within the same store (task §48);
 * - platform identifiers (platform_sku_id / seller_sku / offer_id) only get
 *   plain indexes; per-platform uniqueness is added once real platform APIs
 *   confirm the semantics (task §50).
 */
export class CreatePlatformListingSkus1789000800014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'platform_listing_skus',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'listing_id', type: 'uuid', isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'platform_sku_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'seller_sku', type: 'varchar', length: 255, isNullable: true },
          { name: 'offer_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'raw_data', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_pls_listing',
            columnNames: ['listing_id'],
            referencedTableName: 'platform_listings',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_pls_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'platform_listing_skus',
      new TableIndex({ name: 'idx_pls_listing', columnNames: ['listing_id'] }),
    );
    await queryRunner.createIndex(
      'platform_listing_skus',
      new TableIndex({ name: 'idx_pls_sku', columnNames: ['sku_id'] }),
    );
    await queryRunner.createIndex(
      'platform_listing_skus',
      new TableIndex({ name: 'idx_pls_platform_sku_id', columnNames: ['platform_sku_id'] }),
    );
    await queryRunner.createIndex(
      'platform_listing_skus',
      new TableIndex({ name: 'idx_pls_offer_id', columnNames: ['offer_id'] }),
    );
    await queryRunner.createIndex(
      'platform_listing_skus',
      new TableIndex({ name: 'idx_pls_seller_sku', columnNames: ['seller_sku'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('platform_listing_skus');
  }
}
