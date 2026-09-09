import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 5 task §58: order sync provenance.
 *
 * `orders.sync_source` records HOW the order entered WCIES (manual API ingest
 * vs scheduled polling vs webhook catch-up) so the order detail page can show
 * "Sync Source" to admins. NULL = ingested before Sprint 5.
 */
export class AddOrdersSyncSource1790000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN sync_source VARCHAR(30) NULL`);
    await queryRunner.query(
      `ALTER TABLE orders ADD CONSTRAINT ck_orders_sync_source
       CHECK (sync_source IS NULL OR sync_source IN ('MANUAL', 'API', 'POLLING', 'WEBHOOK'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_orders_sync_source`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN sync_source`);
  }
}
