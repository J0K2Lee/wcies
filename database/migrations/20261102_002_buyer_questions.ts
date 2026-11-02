import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 买家提问（2026-11-02）。
 *
 * WB 没有买家聊天 API：运营口径里的「买家消息」在 WB 上就是**提问**
 * （`feedbacks-api…/api/v1/questions`）。Yandex 也有 goods-questions。
 * 两者结构不同（WB 无 chatId、Yandex 带 businessId），所以单独一张表，
 * 不复用 platform_chat_messages（那张表的键是 chatId + messageId）。
 *
 * 幂等键 `(store_id, platform_question_id)`；`asked_at` 为平台提问时间。
 */
export class BuyerQuestions1793660000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_buyer_questions (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id             uuid NOT NULL,
        platform_question_id varchar(100) NOT NULL,
        platform_sku_id      varchar(255) NULL,
        body_text            text NULL,
        answer_text          text NULL,
        asked_at             timestamptz NULL,
        answered_at          timestamptz NULL,
        was_viewed           boolean NULL,
        raw_data             jsonb NULL,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_buyer_questions_store_question
          UNIQUE (store_id, platform_question_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_buyer_questions_store_asked
        ON platform_buyer_questions (store_id, asked_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_buyer_questions`);
  }
}
