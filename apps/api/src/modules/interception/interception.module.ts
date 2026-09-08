import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductModule } from '../product/product.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { ExceptionModule } from '../exception/exception.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { OrderInterceptionEntity } from './entities/order-interception.entity';
import { OrderInterceptionHistoryEntity } from './entities/order-interception-history.entity';
import { OrderInterceptionRepository } from './repositories/order-interception.repository';
import { OrderInterceptionHistoryRepository } from './repositories/order-interception-history.repository';
import { InterceptionService } from './services/interception.service';
import { InterceptionController } from './controllers/interception.controller';
import { ORDER_INTERCEPTION_PORT } from '../order/ports/order-interception.port';

/**
 * Interception workflow (Sprint 4). The entity/repositories moved here from
 * the order module (order keeps only the PORT); stock moves ONLY through
 * Inventory's transaction-aware returnPickedStockInTx and order state only
 * through OrderService. InterceptionService also implements
 * ORDER_INTERCEPTION_PORT consumed by OrderService.cancel - hence the
 * forwardRef pairing with OrderModule (same pattern as Picking).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrderInterceptionEntity, OrderInterceptionHistoryEntity]),
    ProductModule,
    WarehouseModule,
    InventoryModule,
    forwardRef(() => OrderModule),
    ExceptionModule,
    ShipmentModule,
    NotificationModule,
    OperationLogModule,
  ],
  controllers: [InterceptionController],
  providers: [
    OrderInterceptionRepository,
    OrderInterceptionHistoryRepository,
    InterceptionService,
    {
      provide: ORDER_INTERCEPTION_PORT,
      useExisting: InterceptionService,
    },
  ],
  exports: [InterceptionService, ORDER_INTERCEPTION_PORT],
})
export class InterceptionModule {}
