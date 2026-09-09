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
import { CatalogModule } from './modules/catalog/catalog.module';
import { DevModule } from './modules/dev/dev.module';
import { HealthModule } from './modules/health/health.module';
import { OperationLogModule } from './modules/operation-log/operation-log.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ProductModule } from './modules/product/product.module';
import { StoreModule } from './modules/store/store.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { ListingModule } from './modules/listing/listing.module';
import { ImportModule } from './modules/import/import.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ExceptionModule } from './modules/exception/exception.module';
import { OrderModule } from './modules/order/order.module';
import { PickingModule } from './modules/picking/picking.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { InterceptionModule } from './modules/interception/interception.module';
import { NotificationModule } from './modules/notification/notification.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { SyncModule } from './modules/sync/sync.module';

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
    CatalogModule,
    ProductModule,
    WarehouseModule,
    ListingModule,
    ImportModule,
    InventoryModule,
    ExceptionModule,
    OrderModule,
    PickingModule,
    ShipmentModule,
    InterceptionModule,
    NotificationModule,
    IntegrationModule,
    SyncModule,
    ...(process.env.NODE_ENV !== 'production' ? [DevModule] : []),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
