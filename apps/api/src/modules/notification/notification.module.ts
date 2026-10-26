import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { NotificationEntity } from './entities/notification.entity';
import {
  NotificationDeliveryEntity,
  NotificationReadEntity,
  UserChannelBindingEntity,
} from './entities/notification-channel.entities';
import { NotificationSubscriptionEntity } from './entities/notification-subscription.entity';
import { NotificationRepository } from './repositories/notification.repository';
import { FeishuProvider } from './providers/feishu.provider';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './controllers/notification.controller';
import { NotificationProcessor } from './processors/notification.processor';

/**
 * Notification module (Sprint 4 task §46-§55).
 *
 * Business modules publish typed domain events through NotificationService -
 * they never call Feishu (or any channel) directly (AGENTS.md §52). The
 * queue processor (./processors/notification.processor) is registered in
 * WorkersModule so the standalone worker process consumes deliveries.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationSubscriptionEntity,
      UserChannelBindingEntity,
      NotificationReadEntity,
      NotificationDeliveryEntity,
    ]),
    BullModule.registerQueue({ name: QUEUE_NAMES.notification }),
  ],
  controllers: [NotificationController],
  // processor 也注册在 API 进程（与 SyncModule 同一模式）：开发环境没有独立
  // worker 容器，否则飞书投递会永远停在 PENDING。
  providers: [NotificationRepository, FeishuProvider, NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}
