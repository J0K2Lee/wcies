import { describe, expect, it, vi } from 'vitest';
import { PlatformChatMessageRaw, StoreContext } from '@wcies/platform-contracts';
import { BuyerFeedbackService, isReviewAccessDenied } from './buyer-feedback.service';
import { ChatMessageRepository } from '../repositories/chat-message.repository';
import { PlatformReviewRepository } from '../repositories/platform-review.repository';
import { NotificationService } from '../../notification/services/notification.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * 买家侧采集（2026-11-02）：
 * 1. 只看 BUYER_SELLER 会话，只看买家方向（IN）；
 * 2. 首次接入（库里 0 条）只回填不发提醒，避免几十条历史未读刷屏；
 * 3. 一条会话一次提醒，正文取最后一条，去重键带最后消息 id；
 * 4. 评价只提醒 1-3 星；平台无权限时返回 accessDenied 让调度退避。
 */
const CONTEXT = { storeId: 'store-1', credential: {} } as unknown as StoreContext;

function chatMessage(overrides: Partial<PlatformChatMessageRaw> = {}): PlatformChatMessageRaw {
  return {
    chatId: 'chat-1',
    platformMessageId: '3000000467309489658',
    direction: 'IN',
    senderType: 'Customer',
    senderId: 'buyer-1',
    bodyText: '订单什么时候发货？',
    hasImage: false,
    orderNumber: 'ORD-1',
    platformSkuId: null,
    createdAt: new Date('2026-11-02T03:05:59Z'),
    rawData: {},
    ...overrides,
  };
}

function build(options: {
  existingMessages?: number;
  chats?: Array<{ chatId: string; chatType: string; unreadCount: number }>;
  messages?: PlatformChatMessageRaw[];
  inserted?: PlatformChatMessageRaw[];
  reviews?: Array<{ platformReviewId: string; rating: number | null }>;
  reviewError?: Error;
}) {
  const chatRepo = {
    maxMessageId: vi.fn().mockResolvedValue(null),
    countByStore: vi.fn().mockResolvedValue(options.existingMessages ?? 0),
    insertNew: vi.fn().mockResolvedValue(options.inserted ?? options.messages ?? [chatMessage()]),
  } as unknown as ChatMessageRepository;
  const reviewRepo = {
    latestPublishedAt: vi.fn().mockResolvedValue(null),
    insertIfNew: vi.fn().mockResolvedValue(true),
  } as unknown as PlatformReviewRepository;
  const notification = {
    notifyBuyerMessage: vi.fn().mockResolvedValue(undefined),
    notifyReviewCreated: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
  const service = new BuyerFeedbackService(chatRepo, reviewRepo, notification, logger);

  const adapter = {
    fetchChats: vi.fn().mockResolvedValue(
      (options.chats ?? [{ chatId: 'chat-1', chatType: 'BUYER_SELLER', unreadCount: 1 }]).map(
        (chat) => ({
          chatId: chat.chatId,
          chatType: chat.chatType,
          chatStatus: 'OPENED',
          unreadCount: chat.unreadCount,
          lastMessageId: '3000000467309489658',
          firstUnreadMessageId: '3000000467309489658',
          createdAt: null,
        }),
      ),
    ),
    fetchChatMessages: vi.fn().mockResolvedValue(options.messages ?? [chatMessage()]),
    fetchReviews: vi.fn().mockImplementation(() =>
      options.reviewError === undefined
        ? Promise.resolve({
            items: (options.reviews ?? []).map((review) => ({
              platformReviewId: review.platformReviewId,
              rating: review.rating,
              bodyText: '差评内容',
              platformSkuId: '3214',
              publishedAt: new Date('2026-11-01T10:00:00Z'),
              status: 'PUBLISHED',
              orderStatus: 'DELIVERED',
              photosCount: 0,
              videosCount: 0,
              commentsCount: 0,
              rawData: {},
            })),
            nextCursor: null,
            hasMore: false,
          })
        : Promise.reject(options.reviewError),
    ),
  };

  const collectChats = (trigger: 'SCHEDULED' | 'WEBHOOK' = 'SCHEDULED') =>
    service.collectChatMessages({
      storeId: 'store-1',
      storeCode: 'ON-002',
      platform: 'OZON',
      adapter: adapter as never,
      context: CONTEXT,
      trigger,
    });

  const collectReviews = () =>
    service.collectReviews({
      storeId: 'store-1',
      storeCode: 'ON-002',
      platform: 'OZON',
      adapter: adapter as never,
      context: CONTEXT,
    });

  return { collectChats, collectReviews, chatRepo, notification, adapter };
}

describe('BuyerFeedbackService 聊天采集', () => {
  it('首次接入只回填、不发提醒（避免历史未读刷屏）', async () => {
    const { collectChats, notification } = build({ existingMessages: 0 });

    const result = await collectChats();

    expect(result.messagesInserted).toBe(1);
    expect(result.notified).toBe(0);
    expect(notification.notifyBuyerMessage).not.toHaveBeenCalled();
  });

  it('已有存量后，新买家消息按会话聚合发一条提醒', async () => {
    const messages = [
      chatMessage({ platformMessageId: '3000000467309489658', bodyText: '第一条' }),
      chatMessage({
        platformMessageId: '3000000467309489659',
        bodyText: '第二条',
        createdAt: new Date('2026-11-02T03:06:59Z'),
      }),
    ];
    const { collectChats, notification } = build({
      existingMessages: 100,
      messages,
      inserted: messages,
    });

    const result = await collectChats('WEBHOOK');

    expect(result.notified).toBe(1);
    expect(notification.notifyBuyerMessage).toHaveBeenCalledTimes(1);
    expect(notification.notifyBuyerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 2,
        excerpt: '第二条',
        lastMessageId: '3000000467309489659',
        orderNumber: 'ORD-1',
      }),
    );
  });

  it('只处理 BUYER_SELLER 会话，平台系统会话一律忽略', async () => {
    const { collectChats, adapter } = build({
      existingMessages: 10,
      chats: [
        { chatId: 'sys-1', chatType: 'SELLER_API_NOTIFICATIONS', unreadCount: 5 },
        { chatId: 'misc-1', chatType: 'UNSPECIFIED', unreadCount: 3 },
      ],
    });

    const result = await collectChats();

    expect(result.chatsScanned).toBe(0);
    expect(adapter.fetchChatMessages).not.toHaveBeenCalled();
  });

  it('只有我方发出的消息（OUT）不产生提醒', async () => {
    const outbound = [chatMessage({ direction: 'OUT', senderType: 'Seller' })];
    const { collectChats, notification } = build({
      existingMessages: 10,
      messages: outbound,
      inserted: outbound,
    });

    const result = await collectChats();

    expect(result.notified).toBe(0);
    expect(notification.notifyBuyerMessage).not.toHaveBeenCalled();
  });
});

describe('BuyerFeedbackService 评价采集', () => {
  it('1-3 星提醒、4-5 星只落库', async () => {
    const { collectReviews, notification } = build({
      reviews: [
        { platformReviewId: 'r1', rating: 1 },
        { platformReviewId: 'r2', rating: 3 },
        { platformReviewId: 'r3', rating: 5 },
      ],
    });

    const result = await collectReviews();

    expect(result.reviewsInserted).toBe(3);
    expect(result.notified).toBe(2);
    expect(notification.notifyReviewCreated).toHaveBeenCalledTimes(2);
  });

  it('平台无评价权限（403 not available with existing subscription）→ accessDenied', async () => {
    const denied = new Error('not available with existing subscription') as Error & {
      code: string;
    };
    denied.code = 'PLATFORM_AUTH_ERROR';
    const { collectReviews } = build({ reviewError: denied });

    const result = await collectReviews();

    expect(result.accessDenied).toBe(true);
    expect(isReviewAccessDenied(denied)).toBe(true);
    // 其它错误不能被误判成无权限（否则会静默停掉一个正常店铺）。
    expect(isReviewAccessDenied(new Error('network down'))).toBe(false);
  });
});
