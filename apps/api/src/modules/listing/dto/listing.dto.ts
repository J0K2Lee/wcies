import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { LISTING_STATUSES } from '../entities/platform-listing.entity';

/** One variant row of a listing creation payload (spec §84). */
export class ListingSkuVariantDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiPropertyOptional({ example: '152987456', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformSkuId?: string;

  @ApiPropertyOptional({ example: 'VK87-BLK', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerSku?: string;

  @ApiPropertyOptional({ example: 'ABC', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  offerId?: string;
}

export class CreateListingRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  platformId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  storeId!: string;

  @ApiProperty({ example: '152987456001', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  platformProductId!: string;

  @ApiPropertyOptional({ example: 'VK87 MAX V2 机械键盘', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  title?: string;

  @ApiPropertyOptional({ example: 'https://ozon.ru/product/152987456001', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  rawData?: Record<string, unknown>;

  @ApiProperty({ type: [ListingSkuVariantDto], description: 'Variant rows mapped in one submit' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ListingSkuVariantDto)
  skuVariants!: ListingSkuVariantDto[];
}

export class UpdateListingRequestDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  rawData?: Record<string, unknown>;
}

export class AddListingSkuRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformSkuId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerSku?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  offerId?: string;
}

/** Human mapping of a synced UNMAPPED platform SKU to an internal SKU (Sprint 5 §36). */
export class MapListingSkuRequestDto {
  @ApiProperty({ format: 'uuid', description: '目标 Internal SKU' })
  @IsUUID()
  skuId!: string;
}

export class UpdateListingSkuRequestDto {
  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformSkuId?: string | null;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerSku?: string | null;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  offerId?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class ListingListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  platformId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Listings mapping this internal SKU' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ enum: LISTING_STATUSES })
  @IsOptional()
  @IsIn(LISTING_STATUSES)
  status?: (typeof LISTING_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['MAPPED', 'UNMAPPED'] })
  @IsOptional()
  @IsIn(['MAPPED', 'UNMAPPED'])
  mappingState?: 'MAPPED' | 'UNMAPPED';

  @ApiPropertyOptional({ description: 'Matches platform_product_id / title' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class ListingSkuResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty({ nullable: true, format: 'uuid', description: 'UNMAPPED 平台SKU为 null' })
  skuId!: string | null;

  @ApiProperty({ nullable: true, example: 'SKU000001', description: 'UNMAPPED 行为 null' })
  skuCode!: string | null;

  @ApiProperty({ nullable: true, example: 'VK87 MAX V2 黑色', description: 'UNMAPPED 行为 null' })
  skuName!: string | null;

  @ApiProperty({ enum: ['UNMAPPED', 'MAPPED'], description: '人工映射状态（Sprint 5）' })
  mappingStatus!: string;

  @ApiProperty({ nullable: true })
  platformSkuId!: string | null;

  @ApiProperty({ nullable: true })
  sellerSku!: string | null;

  @ApiProperty({ nullable: true })
  offerId!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class ListingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ nullable: true, type: Date, description: '最近一次被 Listing Sync 观察到的时间' })
  lastSeenAt!: Date | null;

  @ApiProperty({ format: 'uuid' })
  platformId!: string;

  @ApiProperty({ example: 'OZON' })
  platformCode!: string;

  @ApiProperty({ format: 'uuid' })
  storeId!: string;

  @ApiProperty({ example: 'OZON-A' })
  storeCode!: string;

  @ApiProperty({ example: 'OZON A店' })
  storeName!: string;

  @ApiProperty({ example: '152987456001' })
  platformProductId!: string;

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty({ nullable: true })
  url!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ example: 2 })
  mappingCount!: number;
}

export class ListingDetailDto extends ListingResponseDto {
  @ApiProperty({ type: [ListingSkuResponseDto] })
  skus!: ListingSkuResponseDto[];
}

// ---- Resolver ----

export class ResolveSkuRequestDto {
  @ApiProperty({ format: 'uuid', description: 'MANDATORY store scope (task §52)' })
  @IsUUID()
  storeId!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformSkuId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerSku?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  offerId?: string;
}

export class ResolveSkuResponseDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty({ format: 'uuid' })
  listingSkuId!: string;

  @ApiProperty({ format: 'uuid' })
  internalSkuId!: string;

  @ApiProperty({ example: 'SKU000001' })
  internalSkuCode!: string;

  @ApiProperty({ example: 'ABC', nullable: true })
  matchedOfferId!: string | null;

  @ApiProperty({ example: 'VK87-BLK', nullable: true })
  matchedSellerSku!: string | null;

  @ApiProperty({ example: '152987456', nullable: true })
  matchedPlatformSkuId!: string | null;
}
