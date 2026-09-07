import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObjectStorageModule } from '../../infrastructure/storage/object-storage.module';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { ListingModule } from '../listing/listing.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductModule } from '../product/product.module';
import { StoreModule } from '../store/store.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { ImportJobEntity } from './entities/import-job.entity';
import { ImportJobRepository } from './repositories/import-job.repository';
import { ImportService } from './import.service';
import { ImportExecutorService } from './services/import-executor.service';
import { ImportController } from './controllers/import.controller';
import { SkuImportHandler } from './handlers/sku-import.handler';
import {
  BarcodeImportHandler,
  BinImportHandler,
  WarehouseImportHandler,
} from './handlers/master-data-import.handlers';
import { ListingMappingImportHandler } from './handlers/listing-mapping-import.handler';

/**
 * Import Center base module (task §57): upload+validate runs on the API;
 * execution runs on the worker via the wcies.import queue.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJobEntity]),
    BullModule.registerQueue({ name: QUEUE_NAMES.import }),
    ObjectStorageModule,
    OperationLogModule,
    PlatformModule,
    StoreModule,
    ProductModule,
    WarehouseModule,
    ListingModule,
  ],
  controllers: [ImportController],
  providers: [
    ImportService,
    ImportExecutorService,
    ImportJobRepository,
    SkuImportHandler,
    BarcodeImportHandler,
    WarehouseImportHandler,
    BinImportHandler,
    ListingMappingImportHandler,
  ],
  exports: [ImportExecutorService],
})
export class ImportModule {}
