import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { DevController } from './controllers/dev.controller';
import { StorageTestController } from './controllers/storage-test.controller';

/**
 * Development-only module. NOT imported when NODE_ENV=production
 * (see AppModule), so all /dev routes 404 in production.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.test })],
  controllers: [DevController, StorageTestController],
})
export class DevModule {}
