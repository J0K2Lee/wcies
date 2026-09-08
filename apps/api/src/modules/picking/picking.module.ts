import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductModule } from '../product/product.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { PickingTaskEntity } from './entities/picking-task.entity';
import { PickingTaskItemEntity } from './entities/picking-task-item.entity';
import { PickingTaskRepository } from './repositories/picking-task.repository';
import { PickingTaskItemRepository } from './repositories/picking-task-item.repository';
import { PickingService } from './services/picking.service';
import { PickingController } from './controllers/picking.controller';
import { ORDER_PICKING_STATE_PORT } from '../order/ports/order-picking-state.port';

/**
 * Picking workflow (Sprint 3). Stock moves ONLY through the exported
 * Inventory services (pickStockPartial); barcode -> SKU resolution is a
 * backend responsibility (task §35). PickingService also implements the
 * OrderPickingStatePort consumed by the order status machine, hence the
 * forwardRef pairing with OrderModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PickingTaskEntity, PickingTaskItemEntity]),
    ProductModule,
    WarehouseModule,
    InventoryModule,
    forwardRef(() => OrderModule),
    OperationLogModule,
    LoggerModule,
  ],
  controllers: [PickingController],
  providers: [
    PickingTaskRepository,
    PickingTaskItemRepository,
    PickingService,
    {
      provide: ORDER_PICKING_STATE_PORT,
      useExisting: PickingService,
    },
  ],
  exports: [PickingService, ORDER_PICKING_STATE_PORT],
})
export class PickingModule {}
