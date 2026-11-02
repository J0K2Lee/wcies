import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { StoreService } from '../../store/services/store.service';
import { SyncContextService } from '../../sync/services/sync-context.service';
import { PlatformReturnSyncService } from '../../returns/services/platform-return-sync.service';
import { BuyerFeedbackService, FEEDBACK_STORE_GAP_MS } from '../services/buyer-feedback.service';

/** 聊天轮询间隔：10 分钟（webhook 只是加速，不是唯一通道）。 */
const CHAT_INTERVAL_MS = 10 * 60 * 1000;
/** 评价轮询间隔：30 分钟（评价量小，且平台常无权限）。 */
const REVIEW_INTERVAL_MS = 30 * 60 * 1000;
/** 退货轮询间隔：15 分钟。 */
const RETURN_INTERVAL_MS = 15 * 60 * 1000;
/** 提问轮询间隔：10 分钟（WB 没有聊天，提问就是买家消息）。 */
const QUESTION_INTERVAL_MS = 10 * 60 * 1000;
/** 评价无权限后的静默期：6 小时内不再试（避免每轮 403 刷日志）。 */
const REVIEW_DENIED_BACKOFF_MS = 6 * 60 * 60 * 1000;
/** 退货增量窗口：每次拉最近 7 天（upsert 幂等，重复拉安全）。 */
const RETURN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export const BUYER_FEEDBACK_TICK_MS = 5 * 60 * 1000;

/** webhook 触发的一次采集：只带店铺与要拉哪一类。 */
interface CollectJob {
  storeId: string;
  /** chat = 会话消息；reviews = 评价；questions = 提问。 */
  kind: 'chat' | 'reviews' | 'questions';
}

/**
 * 买家侧提醒的采集调度（2026-11-02）。
 *
 * 一个 5 分钟的 tick，三类任务各自按店铺节流：聊天 10 分钟、评价 30 分钟、
 * 退货 15 分钟。为什么不全用 webhook：只有聊天有推送类型，评价/退货平台
 * 根本不推（ozon.md §6.1b 的 22 种类型里没有），只能轮询。
 *
 * 单店失败只记日志，不影响其它店铺（AGENTS §43）。
 */
@Processor(QUEUE_NAMES.buyerFeedback)
export class BuyerFeedbackProcessor extends WorkerHost {
  private readonly lastChatAt = new Map<string, number>();
  private readonly lastQuestionAt = new Map<string, number>();
  private readonly lastReviewAt = new Map<string, number>();
  private readonly lastReturnAt = new Map<string, number>();
  /** storeId → 静默到什么时候（评价无权限）。 */
  private readonly reviewDeniedUntil = new Map<string, number>();

  constructor(
    @InjectQueue(QUEUE_NAMES.buyerFeedback) private readonly queue: Queue,
    private readonly storeService: StoreService,
    private readonly contextService: SyncContextService,
    private readonly buyerFeedback: BuyerFeedbackService,
    private readonly returnSync: PlatformReturnSyncService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  /** 注册重复 tick（API 与 worker 双进程都注册，BullMQ 按 jobId 去重）。 */
  async registerTick(): Promise<void> {
    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every: BUYER_FEEDBACK_TICK_MS },
        jobId: 'buyer-feedback-tick',
        removeOnComplete: { count: 4 },
        removeOnFail: { count: 10 },
      },
    );
  }

  async process(job: Job<CollectJob | Record<string, never>>): Promise<string> {
    if (job.name === 'chat' || job.name === 'reviews' || job.name === 'questions') {
      const data = job.data as CollectJob;
      if (typeof data.storeId === 'string') {
        await this.collectOne(data.storeId, job.name);
      }
      return `${job.name}-collected`;
    }
    await this.pollAll();
    return 'ticked';
  }

  private async pollAll(): Promise<void> {
    const stores = await this.storeService.listAllActive();
    for (const store of stores) {
      try {
        await this.pollStore(store.id);
      } catch (error: unknown) {
        this.logger.warn(`buyer feedback poll failed storeId=${store.id}`, {
          module: 'buyer-feedback',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await delay(FEEDBACK_STORE_GAP_MS);
    }
  }

  private async pollStore(storeId: string): Promise<void> {
    const { store, adapter } = await this.contextService.resolveSyncableStore(storeId);
    const now = Date.now();
    const chatDue = now - (this.lastChatAt.get(storeId) ?? 0) >= CHAT_INTERVAL_MS;
    const reviewDue = now - (this.lastReviewAt.get(storeId) ?? 0) >= REVIEW_INTERVAL_MS;
    const questionDue =
      adapter.fetchBuyerQuestions !== undefined &&
      now - (this.lastQuestionAt.get(storeId) ?? 0) >= QUESTION_INTERVAL_MS;
    const returnDue =
      adapter.returnAlertsEnabled === true && adapter.fetchReturns !== undefined
        ? now - (this.lastReturnAt.get(storeId) ?? 0) >= RETURN_INTERVAL_MS
        : false;
    if (!chatDue && !reviewDue && !questionDue && !returnDue) {
      return;
    }
    const context = await this.contextService.buildStoreContext(store);

    if (chatDue && adapter.fetchChats !== undefined) {
      this.lastChatAt.set(storeId, now);
      await this.buyerFeedback.collectChatMessages({
        storeId,
        storeCode: store.storeCode,
        platform: adapter.platformCode,
        adapter,
        context,
        trigger: 'SCHEDULED',
      });
    }

    if (reviewDue && adapter.fetchReviews !== undefined) {
      this.lastReviewAt.set(storeId, now);
      const deniedUntil = this.reviewDeniedUntil.get(storeId) ?? 0;
      if (now >= deniedUntil) {
        const result = await this.buyerFeedback.collectReviews({
          storeId,
          storeCode: store.storeCode,
          platform: adapter.platformCode,
          adapter,
          context,
        });
        if (result.accessDenied) {
          this.reviewDeniedUntil.set(storeId, now + REVIEW_DENIED_BACKOFF_MS);
          this.logger.warn(
            `review API not available for store=${store.storeCode} (needs OZON paid subscription); backing off 6h`,
            { module: 'buyer-feedback' },
          );
        }
      }
    }

    if (questionDue) {
      this.lastQuestionAt.set(storeId, now);
      await this.buyerFeedback.collectBuyerQuestions({
        storeId,
        storeCode: store.storeCode,
        platform: adapter.platformCode,
        adapter,
        context,
      });
    }

    if (returnDue) {
      this.lastReturnAt.set(storeId, now);
      await this.returnSync.syncStoreReturns(
        storeId,
        { userId: null, username: 'buyer-feedback-scheduler' },
        {
          createdFrom: new Date(now - RETURN_LOOKBACK_MS),
          silent: true,
          raiseUnlinkable: false,
        },
      );
    }
  }

  /** webhook 触发：按事件种类只拉对应的那类数据（Yandex 推送载荷只给 id）。 */
  private async collectOne(storeId: string, kind: CollectJob['kind']): Promise<void> {
    const { store, adapter } = await this.contextService.resolveSyncableStore(storeId);
    const context = await this.contextService.buildStoreContext(store);
    if (kind === 'chat') {
      if (adapter.fetchChats === undefined) {
        return;
      }
      this.lastChatAt.set(storeId, Date.now());
      await this.buyerFeedback.collectChatMessages({
        storeId,
        storeCode: store.storeCode,
        platform: adapter.platformCode,
        adapter,
        context,
        trigger: 'WEBHOOK',
      });
      return;
    }
    if (kind === 'reviews') {
      if (adapter.fetchReviews === undefined) {
        return;
      }
      const result = await this.buyerFeedback.collectReviews({
        storeId,
        storeCode: store.storeCode,
        platform: adapter.platformCode,
        adapter,
        context,
      });
      if (result.accessDenied) {
        this.reviewDeniedUntil.set(storeId, Date.now() + REVIEW_DENIED_BACKOFF_MS);
      }
      return;
    }
    if (adapter.fetchBuyerQuestions === undefined) {
      return;
    }
    this.lastQuestionAt.set(storeId, Date.now());
    await this.buyerFeedback.collectBuyerQuestions({
      storeId,
      storeCode: store.storeCode,
      platform: adapter.platformCode,
      adapter,
      context,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
