import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductModule } from '../product/product.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ObjectStorageModule } from '../../infrastructure/storage/object-storage.module';
import { ShipmentEntity } from './entities/shipment.entity';
import { ShipmentItemEntity } from './entities/shipment-item.entity';
import { PackageEntity } from './entities/package.entity';
import { PackageItemEntity } from './entities/package-item.entity';
import { PackageItemSerialEntity } from './entities/package-item-serial.entity';
import { ShippingLabelEntity } from './entities/shipping-label.entity';
import { ShipmentRepository } from './repositories/shipment.repository';
import { PackageRepository } from './repositories/package.repository';
import { ShippingLabelRepository } from './repositories/shipping-label.repository';
import { ShipmentService } from './services/shipment.service';
import { PackingService } from './services/packing.service';
import { ShipmentShipService } from './services/shipment-ship.service';
import { ShippingLabelService } from './services/shipping-label.service';
import { QuickShipService } from './services/quick-ship.service';
import { PackageController, ShipmentController } from './controllers/shipment.controller';

/**
 * Shipment & Packing (Sprint 4). Stock ONLY moves through the exported
 * Inventory services (shipStockPartialInTx on the ship transaction's own
 * QueryRunner - the transaction-aware public API required by task §5); order
 * state only through OrderService. forwardRef pairs with OrderModule's
 * interception port wiring.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShipmentEntity,
      ShipmentItemEntity,
      PackageEntity,
      PackageItemEntity,
      PackageItemSerialEntity,
      ShippingLabelEntity,
    ]),
    ProductModule,
    WarehouseModule,
    InventoryModule,
    forwardRef(() => OrderModule),
    OperationLogModule,
    ObjectStorageModule,
  ],
  controllers: [ShipmentController, PackageController],
  providers: [
    ShipmentRepository,
    PackageRepository,
    ShippingLabelRepository,
    ShipmentService,
    PackingService,
    ShipmentShipService,
    ShippingLabelService,
    QuickShipService,
  ],
  // QuickShipService + ShippingLabelService are consumed by the order
  // fulfillment flow in the sync layer (public services only, AGENTS.md §7).
  exports: [
    ShipmentService,
    PackingService,
    ShipmentShipService,
    QuickShipService,
    ShippingLabelService,
  ],
})
export class ShipmentModule {}
