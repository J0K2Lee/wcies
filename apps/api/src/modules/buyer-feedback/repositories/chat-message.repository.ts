import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformChatMessageRaw } from '@wcies/platform-contracts';

/**
 * 会话消息数据访问（2026-11-02）。只做读写，不判断业务规则（AGENTS §8）。
 *
 * 幂等键是 `(store_id, platform_chat_id, platform_message_id)`：同一条消息
 * 无论 webhook 触发几次、轮询重叠多少，都只落一行（AGENTS §49）。
 */
@Injectable()
export class ChatMessageRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** 该会话已落库的最大消息 id（增量拉取的水位）；无记录返回 null。 */
  async maxMessageId(storeId: string, platformChatId: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ max_id: string | null }>>(
      `SELECT MAX(platform_message_id)::text AS max_id
         FROM platform_chat_messages
        WHERE store_id = $1 AND platform_chat_id = $2`,
      [storeId, platformChatId],
    );
    const value = rows[0]?.max_id ?? null;
    return value === null || value === '0' ? null : value;
  }

  /**
   * 批量插入消息，重复的静默跳过（ON CONFLICT DO NOTHING）。返回**真正新增**
   * 的那些——通知只针对新增行，重放不会重复提醒。
   */
  async insertNew(
    storeId: string,
    chatType: string | null,
    messages: readonly PlatformChatMessageRaw[],
  ): Promise<PlatformChatMessageRaw[]> {
    if (messages.length === 0) {
      return [];
    }
    const values: unknown[] = [];
    const tuples = messages.map((message, index) => {
      const base = index * 12;
      values.push(
        storeId,
        message.chatId,
        message.platformMessageId,
        chatType,
        message.direction,
        message.senderType,
        message.senderId,
        message.bodyText,
        message.hasImage,
        message.orderNumber,
        message.platformSkuId,
        message.createdAt,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}::bigint, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
    });
    const inserted = await this.dataSource.query<Array<{ platform_message_id: string }>>(
      `INSERT INTO platform_chat_messages
         (store_id, platform_chat_id, platform_message_id, chat_type, direction,
          sender_type, sender_id, body_text, has_image, order_number,
          platform_sku_id, platform_created_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (store_id, platform_chat_id, platform_message_id) DO NOTHING
       RETURNING platform_message_id::text AS platform_message_id`,
      values,
    );
    const fresh = new Set(inserted.map((row) => String(row.platform_message_id)));
    return messages.filter((message) => fresh.has(message.platformMessageId));
  }

  /** 该店已落库的消息总数（0 = 首次接入，用来判定回填期）。 */
  async countByStore(storeId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM platform_chat_messages WHERE store_id = $1`,
      [storeId],
    );
    return Number(rows[0]?.total ?? '0');
  }

  /** 最近消息（供后续站内页面/排障使用；不做业务判断）。 */
  async listRecent(
    storeId: string,
    limit: number,
  ): Promise<Array<{ platformChatId: string; bodyText: string | null; createdAt: Date }>> {
    const rows = await this.dataSource.query<
      Array<{ platform_chat_id: string; body_text: string | null; platform_created_at: string }>
    >(
      `SELECT platform_chat_id, body_text, platform_created_at
         FROM platform_chat_messages
        WHERE store_id = $1
        ORDER BY platform_created_at DESC
        LIMIT $2`,
      [storeId, limit],
    );
    return rows.map((row) => ({
      platformChatId: row.platform_chat_id,
      bodyText: row.body_text,
      createdAt: new Date(row.platform_created_at),
    }));
  }
}
