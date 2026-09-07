import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerModule } from './common/logger/logger.module';
import { AppLoggerService } from './common/logger/app-logger.service';
import { createRootConfigModule } from './config/root-config.module';
import { QueueRootModule } from './infrastructure/queue/queue-root.module';
import { WorkersModule } from './workers/workers.module';

/**
 * Standalone worker process entry (separate from the HTTP API):
 * `pnpm dev:worker`. Consumes BullMQ queues.
 */
@Module({
  imports: [createRootConfigModule(), LoggerModule, QueueRootModule, WorkersModule],
})
class WorkerModule {}

async function bootstrapWorker(): Promise<void> {
  const logger = new AppLoggerService();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger,
  });
  app.enableShutdownHooks();

  logger.info('Worker process started', { module: 'worker-bootstrap' });

  const shutdown = async (signal: string) => {
    logger.info(`Worker shutting down (${signal})`, { module: 'worker-bootstrap' });
    await app.close();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrapWorker();
