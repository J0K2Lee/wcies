import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObjectStorageModule } from '../../infrastructure/storage/object-storage.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OzonModule } from '../integration/ozon/ozon.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductModule } from '../product/product.module';
import { StoreModule } from '../store/store.module';
import { OrderModule } from '../order/order.module';
import { PlatformListingEntity } from './entities/platform-listing.entity';
import { PlatformListingSkuEntity } from './entities/platform-listing-sku.entity';
import { PlatformCategoryMappingEntity } from './entities/platform-category-mapping.entity';
import { ListingRepository } from './repositories/listing.repository';
import { PlatformCategoryMappingRepository } from './repositories/platform-category-mapping.repository';
import { ListingService } from './services/listing.service';
import { ListingResolverService } from './services/listing-resolver.service';
import { ListingOnboardingService } from './services/listing-onboarding.service';
import { ListingSkuMatchService } from './services/listing-sku-match.service';
import { ListingExportService } from './services/listing-export.service';
import { ListingVariantBackfillService } from './services/listing-variant-backfill.service';
import { CategoryImportService } from './services/category-import.service';
import { ListingController } from './controllers/listing.controller';
import { CategoryImportController } from './controllers/category-import.controller';

/**
 * Platform listings + SKU mappings + resolver (spec §97 module layout).
 * Sprint 8.5: also hosts the platform-category mapping domain (tree import
 * orchestration + composite-key resolution) next to the variant rows it
 * enriches.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformListingEntity,
      PlatformListingSkuEntity,
      PlatformCategoryMappingEntity,
    ]),
    PlatformModule,
    StoreModule,
    ProductModule,
    CatalogModule,
    OzonModule,
    OperationLogModule,
    ObjectStorageModule,
    // listing ↔ order 循环：映射落定后回调 order 的批量收敛（2026-10-15）。
    forwardRef(() => OrderModule),
  ],
  controllers: [ListingController, CategoryImportController],
  providers: [
    ListingService,
    ListingResolverService,
    ListingRepository,
    PlatformCategoryMappingRepository,
    ListingOnboardingService,
    ListingSkuMatchService,
    ListingExportService,
    ListingVariantBackfillService,
    CategoryImportService,
  ],
  exports: [ListingService, ListingResolverService],
})
export class ListingModule {}
