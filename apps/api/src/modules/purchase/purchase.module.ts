import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { OrderModule } from '../order/order.module';
import { ProductModule } from '../product/product.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SupplierEntity } from './entities/supplier.entity';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PurchaseReceiptEntity } from './entities/purchase-receipt.entity';
import { PurchaseReceiptItemEntity } from './entities/purchase-receipt-item.entity';
import { SupplierRepository } from './repositories/supplier.repository';
import { PurchaseOrderRepository } from './repositories/purchase-order.repository';
import { PurchaseReceiptRepository } from './repositories/purchase-receipt.repository';
import { SupplierService } from './services/supplier.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseReceiptService } from './services/purchase-receipt.service';
import { SupplierController } from './controllers/supplier.controller';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { PurchaseReceiptController } from './controllers/purchase-receipt.controller';
import { ORDER_PROCUREMENT_PORT } from '../order/ports/order-procurement.port';

/**
 * Purchase module (Sprint 7): suppliers, purchase orders (registration of
 * intent) and purchase receipts (irreversible stock facts, decision 0013).
 * Stock is ONLY touched through the exported Inventory services
 * (receiveStockInTx) - never a direct inventory_balances write.
 * BusinessCodeService arrives via the global BusinessCodeModule.
 *
 * forwardRef pairing with OrderModule (same pattern as Picking/Interception):
 * purchase consumes order public services while the order module consumes
 * the ORDER_PROCUREMENT_PORT implemented here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupplierEntity,
      PurchaseOrderEntity,
      PurchaseOrderItemEntity,
      PurchaseReceiptEntity,
      PurchaseReceiptItemEntity,
    ]),
    ProductModule,
    WarehouseModule,
    InventoryModule,
    OperationLogModule,
    forwardRef(() => OrderModule),
  ],
  controllers: [SupplierController, PurchaseOrderController, PurchaseReceiptController],
  providers: [
    SupplierService,
    SupplierRepository,
    PurchaseOrderService,
    PurchaseOrderRepository,
    PurchaseReceiptService,
    PurchaseReceiptRepository,
    { provide: ORDER_PROCUREMENT_PORT, useExisting: PurchaseOrderService },
  ],
  exports: [SupplierService, PurchaseOrderService, PurchaseReceiptService, ORDER_PROCUREMENT_PORT],
})
export class PurchaseModule {}
