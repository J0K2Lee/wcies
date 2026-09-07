import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObjectStorageModule } from '../../infrastructure/storage/object-storage.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ProductEntity } from './entities/product.entity';
import { SkuEntity } from './entities/sku.entity';
import { SkuBarcodeEntity } from './entities/sku-barcode.entity';
import { SkuImageEntity } from './entities/sku-image.entity';
import { ProductRepository } from './repositories/product.repository';
import { SkuRepository } from './repositories/sku.repository';
import { SkuBarcodeRepository } from './repositories/sku-barcode.repository';
import { SkuImageRepository } from './repositories/sku-image.repository';
import { ProductService } from './services/product.service';
import { SkuService } from './services/sku.service';
import { BarcodeService } from './services/barcode.service';
import { SkuImageService } from './services/sku-image.service';
import { ProductController } from './controllers/product.controller';
import { SkuController } from './controllers/sku.controller';

/** Product + SKU + barcode + images (spec §94 module layout). */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, SkuEntity, SkuBarcodeEntity, SkuImageEntity]),
    CatalogModule,
    OperationLogModule,
    ObjectStorageModule,
  ],
  controllers: [ProductController, SkuController],
  providers: [
    ProductService,
    SkuService,
    BarcodeService,
    SkuImageService,
    ProductRepository,
    SkuRepository,
    SkuBarcodeRepository,
    SkuImageRepository,
  ],
  exports: [ProductService, SkuService, BarcodeService, SkuImageService],
})
export class ProductModule {}
