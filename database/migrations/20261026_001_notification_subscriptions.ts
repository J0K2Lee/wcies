import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 通知订阅与未读（2026-10-26）。
 *
 * 模型：
 * - `notifications`          事件本体（站内事件流，全局可见，不变）
 * - `notification_reads`     每人每事件的已读状态（未读 = 事件存在但没有 read 行）
 * - `user_channel_bindings`  每人每通道的投递地址（飞书 open_id / 邮箱…）
 * - `notification_subscriptions` 每人 × 通道 × 事件 × 条件（AND）→ 是否推送
 * - `notification_deliveries` 每次推送尝试（状态、重试、错误）
 *
 * 默认**没有任何订阅**（用户指示 2026-10-26）：想收推送必须自己订阅；
 * 站内事件流不受订阅影响（始终记录）。
 */
export class NotificationSubscriptions1793030000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 事件去重键：同一事件（如某个拦截任务失败）在窗口内只记一条。
    await queryRunner.query(
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key varchar(200)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_type_dedupe
         ON notifications (type, dedupe_key, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE notification_reads (
        notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (notification_id, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notification_reads_user ON notification_reads (user_id, read_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE user_channel_bindings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel varchar(20) NOT NULL,
        address varchar(255) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        verified_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_user_channel_binding UNIQUE (user_id, channel)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE notification_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel varchar(20) NOT NULL,
        event_type varchar(60) NOT NULL,
        conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notification_subscriptions_event
         ON notification_subscriptions (event_type, enabled)`,
    );

    await queryRunner.query(`
      CREATE TABLE notification_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        channel varchar(20) NOT NULL,
        rule_id uuid NULL REFERENCES notification_subscriptions(id) ON DELETE SET NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        attempt_count integer NOT NULL DEFAULT 0,
        last_error text NULL,
        sent_at timestamptz NULL,
        failed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notification_deliveries_event ON notification_deliveries (notification_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_notification_deliveries_status ON notification_deliveries (channel, status, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notification_deliveries`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_subscriptions`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_channel_bindings`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_reads`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notifications_type_dedupe`);
    await queryRunner.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS dedupe_key`);
  }
}
