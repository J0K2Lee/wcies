import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-05: OZON listing sync now chains a PRODUCT_ENRICHMENT_SYNC
 * automatically after a successful walk (two steps in one - the onboarding
 * weight/dims prefill no longer needs the manual 补齐 button). The chained
 * job records trigger_type = SYSTEM, which the ck_sync_jobs_trigger check
 * must accept.
 */
export class AddSyncTriggerSystem1791340000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sync_jobs DROP CONSTRAINT ck_sync_jobs_trigger`);
    await queryRunner.query(
      `ALTER TABLE sync_jobs ADD CONSTRAINT ck_sync_jobs_trigger
         CHECK (trigger_type IN ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY', 'SYSTEM'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SYSTEM rows cannot survive a downgrade (check constraint) - refuse.
    const system = await queryRunner.query(
      `SELECT id FROM sync_jobs WHERE trigger_type = 'SYSTEM' LIMIT 1`,
    );
    if (Array.isArray(system) && system.length > 0) {
      throw new Error('SYSTEM sync_jobs rows exist; resolve them before downgrading');
    }
    await queryRunner.query(`ALTER TABLE sync_jobs DROP CONSTRAINT ck_sync_jobs_trigger`);
    await queryRunner.query(
      `ALTER TABLE sync_jobs ADD CONSTRAINT ck_sync_jobs_trigger
         CHECK (trigger_type IN ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY'))`,
    );
  }
}
