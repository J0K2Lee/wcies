import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis connection for non-queue concerns:
 * readiness checks, login rate limiting, and future cache / distributed-lock
 * usage. BullMQ manages its own connections.
 *
 * Redis never holds authoritative business facts (Sprint 0 task §15).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('app.redisUrl'), {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }

  async ping(): Promise<boolean> {
    const result = await this.client.ping();
    return result === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
