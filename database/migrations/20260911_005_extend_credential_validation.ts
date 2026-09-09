import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 5 task §33: credential validation metadata.
 *
 * Operators must see 已连接 / 认证失败 / 未验证 per store without re-running
 * validation. Only status + sanitized error text are stored - never secret
 * material (AGENTS.md §29).
 */
export class ExtendCredentialValidation1790000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_credentials ADD COLUMN last_validated_at TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE platform_credentials ADD COLUMN last_validation_status VARCHAR(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE platform_credentials ADD COLUMN last_validation_error TEXT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE platform_credentials ADD CONSTRAINT ck_platform_credentials_validation_status
       CHECK (last_validation_status IS NULL OR last_validation_status IN ('VALID', 'INVALID', 'ERROR'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_credentials DROP CONSTRAINT IF EXISTS ck_platform_credentials_validation_status`,
    );
    await queryRunner.query(`ALTER TABLE platform_credentials DROP COLUMN last_validation_error`);
    await queryRunner.query(`ALTER TABLE platform_credentials DROP COLUMN last_validation_status`);
    await queryRunner.query(`ALTER TABLE platform_credentials DROP COLUMN last_validated_at`);
  }
}
