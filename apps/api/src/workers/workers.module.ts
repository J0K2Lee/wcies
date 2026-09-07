import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../infrastructure/queue/queue.constants';
import { TestProcessor } from './processors/test.processor';

/** Queue consumers for the standalone worker process (src/worker.ts). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.test })],
  providers: [TestProcessor],
})
export class WorkersModule {}
