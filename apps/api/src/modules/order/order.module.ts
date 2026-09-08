import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreModule } from '../store/store.module';
import { ListingModule } from '../listing/listing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ExceptionModule } from '../exception/exception.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { PickingModule } from '../picking/picking.module';
import { OrderEntity } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderInterceptionEntity } from './entities/order-interception.entity';
import { OrderRepository } from './repositories/order.repository';
import { OrderItemRepository } from './repositories/order-item.repository';
import { OrderStatusHistoryRepository } from './repositories/order-status-history.repository';
import { OrderInterceptionRepository } from './repositories/order-interception.repository';
import { OrderStatusService } from './services/order-status.service';
import { OrderIngestionService } from './services/order-ingestion.service';
import { OrderService } from './services/order.service';
import { OrderController } from './controllers/order.controller';

/**
 * Order Core (Sprint 3). Stock is only touched via the exported Inventory
 * services; SKU resolution only via ListingResolverService (check-architecture
 * Rule 3/4). OrderModule and PickingModule reference each other's public
 * services, so the picking import uses forwardRef.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      OrderInterceptionEntity,
    ]),
    StoreModule,
    ListingModule,
    InventoryModule,
    ExceptionModule,
    WarehouseModule,
    OperationLogModule,
    LoggerModule,
    forwardRef(() => PickingModule),
  ],
  controllers: [OrderController],
  providers: [
    OrderRepository,
    OrderItemRepository,
    OrderStatusHistoryRepository,
    OrderInterceptionRepository,
    OrderStatusService,
    OrderIngestionService,
    OrderService,
  ],
  exports: [OrderService, OrderIngestionService, OrderStatusService],
})
export class OrderModule {}
