import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 买家侧提醒（2026-11-02）：聊天消息与评价的平台事实表。
 *
 * - platform_chat_messages：OZON 买家会话消息（`/v3/chat/list` +
 *   `/v3/chat/history` 拉取，webhook 只作触发）。幂等键
 *   `(store_id, platform_chat_id, platform_message_id)`；`platform_message_id`
 *   是平台 int64（实测 19 位，如 3000000467309489658），用 bigint 以便按
 *   水位取增量。
 * - platform_reviews：`/v2/review/list` 拉取的评价事实。OZON 该接口需要卖家
 *   付费订阅，无权限时轮询会记录「不可用」并跳过（不让错误刷屏）。
 *
 * 两张表都只存平台事实，不写库存/订单状态（AGENTS §38）。
 */
export class BuyerFeedback1793660000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_chat_messages (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id            uuid NOT NULL,
        platform_chat_id    varchar(64) NOT NULL,
        platform_message_id bigint NOT NULL,
        chat_type           varchar(40) NULL,
        direction           varchar(10) NOT NULL,
        sender_type         varchar(40) NULL,
        sender_id           varchar(64) NULL,
        body_text           text NULL,
        has_image           boolean NOT NULL DEFAULT false,
        order_number        varchar(64) NULL,
        platform_sku_id     varchar(64) NULL,
        platform_created_at timestamptz NOT NULL,
        raw_data            jsonb NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_chat_messages_store_chat_msg
          UNIQUE (store_id, platform_chat_id, platform_message_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_chat_messages_store_created
        ON platform_chat_messages (store_id, platform_created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_chat_messages_store_chat
        ON platform_chat_messages (store_id, platform_chat_id, platform_message_id DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE platform_reviews (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id           uuid NOT NULL,
        platform_review_id varchar(100) NOT NULL,
        rating             integer NULL,
        body_text          text NULL,
        platform_sku_id    varchar(64) NULL,
        sku_id             uuid NULL,
        published_at       timestamptz NULL,
        status             varchar(40) NULL,
        order_status       varchar(40) NULL,
        photos_count       integer NOT NULL DEFAULT 0,
        videos_count       integer NOT NULL DEFAULT 0,
        comments_count     integer NOT NULL DEFAULT 0,
        raw_data           jsonb NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_platform_reviews_store_review UNIQUE (store_id, platform_review_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_platform_reviews_store_published
        ON platform_reviews (store_id, published_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_reviews`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_chat_messages`);
  }
}
