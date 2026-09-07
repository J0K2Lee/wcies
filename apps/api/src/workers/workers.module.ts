import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../infrastructure/queue/queue.constants';
import { TestProcessor } from './processors/test.processor';
import { ImportProcessor } from '../modules/import/processors/import.processor';
import { ImportModule } from '../modules/import/import.module';

/** Queue consumers for the standalone worker process (src/worker.ts). */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.test }, { name: QUEUE_NAMES.import }),
    ImportModule,
  ],
  providers: [TestProcessor, ImportProcessor],
})
export class WorkersModule {}
