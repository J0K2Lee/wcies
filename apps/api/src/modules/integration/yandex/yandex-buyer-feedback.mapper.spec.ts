import { describe, expect, it } from 'vitest';
import {
  mapChatMessage,
  mapChatSummaries,
  mapGoodsFeedback,
  mapGoodsQuestion,
  mapWebhookPayload,
} from './yandex.mapper';

/**
 * Yandex 买家侧映射（2026-11-02，官方 openapi 核对）：
 * - 会话只有 type=CHAT 才算买家会话，ARBITRAGE 是争议；
 * - `WAITING_FOR_PARTNER` 就是「等着我们回」，映射成 unreadCount=1（Yandex 没有未读数字段）；
 * - 消息方向按 sender 归一：CUSTOMER=IN / PARTNER=OUT / MARKET|SUPPORT=SYSTEM；
 * - 评价正文由 advantages/disadvantages/comment 拼装，rating 来自 statistics.rating；
 * - 推送类型 CHAT_* / GOODS_FEEDBACK_CREATED / QUESTION_CREATED 各自映射到
 *   CHAT_MESSAGE / GOODS_FEEDBACK / BUYER_QUESTION，只当「去拉一次」的信号。
 */
describe('mapChatSummaries', () => {
  it('WAITING_FOR_PARTNER 视为待回复（unreadCount=1），其它状态为 0', () => {
    const mapped = mapChatSummaries([
      {
        chatId: 1001,
        type: 'CHAT',
        status: 'WAITING_FOR_PARTNER',
        createdAt: '2026-11-01T10:00:00+03:00',
      },
      { chatId: 1002, type: 'CHAT', status: 'FINISHED' },
      { chatId: null, type: 'CHAT', status: 'NEW' },
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ chatId: '1001', unreadCount: 1, chatType: 'CHAT' });
    expect(mapped[1]).toMatchObject({ chatId: '1002', unreadCount: 0, chatStatus: 'FINISHED' });
  });
});

describe('mapChatMessage', () => {
  it('sender 归一为 IN/OUT/SYSTEM，附件消息标记 hasImage', () => {
    const base = { messageId: 5001, createdAt: '2026-11-02T03:00:00+03:00' };
    expect(
      mapChatMessage('1001', { ...base, sender: 'CUSTOMER', message: '发货了吗' }).direction,
    ).toBe('IN');
    expect(mapChatMessage('1001', { ...base, sender: 'PARTNER', message: '已发' }).direction).toBe(
      'OUT',
    );
    expect(mapChatMessage('1001', { ...base, sender: 'SUPPORT', message: 'x' }).direction).toBe(
      'SYSTEM',
    );
    const withFile = mapChatMessage('1001', {
      ...base,
      sender: 'CUSTOMER',
      payload: [{ downloadUrl: 'https://x/y' }],
    });
    expect(withFile.hasImage).toBe(true);
    expect(withFile.bodyText).toBeNull();
  });

  it('缺 messageId 视为畸形', () => {
    expect(() => mapChatMessage('1001', { sender: 'CUSTOMER' })).toThrow();
  });
});

describe('mapGoodsFeedback', () => {
  it('拼装正文并保留评分与货号', () => {
    const mapped = mapGoodsFeedback({
      feedbackId: 'fb-1',
      createdAt: '2026-11-01T10:00:00+03:00',
      needReaction: true,
      identifiers: { offerId: 'G75v2-TTC' },
      description: { comment: '用着还行', advantages: '手感好', disadvantages: '有点重' },
      statistics: { rating: 3, commentsCount: 2 },
    });

    expect(mapped).toMatchObject({
      platformReviewId: 'fb-1',
      rating: 3,
      platformSkuId: 'G75v2-TTC',
      bodyText: '用着还行 / 手感好 / 有点重',
      commentsCount: 2,
      status: 'NEED_REACTION',
    });
  });

  it('没有 feedbackId 返回 null', () => {
    expect(mapGoodsFeedback({ statistics: { rating: 1 } })).toBeNull();
  });
});

describe('mapGoodsQuestion', () => {
  it('取 questionIdentifiers.id 与 offerId，answer 恒为 null', () => {
    const mapped = mapGoodsQuestion({
      questionIdentifiers: { id: 777, offerId: 'G75v2-TTC' },
      text: '有保修吗？',
      createdAt: '2026-11-02T09:00:00+03:00',
    });

    expect(mapped).toMatchObject({
      platformQuestionId: '777',
      bodyText: '有保修吗？',
      platformSkuId: 'G75v2-TTC',
      answerText: null,
    });
  });
});

describe('mapWebhookPayload 买家侧分类', () => {
  const classify = (notificationType: string): string => {
    const [event] = mapWebhookPayload({ notificationType });
    return String(event?.eventType);
  };

  it('聊天/评价/提问推送各自归类', () => {
    expect(classify('CHAT_MESSAGE_SENT')).toBe('CHAT_MESSAGE');
    expect(classify('CHAT_CREATED')).toBe('CHAT_MESSAGE');
    expect(classify('GOODS_FEEDBACK_CREATED')).toBe('GOODS_FEEDBACK');
    expect(classify('QUESTION_CREATED')).toBe('BUYER_QUESTION');
  });

  it('订单类不受影响，未知类型仍 UNKNOWN', () => {
    expect(classify('ORDER_CREATED')).toBe('NEW_POSTING');
    expect(classify('SOMETHING_ELSE')).toBe('UNKNOWN');
  });
});
