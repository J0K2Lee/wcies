import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 平台评价事实（2026-11-02）。
 *
 * OZON `/v2/review/list` 需要卖家付费订阅（实测 403 `PermissionDenied:
 * not available with existing subscription`），因此轮询器会做能力探测：
 * 无权限的店铺只记「不可用」，不刷错误；有权限时按 `published_at` 水位增量拉取。
 */
@Entity('platform_reviews')
@Index('uq_platform_reviews_store_review', ['storeId', 'platformReviewId'], { unique: true })
@Index('idx_platform_reviews_store_published', ['storeId', 'publishedAt'])
export class PlatformReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  /** OZON review id（字符串）。 */
  @Column({ type: 'varchar', length: 100, name: 'platform_review_id' })
  platformReviewId!: string;

  /** 1..5；平台未给出时为 null。 */
  @Column({ type: 'integer', nullable: true })
  rating!: number | null;

  @Column({ type: 'text', name: 'body_text', nullable: true })
  bodyText!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'platform_sku_id', nullable: true })
  platformSkuId!: string | null;

  /** 映射到的内部 SKU（review.sku → listing → sku；映射缺失为 null）。 */
  @Column({ type: 'uuid', name: 'sku_id', nullable: true })
  skuId!: string | null;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  status!: string | null;

  @Column({ type: 'varchar', length: 40, name: 'order_status', nullable: true })
  orderStatus!: string | null;

  @Column({ type: 'integer', name: 'photos_count', default: 0 })
  photosCount!: number;

  @Column({ type: 'integer', name: 'videos_count', default: 0 })
  videosCount!: number;

  @Column({ type: 'integer', name: 'comments_count', default: 0 })
  commentsCount!: number;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
