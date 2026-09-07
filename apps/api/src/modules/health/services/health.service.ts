import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export type DependencyState = 'up' | 'down';

export interface ReadinessChecks {
  postgres: DependencyState;
  redis: DependencyState;
}

export interface ReadinessResult {
  checks: ReadinessChecks;
  allUp: boolean;
}

/**
 * Liveness reflects only the API process itself. Readiness verifies
 * PostgreSQL and Redis. Third-party platform APIs never influence either
 * (Sprint 0 task §27).
 */
@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  async checkReadiness(): Promise<ReadinessResult> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    return {
      checks: { postgres, redis },
      allUp: postgres === 'up' && redis === 'up',
    };
  }

  private async checkPostgres(): Promise<DependencyState> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyState> {
    try {
      return (await this.redis.ping()) ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
