import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * User management (2026-10-05, docs/business-rules/users.md):
 *
 * - users.email_verified_at: NULL until the mailbox is proven via a
 *   verification link. Pre-existing accounts predate the verification
 *   system, so their emails are backfilled as verified.
 * - users.password_changed_at: issuing ground for JWT session revocation -
 *   cookies signed before a password change stop authenticating.
 * - email_verification_tokens: single-use hashed tokens for the three
 *   flows (INVITE / PASSWORD_CHANGE / EMAIL_CHANGE). Only the SHA-256
 *   hash is stored; the raw token lives solely in the email link.
 */
export class UserEmailVerification1793150000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN email_verified_at timestamptz NULL`);
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `UPDATE users SET email_verified_at = now() WHERE email IS NOT NULL AND email_verified_at IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE email_verification_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose     varchar(30) NOT NULL,
        email       varchar(255) NOT NULL,
        token_hash  varchar(64) NOT NULL UNIQUE,
        expires_at  timestamptz NOT NULL,
        consumed_at timestamptz NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_evt_user_purpose ON email_verification_tokens (user_id, purpose)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_verification_tokens`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN password_changed_at`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN email_verified_at`);
  }
}
