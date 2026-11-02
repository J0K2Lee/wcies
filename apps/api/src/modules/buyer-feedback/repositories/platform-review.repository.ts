import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformReviewRaw } from '@wcies/platform-contracts';

/**
 * 评价数据访问（2026-11-02）。幂等键 `(store_id, platform_review_id)`：
 * 重叠窗口重复拉取只落一行，只有真正新增的评价才发提醒。
 */
@Injectable()
export class PlatformReviewRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** 该店已落库的最新发布时间（增量水位）；无记录返回 null。 */
  async latestPublishedAt(storeId: string): Promise<Date | null> {
    const rows = await this.dataSource.query<Array<{ published_at: string | null }>>(
      `SELECT MAX(published_at)::text AS published_at
         FROM platform_reviews
        WHERE store_id = $1`,
      [storeId],
    );
    const value = rows[0]?.published_at ?? null;
    return value === null ? null : new Date(value);
  }

  /** 插入一条评价；已存在返回 false（不覆盖、不重复提醒）。 */
  async insertIfNew(storeId: string, review: PlatformReviewRaw): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO platform_reviews
         (store_id, platform_review_id, rating, body_text, platform_sku_id,
          published_at, status, order_status, photos_count, videos_count,
          comments_count, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (store_id, platform_review_id) DO NOTHING
       RETURNING id`,
      [
        storeId,
        review.platformReviewId,
        review.rating,
        review.bodyText,
        review.platformSkuId,
        review.publishedAt,
        review.status,
        review.orderStatus,
        review.photosCount,
        review.videosCount,
        review.commentsCount,
        JSON.stringify(review.rawData),
      ],
    );
    return rows.length > 0;
  }

  /** 评价总量（店铺维度，用于观察是否有数据进入）。 */
  async countByStore(storeId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM platform_reviews WHERE store_id = $1`,
      [storeId],
    );
    return Number(rows[0]?.total ?? '0');
  }
}
