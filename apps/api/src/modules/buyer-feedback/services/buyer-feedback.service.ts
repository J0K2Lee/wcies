import { Injectable } from '@nestjs/common';
import { PlatformAdapter, PlatformChatMessageRaw, StoreContext } from '@wcies/platform-contracts';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { NotificationService } from '../../notification/services/notification.service';
import { ChatMessageRepository } from '../repositories/chat-message.repository';
import { PlatformReviewRepository } from '../repositories/platform-review.repository';

/** 一次轮询最多处理多少个未读会话（防止某个店突发几百个会话拖垮 tick）。 */
const MAX_CHATS_PER_POLL = 20;
/** 单个会话一次最多取多少条消息（平台上限 1000，取 50 足够覆盖一次轮询）。 */
const MESSAGES_PER_CHAT = 50;
/** 首次见到某会话时只回看最近多少条（避免把历史全部灌进库里）。 */
const FIRST_LOOKBACK = 20;
/** 评价单次轮询最多翻几页（每页 50，250 条足够一个 30 分钟窗口）。 */
const MAX_REVIEW_PAGES = 5;
/** 评价增量窗口的向前重叠：平台发布时间可能延迟/乱序，多读一段防漏。 */
const REVIEW_OVERLAP_MS = 6 * 60 * 60 * 1000;
/** 店铺之间的最小间隔（平台聊天/评价接口限速未知，保守串行）。 */
export const FEEDBACK_STORE_GAP_MS = 600;

export interface ChatCollectResult {
  chatsScanned: number;
  messagesInserted: number;
  notified: number;
}

export interface ReviewCollectResult {
  reviewsInserted: number;
  notified: number;
  /** 平台拒绝访问（需要卖家付费订阅）：调用方应长时间跳过该店。 */
  accessDenied: boolean;
}

/**
 * 买家侧事实采集（2026-11-02）。
 *
 * 两条来源统一在这里落库并发布通知事件：
 * - 聊天：`/v3/chat/list` 找未读会话 → `/v3/chat/history` 取增量 → 一条会话
 *   一条提醒（不是一条消息一条，避免买家连发刷屏）。
 * - 评价：`/v2/review/list` 按发布时间水位增量拉取 → 只对 1-3 星提醒。
 *
 * 平台词表（chat_type / user.type）在这里归一化，业务侧只看到
 * BUYER_SELLER 会话与 IN/OUT/SYSTEM 方向（AGENTS §31/§33）。
 */
@Injectable()
export class BuyerFeedbackService {
  constructor(
    private readonly chatRepo: ChatMessageRepository,
    private readonly reviewRepo: PlatformReviewRepository,
    private readonly notification: NotificationService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 采集一个店铺的未读买家会话。webhook（TYPE_NEW_MESSAGE）与定时轮询都走
   * 这里——载荷不参与解析，只当"去拉一次"的信号。
   */
  async collectChatMessages(input: {
    storeId: string;
    storeCode: string;
    platform: string;
    adapter: PlatformAdapter;
    context: StoreContext;
    trigger: 'SCHEDULED' | 'WEBHOOK';
  }): Promise<ChatCollectResult> {
    const { adapter, context } = input;
    if (adapter.fetchChats === undefined || adapter.fetchChatMessages === undefined) {
      return { chatsScanned: 0, messagesInserted: 0, notified: 0 };
    }
    const chats = await adapter.fetchChats(context, { unreadOnly: true });
    const buyerChats = chats
      .filter((chat) => chat.chatType === 'BUYER_SELLER' && chat.unreadCount > 0)
      .slice(0, MAX_CHATS_PER_POLL);
    // 首次接入的店铺只做「存量回填」、不发提醒：否则一个店几十个未读会话会在
    // 一小时内变成几十条飞书卡片（用户订阅后第一次轮询尤其明显）。
    const bootstrap = (await this.chatRepo.countByStore(input.storeId)) === 0;

    let messagesInserted = 0;
    let notified = 0;
    for (const chat of buyerChats) {
      try {
        const watermark = await this.chatRepo.maxMessageId(input.storeId, chat.chatId);
        const fetched = await adapter.fetchChatMessages(context, {
          chatId: chat.chatId,
          limit: watermark === null ? FIRST_LOOKBACK : MESSAGES_PER_CHAT,
          ...(watermark === null ? {} : { fromMessageId: watermark }),
        });
        if (fetched.length === 0) {
          continue;
        }
        const inserted = await this.chatRepo.insertNew(input.storeId, chat.chatType, fetched);
        messagesInserted += inserted.length;
        if (bootstrap) {
          continue;
        }
        const incoming = inserted.filter((message) => message.direction === 'IN');
        if (incoming.length === 0) {
          continue;
        }
        const latest = incoming[incoming.length - 1];
        if (latest === undefined) {
          continue;
        }
        await this.notification.notifyBuyerMessage({
          storeId: input.storeId,
          storeCode: input.storeCode,
          platform: input.platform,
          chatId: chat.chatId,
          buyerId: latest.senderId,
          orderNumber: latestPick(incoming, (message) => message.orderNumber),
          excerpt: latest.bodyText,
          hasImage: latest.hasImage,
          messageCount: incoming.length,
          lastMessageId: latest.platformMessageId,
          receivedAt: latest.createdAt,
        });
        notified += 1;
      } catch (error: unknown) {
        // 单个会话失败不影响其它会话（AGENTS §49）。
        this.logger.warn(`buyer chat collect failed store=${input.storeCode} chat=${chat.chatId}`, {
          module: 'buyer-feedback',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (messagesInserted > 0 || notified > 0) {
      this.logger.info(
        `buyer chat collected store=${input.storeCode} trigger=${input.trigger} chats=${buyerChats.length} inserted=${messagesInserted} notified=${notified}`,
        { module: 'buyer-feedback' },
      );
    }
    return { chatsScanned: buyerChats.length, messagesInserted, notified };
  }

  /**
   * 采集一个店铺的新评价。平台无权限（403 PermissionDenied，需付费订阅）时
   * 返回 `accessDenied`，调用方据此长时间跳过而不是反复试。
   */
  async collectReviews(input: {
    storeId: string;
    storeCode: string;
    platform: string;
    adapter: PlatformAdapter;
    context: StoreContext;
  }): Promise<ReviewCollectResult> {
    const { adapter, context } = input;
    if (adapter.fetchReviews === undefined) {
      return { reviewsInserted: 0, notified: 0, accessDenied: true };
    }
    const watermark = await this.reviewRepo.latestPublishedAt(input.storeId);
    const publishedFrom =
      watermark === null
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : new Date(watermark.getTime() - REVIEW_OVERLAP_MS);

    let lastId: string | undefined;
    let reviewsInserted = 0;
    let notified = 0;
    try {
      for (let page = 0; page < MAX_REVIEW_PAGES; page += 1) {
        const result = await adapter.fetchReviews(context, {
          publishedFrom,
          limit: 50,
          ...(lastId === undefined ? {} : { lastId }),
        });
        for (const review of result.items) {
          const isNew = await this.reviewRepo.insertIfNew(input.storeId, review);
          if (!isNew) {
            continue;
          }
          reviewsInserted += 1;
          if (review.rating !== null && review.rating <= 3) {
            await this.notification.notifyReviewCreated({
              storeId: input.storeId,
              storeCode: input.storeCode,
              platform: input.platform,
              reviewId: review.platformReviewId,
              rating: review.rating,
              excerpt: review.bodyText,
              platformSkuId: review.platformSkuId,
              hasMedia: review.photosCount + review.videosCount > 0,
              publishedAt: review.publishedAt,
            });
            notified += 1;
          }
        }
        if (!result.hasMore) {
          break;
        }
        const next = result.nextCursor as { lastReviewId?: string } | null;
        lastId = next?.lastReviewId;
        if (lastId === undefined) {
          break;
        }
      }
    } catch (error: unknown) {
      if (isReviewAccessDenied(error)) {
        return { reviewsInserted, notified, accessDenied: true };
      }
      throw error;
    }
    if (reviewsInserted > 0) {
      this.logger.info(
        `reviews collected store=${input.storeCode} inserted=${reviewsInserted} notified=${notified}`,
        { module: 'buyer-feedback' },
      );
    }
    return { reviewsInserted, notified, accessDenied: false };
  }
}

/** 取最后一个非空字段值（平台常把 order_number 给成空串）。 */
function latestPick(
  messages: readonly PlatformChatMessageRaw[],
  pick: (message: PlatformChatMessageRaw) => string | null,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    const value = pick(message);
    if (value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

/**
 * 是否是「没有评价权限」（需要卖家付费订阅）。OZON 返回 403 且消息里带
 * `not available with existing subscription`；客户端把它归一成
 * PLATFORM_AUTH_ERROR，这里按类别判断，不做字符串硬编码匹配之外的推断。
 */
export function isReviewAccessDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  return (
    code === 'PLATFORM_AUTH_ERROR' && /not available with existing subscription/i.test(message)
  );
}
