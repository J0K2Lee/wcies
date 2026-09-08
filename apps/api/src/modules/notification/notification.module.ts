import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationRepository } from './repositories/notification.repository';
import { FeishuProvider } from './providers/feishu.provider';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './controllers/notification.controller';

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
    TypeOrmModule.forFeature([NotificationEntity]),
    BullModule.registerQueue({ name: QUEUE_NAMES.notification }),
  ],
  controllers: [NotificationController],
  providers: [NotificationRepository, FeishuProvider, NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
