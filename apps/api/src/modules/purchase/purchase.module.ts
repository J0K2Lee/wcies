import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
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
import { SkuReferenceRelinkService } from './services/sku-reference-relink.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseReceiptService } from './services/purchase-receipt.service';
import { ProcurementCoverageService } from './services/procurement-coverage.service';
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
 * 采购不再反向依赖订单（2026-10-21）：采购按 SKU×仓补缺口，不再挂在订单行上，
 * 因此没有 purchase → order 的引用。订单模块单向消费本模块提供的
 * ORDER_PROCUREMENT_PORT（覆盖派生结果），不再需要 forwardRef。
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
  ],
  controllers: [SupplierController, PurchaseOrderController, PurchaseReceiptController],
  providers: [
    SkuReferenceRelinkService,
    SupplierService,
    SupplierRepository,
    PurchaseOrderService,
    PurchaseOrderRepository,
    PurchaseReceiptService,
    PurchaseReceiptRepository,
    ProcurementCoverageService,
    { provide: ORDER_PROCUREMENT_PORT, useExisting: PurchaseOrderService },
  ],
  exports: [SupplierService, PurchaseOrderService, PurchaseReceiptService, ORDER_PROCUREMENT_PORT],
})
export class PurchaseModule {}
