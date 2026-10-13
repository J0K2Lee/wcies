import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../infrastructure/queue/queue.constants';
import { TestProcessor } from './processors/test.processor';
import { ImportProcessor } from '../modules/import/processors/import.processor';
import { ImportModule } from '../modules/import/import.module';
import { NotificationModule } from '../modules/notification/notification.module';
import { NotificationProcessor } from '../modules/notification/processors/notification.processor';
import { SyncModule } from '../modules/sync/sync.module';

/** Queue consumers for the standalone worker process (src/worker.ts). */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.test },
      { name: QUEUE_NAMES.import },
      { name: QUEUE_NAMES.notification },
      { name: QUEUE_NAMES.orderSync },
      { name: QUEUE_NAMES.listingSync },
      { name: QUEUE_NAMES.webhook },
      { name: QUEUE_NAMES.scheduler },
      { name: QUEUE_NAMES.categoryTree },
      { name: QUEUE_NAMES.enrichment },
      { name: QUEUE_NAMES.media },
    ),
    ImportModule,
    NotificationModule,
    SyncModule,
  ],
  providers: [TestProcessor, ImportProcessor, NotificationProcessor],
})
export class WorkersModule {}
