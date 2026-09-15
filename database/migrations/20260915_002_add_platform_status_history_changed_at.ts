import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dual-axis task T2 (2026-09-15): platform-side transition timestamp on the
 * platform status history rows.
 *
 * Webhook-sourced transitions carry the event payload's changed_state_date;
 * re-read-sourced ones carry the mapper's platformStageChangedAt. Neither is
 * backfilled for historical rows - created_at (our observation time) remains
 * the fallback, so NULL simply means "we only know when WE saw it"
 * (docs/business-rules/orders.md §2.4 anchor rules).
 */
export class AddPlatformStatusHistoryChangedAt1791500002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_status_history ADD COLUMN platform_changed_at timestamptz NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_status_history DROP COLUMN platform_changed_at`,
    );
  }
}
