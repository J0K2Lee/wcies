import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 5 task §18-§20: platform listing SKUs can exist UNMAPPED.
 *
 * `platform_listing_skus.sku_id` becomes nullable and a `mapping_status`
 * column distinguishes UNMAPPED (synced from the platform, awaiting a human
 * mapping) from MAPPED. The resolver only resolves MAPPED rows - synced
 * listings never guess an internal SKU (task §37).
 *
 * `platform_listings.last_seen_at` records the last full sync that observed
 * the listing; a listing missing from a sync is NEVER auto-deleted (§20).
 *
 * The partial unique index makes platform-SKU upserts idempotent per listing:
 * repeated listing syncs must not create duplicate rows (which would make
 * the resolver ambiguous). It fails loudly on pre-existing duplicates rather
 * than silently rewriting data (AGENTS.md §89).
 */
export class ExtendListingMappingState1790000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Guard: refuse to run on data that already violates the new uniqueness
    // (fail loudly instead of silently picking winners).
    const duplicates = await queryRunner.query(`
      SELECT listing_id, platform_sku_id, COUNT(*) AS n
      FROM platform_listing_skus
      WHERE platform_sku_id IS NOT NULL AND status = 'ACTIVE'
      GROUP BY listing_id, platform_sku_id
      HAVING COUNT(*) > 1
      LIMIT 1
    `);
    if (Array.isArray(duplicates) && duplicates.length > 0) {
      throw new Error(
        'platform_listing_skus contains ACTIVE duplicate (listing_id, platform_sku_id) rows; ' +
          'resolve them explicitly before running this migration',
      );
    }

    await queryRunner.query(`ALTER TABLE platform_listing_skus ALTER COLUMN sku_id DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE platform_listing_skus ADD COLUMN mapping_status VARCHAR(20) NOT NULL DEFAULT 'UNMAPPED'`,
    );
    // Explicit backfill: existing rows all carry an internal SKU.
    await queryRunner.query(
      `UPDATE platform_listing_skus SET mapping_status = 'MAPPED' WHERE sku_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE platform_listing_skus ADD CONSTRAINT ck_pls_mapping_status
       CHECK (mapping_status IN ('UNMAPPED', 'MAPPED'))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_pls_listing_platform_sku_active
       ON platform_listing_skus (listing_id, platform_sku_id)
       WHERE platform_sku_id IS NOT NULL AND status = 'ACTIVE'`,
    );

    await queryRunner.query(`ALTER TABLE platform_listings ADD COLUMN last_seen_at TIMESTAMPTZ NULL`);
    await queryRunner.query(
      `UPDATE platform_listings SET last_seen_at = updated_at WHERE last_seen_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE platform_listings DROP COLUMN last_seen_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_pls_listing_platform_sku_active`);
    await queryRunner.query(`ALTER TABLE platform_listing_skus DROP CONSTRAINT IF EXISTS ck_pls_mapping_status`);
    // UNMAPPED rows cannot survive a downgrade (sku_id NOT NULL) - refuse.
    const unmapped = await queryRunner.query(
      `SELECT id FROM platform_listing_skus WHERE sku_id IS NULL LIMIT 1`,
    );
    if (Array.isArray(unmapped) && unmapped.length > 0) {
      throw new Error('UNMAPPED platform_listing_skus rows exist; map or delete them before downgrading');
    }
    await queryRunner.query(`ALTER TABLE platform_listing_skus DROP COLUMN mapping_status`);
    await queryRunner.query(`ALTER TABLE platform_listing_skus ALTER COLUMN sku_id SET NOT NULL`);
  }
}
