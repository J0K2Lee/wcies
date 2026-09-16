import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductModule } from '../product/product.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { InventoryBalanceEntity } from './entities/inventory-balance.entity';
import { InventorySafetyStockEntity } from './entities/inventory-safety-stock.entity';
import { InventoryReservationEntity } from './entities/inventory-reservation.entity';
import { InventoryReservationLineEntity } from './entities/inventory-reservation-line.entity';
import { InventoryEventEntity } from './entities/inventory-event.entity';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { InventorySerialEntity } from './entities/inventory-serial.entity';
import { InventoryBalanceRepository } from './repositories/inventory-balance.repository';
import { InventoryReservationRepository } from './repositories/inventory-reservation.repository';
import { InventoryTransactionRepository } from './repositories/inventory-transaction.repository';
import { InventorySafetyStockRepository } from './repositories/inventory-safety-stock.repository';
import { InventorySerialRepository } from './repositories/inventory-serial.repository';
import { ReplenishmentRepository } from './repositories/replenishment.repository';
import { InventoryService } from './services/inventory.service';
import { InventoryAdjustmentService } from './services/inventory-adjustment.service';
import { InventoryMovementService } from './services/inventory-movement.service';
import { InventoryQueryService } from './services/inventory-query.service';
import { InventorySafetyStockService } from './services/inventory-safety-stock.service';
import { ReservationService } from './services/reservation.service';
import {
  InventoryController,
  InventoryReservationController,
  InventorySafetyStockController,
} from './controllers/inventory.controller';

/**
 * Inventory Core (Sprint 2): the ONLY writer of inventory_balances
 * (AGENTS.md §10). Other modules consume the exported services; the
 * repositories/entities stay module-internal and are enforced by
 * check-architecture Rule 3/4.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryBalanceEntity,
      InventorySafetyStockEntity,
      InventoryReservationEntity,
      InventoryReservationLineEntity,
      InventoryEventEntity,
      InventoryTransactionEntity,
      InventorySerialEntity,
    ]),
    ProductModule,
    WarehouseModule,
    OperationLogModule,
  ],
  controllers: [
    InventoryController,
    InventoryReservationController,
    InventorySafetyStockController,
  ],
  providers: [
    InventoryBalanceRepository,
    InventoryReservationRepository,
    InventoryTransactionRepository,
    InventorySafetyStockRepository,
    InventorySerialRepository,
    ReplenishmentRepository,
    InventoryService,
    InventoryAdjustmentService,
    InventoryMovementService,
    InventoryQueryService,
    InventorySafetyStockService,
    ReservationService,
  ],
  exports: [InventoryService, ReservationService, InventoryQueryService],
})
export class InventoryModule {}
