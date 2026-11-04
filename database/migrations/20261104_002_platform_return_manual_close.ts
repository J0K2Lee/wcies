import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 平台退货记录的「已完结」手工标记（2026-11-04 用户修正口径）：
 *
 * 三种状态（待处理 / 处理中 / 已完结）都是**平台退货记录**的状态，不是批次状态。
 * - 待处理：还没被任何批次消费；
 * - 处理中：已入批次、还没收货入库；
 * - 已完结：批次里扫码收货/检验落定，或人工标记为已完结（实物不会再来）。
 *
 * 自动完结由批次行的 condition 派生；这里只存「人工完结」这一事实，
 * 避免维护一个会与批次数据漂移的冗余状态列。
 */
export class PlatformReturnManualClose1793980000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE platform_returns
        ADD COLUMN manually_closed_at timestamptz NULL,
        ADD COLUMN manually_closed_by uuid NULL,
        ADD COLUMN close_reason varchar(500) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE platform_returns
        DROP COLUMN IF EXISTS manually_closed_at,
        DROP COLUMN IF EXISTS manually_closed_by,
        DROP COLUMN IF EXISTS close_reason
    `);
  }
}
