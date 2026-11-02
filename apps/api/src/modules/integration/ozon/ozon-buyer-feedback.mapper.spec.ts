import { describe, expect, it } from 'vitest';
import { mapChatMessage, mapChatSummaries, mapReview } from './ozon.mapper';

/**
 * 买家侧事实映射（2026-11-02）。真实响应形状来自 T0 实测：
 * - `/v3/chat/list`：`chat.chat_id` / `chat.chat_type` / `unread_count` /
 *   `first_unread_message_id` / `last_message_id`（未读为 0 时 id 是 0）；
 * - `/v3/chat/history`：`message_id` / `user.type` / `data[]` / `context`；
 * - `/v2/review/list`：`id` / `rating` / `text` / `sku` / `published_at`。
 */
describe('mapChatSummaries', () => {
  it('丢弃没有 chat_id 的条目，0 号消息 id 归一为 null', () => {
    const mapped = mapChatSummaries([
      {
        chat: { chat_id: 'chat-1', chat_type: 'BUYER_SELLER', chat_status: 'OPENED' },
        unread_count: 3,
        first_unread_message_id: '3000000467309489658',
        last_message_id: '3000000467309489659',
      },
      { chat: { chat_type: 'UNSPECIFIED' }, unread_count: 1 },
      {
        chat: { chat_id: 'chat-2', chat_type: 'UNSPECIFIED', chat_status: 'CLOSED' },
        unread_count: 0,
        first_unread_message_id: 0,
        last_message_id: '3000000467300907441',
      },
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toEqual({
      chatId: 'chat-1',
      chatType: 'BUYER_SELLER',
      chatStatus: 'OPENED',
      unreadCount: 3,
      firstUnreadMessageId: '3000000467309489658',
      lastMessageId: '3000000467309489659',
      createdAt: null,
    });
    // 未读 0 时平台给 first_unread_message_id=0，必须当 null，不能当消息 id。
    expect(mapped[1]?.firstUnreadMessageId).toBeNull();
  });
});

describe('mapChatMessage', () => {
  it('买家(Customer)=IN、卖家(Seller)=OUT、其余=SYSTEM，data[] 拼成正文', () => {
    const base = {
      message_id: '3000000467309489658',
      created_at: '2026-11-02T03:05:59.225434Z',
      is_image: false,
      context: { order_number: '', sku: '' },
    };
    const inbound = mapChatMessage('chat-1', {
      ...base,
      user: { id: '156395493', type: 'Customer' },
      data: ['第一行', '第二行'],
    });
    expect(inbound.direction).toBe('IN');
    expect(inbound.bodyText).toBe('第一行\n第二行');
    expect(inbound.orderNumber).toBeNull();
    expect(inbound.platformMessageId).toBe('3000000467309489658');

    expect(
      mapChatMessage('chat-1', { ...base, user: { id: '3612865', type: 'Seller' }, data: ['x'] })
        .direction,
    ).toBe('OUT');
    expect(
      mapChatMessage('chat-1', { ...base, user: { id: '9', type: 'Crm' }, data: ['x'] }).direction,
    ).toBe('SYSTEM');
  });

  it('纯图片消息正文为空 → bodyText=null 且 hasImage=true', () => {
    const mapped = mapChatMessage('chat-1', {
      message_id: 1,
      user: { id: '1', type: 'Customer' },
      is_image: true,
      data: [],
      created_at: '2026-11-02T03:05:59Z',
    });
    expect(mapped.bodyText).toBeNull();
    expect(mapped.hasImage).toBe(true);
  });

  it('缺 message_id 视为畸形（单条丢弃由调用方兜底）', () => {
    expect(() => mapChatMessage('chat-1', { user: { type: 'Customer' } })).toThrow();
  });
});

describe('mapReview', () => {
  it('保留平台字段并统计媒体数量；缺 id 返回 null', () => {
    const mapped = mapReview({
      id: 'rev-1',
      rating: 2,
      text: '很失望',
      sku: 3214646989,
      published_at: '2026-11-01T10:00:00Z',
      status: 'PUBLISHED',
      order_status: 'DELIVERED',
      photos_amount: 2,
      videos_amount: 0,
      comments_amount: 1,
    });
    expect(mapped).toMatchObject({
      platformReviewId: 'rev-1',
      rating: 2,
      bodyText: '很失望',
      platformSkuId: '3214646989',
      photosCount: 2,
      videosCount: 0,
      commentsCount: 1,
    });
    expect(mapReview({ rating: 5 })).toBeNull();
  });
});
