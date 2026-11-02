import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 买家会话消息（2026-11-02，买家消息提醒）。
 *
 * 平台事实：由 `/v3/chat/list` + `/v3/chat/history` 拉取，webhook
 * （`TYPE_NEW_MESSAGE`）只作为「去拉一次」的触发器——载荷字段平台未给出
 * 文档，从不直接信任（AGENTS §88 / 平台契约「payload 只是线索」）。
 *
 * `direction` 由发送方类型归一化：Customer → IN，Seller → OUT，
 * 其余（Crm / Support / Courier / NotificationUser）→ SYSTEM。
 */
@Entity('platform_chat_messages')
@Index('uq_chat_messages_store_chat_msg', ['storeId', 'platformChatId', 'platformMessageId'], {
  unique: true,
})
@Index('idx_chat_messages_store_created', ['storeId', 'platformCreatedAt'])
export class PlatformChatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  /** OZON chat_id (uuid string). */
  @Column({ type: 'varchar', length: 64, name: 'platform_chat_id' })
  platformChatId!: string;

  /** 平台消息 id（int64，bigint 列；TypeORM 返回 string）。 */
  @Column({ type: 'bigint', name: 'platform_message_id' })
  platformMessageId!: string;

  /** 会话类型（BUYER_SELLER / SELLER_API_NOTIFICATIONS / UNSPECIFIED）。 */
  @Column({ type: 'varchar', length: 40, name: 'chat_type', nullable: true })
  chatType!: string | null;

  /** IN（买家）/ OUT（我们）/ SYSTEM（平台或客服系统）。 */
  @Column({ type: 'varchar', length: 10 })
  direction!: string;

  @Column({ type: 'varchar', length: 40, name: 'sender_type', nullable: true })
  senderType!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'sender_id', nullable: true })
  senderId!: string | null;

  /** 消息正文（Markdown 拼成纯文本；仅图片消息时可能为空）。 */
  @Column({ type: 'text', name: 'body_text', nullable: true })
  bodyText!: string | null;

  @Column({ type: 'boolean', name: 'has_image', default: false })
  hasImage!: boolean;

  /** 平台在消息上下文里带的订单号（可能为空字符串 → 归一化为 null）。 */
  @Column({ type: 'varchar', length: 64, name: 'order_number', nullable: true })
  orderNumber!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'platform_sku_id', nullable: true })
  platformSkuId!: string | null;

  @Column({ type: 'timestamptz', name: 'platform_created_at' })
  platformCreatedAt!: Date;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
