import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from './common/logger/logger.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { createRootConfigModule } from './config/root-config.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { QueueRootModule } from './infrastructure/queue/queue-root.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { ObjectStorageModule } from './infrastructure/storage/object-storage.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { DevModule } from './modules/dev/dev.module';
import { HealthModule } from './modules/health/health.module';
import { OperationLogModule } from './modules/operation-log/operation-log.module';
import { PlatformModule } from './modules/platform/platform.module';
import { StoreModule } from './modules/store/store.module';

/**
 * HTTP API root module.
 *
 * DevModule is intentionally NOT registered in production: its routes
 * (POST /api/v1/dev/test-job, /dev/storage-test) return 404 there.
 */
@Module({
  imports: [
    createRootConfigModule(),
    LoggerModule,
    DatabaseModule,
    RedisModule,
    QueueRootModule,
    ObjectStorageModule,
    CryptoModule,
    HealthModule,
    AuthModule,
    OperationLogModule,
    PlatformModule,
    StoreModule,
    ...(process.env.NODE_ENV !== 'production' ? [DevModule] : []),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
