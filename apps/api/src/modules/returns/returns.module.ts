import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationModule } from '../integration/integration.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ExceptionModule } from '../exception/exception.module';
import { NotificationModule } from '../notification/notification.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { ListingModule } from '../listing/listing.module';
import { OrderModule } from '../order/order.module';
import { SyncModule } from '../sync/sync.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ReturnsController } from './controllers/returns.controller';
import { PlatformReturnRepository } from './repositories/platform-return.repository';
import { ReturnBatchRepository } from './repositories/return-batch.repository';
import { ReturnsService } from './services/returns.service';
import { PlatformReturnSyncService } from './services/platform-return-sync.service';
import { PlatformReturnEntity } from './entities/platform-return.entity';
import { ReturnBatchEntity } from './entities/return-batch.entity';
import { ReturnBatchItemEntity } from './entities/return-batch-item.entity';

/**
 * Return/refund module (dual-axis T5, 2026-09-15; docs/business-rules/
 * returns.md). Platform facts are PULL-ONLY; stock write-back happens
 * exclusively at batch-item inspection through the exported InventoryService
 * (AGENTS.md §10). Cross-module access goes through exported services only.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformReturnEntity, ReturnBatchEntity, ReturnBatchItemEntity]),
    IntegrationModule,
    InventoryModule,
    ExceptionModule,
    WarehouseModule,
    ListingModule,
    OrderModule,
    SyncModule,
    NotificationModule,
    OperationLogModule,
  ],
  controllers: [ReturnsController],
  providers: [
    PlatformReturnRepository,
    ReturnBatchRepository,
    ReturnsService,
    PlatformReturnSyncService,
  ],
  exports: [ReturnsService, PlatformReturnSyncService],
})
export class ReturnsModule {}
