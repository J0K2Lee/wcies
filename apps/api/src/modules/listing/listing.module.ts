import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductModule } from '../product/product.module';
import { StoreModule } from '../store/store.module';
import { PlatformListingEntity } from './entities/platform-listing.entity';
import { PlatformListingSkuEntity } from './entities/platform-listing-sku.entity';
import { ListingRepository } from './repositories/listing.repository';
import { ListingService } from './services/listing.service';
import { ListingResolverService } from './services/listing-resolver.service';
import { ListingController } from './controllers/listing.controller';

/** Platform listings + SKU mappings + resolver (spec §97 module layout). */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformListingEntity, PlatformListingSkuEntity]),
    PlatformModule,
    StoreModule,
    ProductModule,
    OperationLogModule,
  ],
  controllers: [ListingController],
  providers: [ListingService, ListingResolverService, ListingRepository],
  exports: [ListingService, ListingResolverService],
})
export class ListingModule {}
