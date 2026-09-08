import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../infrastructure/queue/queue.constants';
import { TestProcessor } from './processors/test.processor';
import { ImportProcessor } from '../modules/import/processors/import.processor';
import { ImportModule } from '../modules/import/import.module';
import { NotificationModule } from '../modules/notification/notification.module';
import { NotificationProcessor } from '../modules/notification/processors/notification.processor';

/** Queue consumers for the standalone worker process (src/worker.ts). */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.test },
      { name: QUEUE_NAMES.import },
      { name: QUEUE_NAMES.notification },
    ),
    ImportModule,
    NotificationModule,
  ],
  providers: [TestProcessor, ImportProcessor, NotificationProcessor],
})
export class WorkersModule {}
