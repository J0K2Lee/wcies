import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

/** Root BullMQ wiring (Redis connection). Queues are registered per feature. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('app.redisUrl'),
        },
      }),
    }),
  ],
})
export class QueueRootModule {}
