import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 买家提问（2026-11-02）。
 *
 * WB 的「提问」是那边最主要的买家触达渠道（没有聊天 API）；Yandex 也有
 * goods-questions。两家共用这张表：`platform_question_id` 是平台 id 字符串，
 * `platform_sku_id` 存卖家可识别的商品标识（WB supplierArticle / Yandex offerId）。
 */
@Entity('platform_buyer_questions')
@Index('uq_buyer_questions_store_question', ['storeId', 'platformQuestionId'], { unique: true })
@Index('idx_buyer_questions_store_asked', ['storeId', 'askedAt'])
export class PlatformBuyerQuestionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 100, name: 'platform_question_id' })
  platformQuestionId!: string;

  @Column({ type: 'varchar', length: 255, name: 'platform_sku_id', nullable: true })
  platformSkuId!: string | null;

  @Column({ type: 'text', name: 'body_text', nullable: true })
  bodyText!: string | null;

  /** 卖家回复；未回复为 null。 */
  @Column({ type: 'text', name: 'answer_text', nullable: true })
  answerText!: string | null;

  @Column({ type: 'timestamptz', name: 'asked_at', nullable: true })
  askedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'answered_at', nullable: true })
  answeredAt!: Date | null;

  /** 平台是否已读（WB `wasViewed`）；没有这个概念的平台保持 null。 */
  @Column({ type: 'boolean', name: 'was_viewed', nullable: true })
  wasViewed!: boolean | null;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
