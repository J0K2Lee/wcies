import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { IntegrationModule } from '../integration/integration.module';
import { NotificationModule } from '../notification/notification.module';
import { ReturnsModule } from '../returns/returns.module';
import { StoreModule } from '../store/store.module';
import { SyncModule } from '../sync/sync.module';
import { PlatformChatMessageEntity } from './entities/platform-chat-message.entity';
import { PlatformReviewEntity } from './entities/platform-review.entity';
import { ChatMessageRepository } from './repositories/chat-message.repository';
import { PlatformReviewRepository } from './repositories/platform-review.repository';
import { BuyerFeedbackService } from './services/buyer-feedback.service';
import {
  BUYER_FEEDBACK_TICK_MS,
  BuyerFeedbackProcessor,
} from './processors/buyer-feedback.processor';

/**
 * 买家侧提醒（2026-11-02）：买家消息 / 新评价 / 退货。
 *
 * 采集（聊天 + 评价）在本模块，退货复用 ReturnsModule 的同步服务；调度走
 * 独立队列 `wcies.buyer-feedback`（不与 sync 调度共用队列，避免抢 job）。
 * 依赖方向：本模块 → SyncModule（取 adapter/context）、ReturnsModule；
 * 反向不依赖，无环。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformChatMessageEntity, PlatformReviewEntity]),
    BullModule.registerQueue({ name: QUEUE_NAMES.buyerFeedback }),
    IntegrationModule,
    StoreModule,
    SyncModule,
    ReturnsModule,
    NotificationModule,
  ],
  providers: [
    ChatMessageRepository,
    PlatformReviewRepository,
    BuyerFeedbackService,
    BuyerFeedbackProcessor,
  ],
  exports: [BuyerFeedbackService],
})
export class BuyerFeedbackModule implements OnModuleInit {
  constructor(private readonly processor: BuyerFeedbackProcessor) {}

  async onModuleInit(): Promise<void> {
    await this.processor.registerTick();
  }
}

/** 供健康检查/排障读取的常量（tick 间隔）。 */
export const BUYER_FEEDBACK_INTERVAL_MS = BUYER_FEEDBACK_TICK_MS;
