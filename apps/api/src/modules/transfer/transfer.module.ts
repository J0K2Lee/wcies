import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransferOrderEntity } from './entities/transfer-order.entity';
import { TransferOrderLineEntity } from './entities/transfer-order-line.entity';
import { TransferOrderRepository } from './repositories/transfer-order.repository';
import { TransferService } from './services/transfer.service';
import { SkuReferenceRelinkService } from './services/sku-reference-relink.service';
import { TransferController } from './controllers/transfer.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductModule } from '../product/product.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { OperationLogModule } from '../operation-log/operation-log.module';

/**
 * Transfer module (Sprint 10, docs/business-rules/transfer.md).
 *
 * All stock movement goes through the exported InventoryService primitives
 * (transferOutInTx / transferInInTx) - the module owns no balance writes
 * (AGENTS.md §10).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TransferOrderEntity, TransferOrderLineEntity]),
    InventoryModule,
    ProductModule,
    WarehouseModule,
    OperationLogModule,
  ],
  controllers: [TransferController],
  providers: [SkuReferenceRelinkService, TransferOrderRepository, TransferService],
  exports: [TransferService],
})
export class TransferModule {}
