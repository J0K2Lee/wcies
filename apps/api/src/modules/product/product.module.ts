import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObjectStorageModule } from '../../infrastructure/storage/object-storage.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { SkuEntity } from './entities/sku.entity';
import { SkuBarcodeEntity } from './entities/sku-barcode.entity';
import { SkuImageEntity } from './entities/sku-image.entity';
import { SkuBundleComponentEntity } from './entities/sku-bundle-component.entity';
import { SkuRepository } from './repositories/sku.repository';
import { SkuBarcodeRepository } from './repositories/sku-barcode.repository';
import { SkuImageRepository } from './repositories/sku-image.repository';
import { SkuService } from './services/sku.service';
import { BarcodeService } from './services/barcode.service';
import { SkuImageService } from './services/sku-image.service';
import { SkuImageImportService } from './services/sku-image-import.service';
import { SkuBundleService } from './services/sku-bundle.service';
import { SkuImageImportProcessor } from './processors/sku-image-import.processor';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { SkuController } from './controllers/sku.controller';
import { BarcodeController } from './controllers/barcode.controller';

/**
 * Internal SKU + barcode + images (spec §94 module layout).
 *
 * V1 refactor (2026-10-13): the Product/SPU layer is gone - the module keeps
 * its name and its public exports so the 11 consuming modules need no change.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SkuEntity,
      SkuBarcodeEntity,
      SkuImageEntity,
      SkuBundleComponentEntity,
    ]),
    BullModule.registerQueue({ name: QUEUE_NAMES.media }),
    CatalogModule,
    OperationLogModule,
    ObjectStorageModule,
  ],
  controllers: [SkuController, BarcodeController],
  providers: [
    SkuService,
    BarcodeService,
    SkuImageService,
    SkuImageImportService,
    SkuImageImportProcessor,
    SkuBundleService,
    SkuRepository,
    SkuBarcodeRepository,
    SkuImageRepository,
  ],
  exports: [SkuService, BarcodeService, SkuImageService, SkuImageImportService, SkuBundleService],
})
export class ProductModule {}
