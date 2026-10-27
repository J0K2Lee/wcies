import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 系统参数表（2026-10-27，用户要求「回读频率要有 UI」）：第一个使用的键是
 * 订单平台事实回读的分阶段阈值（见 SystemSettingsService）。
 *
 * 只做通用 key/value，不把每个参数做成列——参数会继续增加（回读、批大小、
 * 清理周期…），列会不断迁移。值统一 JSONB，读取方负责形状校验。
 */
export class SystemSettings1793091000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key varchar(80) PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid NULL
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE system_settings IS
        '系统级运行参数（JSONB）；缺省值写在代码里，这里只存运营改过的覆盖值'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS system_settings`);
  }
}
