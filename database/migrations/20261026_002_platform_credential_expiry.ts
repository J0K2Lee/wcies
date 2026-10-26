import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * API Key 有效期（2026-10-26，用户需求）：
 * - 各平台可能强制 Key 过期，绑定凭证时必须声明「到期日」或「长期有效」；
 * - `validity_declared_at` 为 NULL = **尚未声明**，扫描跳过、界面提示补全；
 * - 存量回填（用户指示 2026-10-26）：OZON / WB 按「绑定时间 + 90 天」预设，
 *   Yandex 预设为长期——两者都标记为已声明，扫描从下一天开始按规则提醒。
 */
export class PlatformCredentialExpiry1793090000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_credentials
         ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL,
         ADD COLUMN IF NOT EXISTS validity_declared_at timestamptz NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_platform_credentials_expiry
         ON platform_credentials (status, expires_at)`,
    );
    // 存量凭证按平台预设有效期（用户指示 2026-10-26）：
    //   OZON / WB → 绑定时间（created_at）+ 90 天；Yandex → 长期（NULL）。
    // 只回填尚未声明的行，重复执行不会覆盖运营后来手工修改的值。
    await queryRunner.query(`
      UPDATE platform_credentials pc
         SET validity_declared_at = now(),
             expires_at = CASE
               WHEN p.code IN ('OZON', 'WB') THEN pc.created_at + interval '90 days'
               ELSE NULL
             END
        FROM stores s
        JOIN platforms p ON p.id = s.platform_id
       WHERE s.id = pc.store_id
         AND pc.validity_declared_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_platform_credentials_expiry`);
    await queryRunner.query(
      `ALTER TABLE platform_credentials
         DROP COLUMN IF EXISTS validity_declared_at,
         DROP COLUMN IF EXISTS expires_at`,
    );
  }
}
