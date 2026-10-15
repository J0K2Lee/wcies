import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreModule } from '../store/store.module';
import { ListingModule } from '../listing/listing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ExceptionModule } from '../exception/exception.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { ProductModule } from '../product/product.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { PickingModule } from '../picking/picking.module';
import { NotificationModule } from '../notification/notification.module';
import { InterceptionModule } from '../interception/interception.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { OrderEntity } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { PlatformStatusHistoryEntity } from './entities/platform-status-history.entity';
import { OrderRepository } from './repositories/order.repository';
import { OrderItemRepository } from './repositories/order-item.repository';
import { OrderStatusHistoryRepository } from './repositories/order-status-history.repository';
import { PlatformStatusHistoryRepository } from './repositories/platform-status-history.repository';
import { OrderStatusService } from './services/order-status.service';
import { OrderDeadlineExceptionService } from './services/order-deadline-exception.service';
import { OrderTrackingStallService } from './services/order-tracking-stall.service';
import { OrderIngestionService } from './services/order-ingestion.service';
import { OrderAutoReallocationService } from './services/order-auto-reallocation.service';
import { OrderPlatformShippedService } from './services/order-platform-shipped.service';
import { OrderService } from './services/order.service';
import { OrderController } from './controllers/order.controller';

/**
 * Order Core (Sprint 3; Sprint 4 adds SHIPPED rollups). Stock is only touched
 * via the exported Inventory services; SKU resolution only via
 * ListingResolverService (check-architecture Rule 3/4). Picking and
 * Interception reference OrderService while OrderService consumes their
 * ports - both pairings use forwardRef.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      PlatformStatusHistoryEntity,
    ]),
    StoreModule,
    // listing ↔ order 循环：listing 的映射落定回调 order 的批量收敛
    // （2026-10-15），与 picking/interception 同款 forwardRef 解法。
    forwardRef(() => ListingModule),
    InventoryModule,
    ExceptionModule,
    WarehouseModule,
    OperationLogModule,
    LoggerModule,
    NotificationModule,
    // 行图片取内部 SKU 主图（公开 Service SkuImageService，AGENTS.md §9）。
    ProductModule,
    forwardRef(() => PickingModule),
    forwardRef(() => InterceptionModule),
    forwardRef(() => PurchaseModule),
  ],
  controllers: [OrderController],
  providers: [
    OrderRepository,
    OrderItemRepository,
    OrderStatusHistoryRepository,
    PlatformStatusHistoryRepository,
    OrderStatusService,
    OrderDeadlineExceptionService,
    OrderTrackingStallService,
    OrderIngestionService,
    OrderAutoReallocationService,
    OrderPlatformShippedService,
    OrderService,
  ],
  exports: [OrderService, OrderIngestionService, OrderStatusService, OrderPlatformShippedService],
})
export class OrderModule {}
