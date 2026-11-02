import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformBuyerQuestionRaw } from '@wcies/platform-contracts';

/**
 * 买家提问数据访问（2026-11-02）。幂等键
 * `(store_id, platform_question_id)`：重叠窗口重复拉取只落一行，只有真正
 * 新增的提问才发提醒。
 */
@Injectable()
export class BuyerQuestionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** 该店已落库的最新提问时间（增量水位）；无记录返回 null。 */
  async latestAskedAt(storeId: string): Promise<Date | null> {
    const rows = await this.dataSource.query<Array<{ asked_at: string | null }>>(
      `SELECT MAX(asked_at)::text AS asked_at FROM platform_buyer_questions WHERE store_id = $1`,
      [storeId],
    );
    const value = rows[0]?.asked_at ?? null;
    return value === null ? null : new Date(value);
  }

  async countByStore(storeId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM platform_buyer_questions WHERE store_id = $1`,
      [storeId],
    );
    return Number(rows[0]?.total ?? '0');
  }

  /** 插入一条提问；已存在返回 false（不覆盖、不重复提醒）。 */
  async insertIfNew(storeId: string, question: PlatformBuyerQuestionRaw): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO platform_buyer_questions
         (store_id, platform_question_id, platform_sku_id, body_text, answer_text,
          asked_at, answered_at, was_viewed, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (store_id, platform_question_id) DO NOTHING
       RETURNING id`,
      [
        storeId,
        question.platformQuestionId,
        question.platformSkuId,
        question.bodyText,
        question.answerText,
        question.askedAt,
        question.answeredAt,
        question.wasViewed,
        JSON.stringify(question.rawData),
      ],
    );
    return rows.length > 0;
  }
}
