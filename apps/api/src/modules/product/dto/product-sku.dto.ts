import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PRODUCT_STATUSES } from '../entities/product.entity';
import { SKU_STATUSES } from '../entities/sku.entity';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * Numeric ceilings mirror the physical column precision so an out-of-range
 * value fails DTO validation (422, field-level message) instead of reaching
 * Postgres and surfacing as an opaque COMMON_DATABASE_ERROR:
 *   skus.weight_g              numeric(12,3) -> 9 digits before the point
 *   skus.latest_purchase_price numeric(18,4) -> 14 digits before the point
 *
 * The price ceiling stops at the integer part: writing out
 * 99999999999999.9999 would not survive float64 (it rounds up to 1e14, which
 * the column then rejects), so the bound is the largest exactly-representable
 * value. Being conservative by <1 unit at 10^14 is irrelevant for a price.
 */
const MAX_WEIGHT_G = 999_999_999.999;
const MAX_PURCHASE_PRICE = 99_999_999_999_999;

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export class CreateProductRequestDto {
  @ApiPropertyOptional({
    example: 'PN000001',
    description: 'Auto-generated (PN%06d) when omitted; read-only after creation',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  productCode?: string;

  @ApiProperty({ example: 'VALKYRIE VK87 MAX V2 机械键盘', maxLength: 500 })
  @IsString()
  @Length(1, 500)
  nameZh!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nameRu?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateProductRequestDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  nameZh?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nameRu?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Must reference one of this product SKU images',
  })
  @IsOptional()
  @IsUUID()
  mainImageId?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class ProductListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches product_code / name_zh / name_ru' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'productCode', 'nameZh'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'productCode', 'nameZh'])
  sortBy?: 'createdAt' | 'updatedAt' | 'productCode' | 'nameZh';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PRD000001' })
  productCode!: string;

  @ApiProperty({ example: 'VALKYRIE VK87 MAX V2 机械键盘' })
  nameZh!: string;

  @ApiProperty({ nullable: true })
  nameRu!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ nullable: true })
  categoryName!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  brandId!: string | null;

  @ApiProperty({ nullable: true })
  brandName!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  mainImageId!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ nullable: true })
  remark!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class ProductListItemDto extends ProductResponseDto {
  @ApiProperty({ example: 2 })
  skuCount!: number;
}

// ---------------------------------------------------------------------------
// SKU
// ---------------------------------------------------------------------------

export class CreateSkuRequestDto {
  @ApiPropertyOptional({
    example: 'SKU000001001',
    description:
      'Auto-generated (SKU{product seq 6}{in-product seq 3}) when omitted; frozen after creation',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  skuCode?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 'VK87 MAX V2 黑色', maxLength: 500 })
  @IsString()
  @Length(1, 500)
  nameZh!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nameRu?: string;

  @ApiPropertyOptional({ example: 'VK87MAX', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @ApiPropertyOptional({ example: '黑色', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  color?: string;

  @ApiPropertyOptional({ example: '87键', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @ApiPropertyOptional({ example: 950, description: 'Grams (g), up to 3 decimals' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_WEIGHT_G)
  weightG?: number;

  @ApiPropertyOptional({
    example: 355,
    description: 'Millimeters, integer. Provide with width and height or not at all',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lengthMm?: number;

  @ApiPropertyOptional({ example: 122, description: 'Millimeters, integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  widthMm?: number;

  @ApiPropertyOptional({ example: 34, description: 'Millimeters, integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  heightMm?: number;

  @ApiPropertyOptional({
    example: 'https://detail.1688.com/offer/123.html',
    maxLength: 1000,
    description: 'Procurement link (1688 / taobao / ...)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purchaseUrl?: string;

  @ApiPropertyOptional({
    example: 299.0,
    description: 'Manually maintained in Sprint 1; up to 4 decimals',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_PURCHASE_PRICE)
  latestPurchasePrice?: number;

  @ApiPropertyOptional({ example: 'CNY', default: 'CNY', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  costCurrency?: string;

  @ApiPropertyOptional({ example: false, description: 'SN tracking config only (task §25)' })
  @IsOptional()
  @IsBoolean()
  serialTracking?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateSkuRequestDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  nameZh?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nameRu?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  color?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @ApiPropertyOptional({ description: 'Grams (g), up to 3 decimals' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_WEIGHT_G)
  weightG?: number;

  @ApiPropertyOptional({
    description: 'Millimeters, integer. Provide with width and height or not at all',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lengthMm?: number;

  @ApiPropertyOptional({ description: 'Millimeters, integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  widthMm?: number;

  @ApiPropertyOptional({ description: 'Millimeters, integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  heightMm?: number;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Procurement link' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purchaseUrl?: string;

  @ApiPropertyOptional({ description: 'Purchase price, up to 4 decimals' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_PURCHASE_PRICE)
  latestPurchasePrice?: number;

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  costCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  serialTracking?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class SkuListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches sku_code / name_zh / name_ru / model' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: SKU_STATUSES })
  @IsOptional()
  @IsIn(SKU_STATUSES)
  status?: (typeof SKU_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Filter SKUs with/without platform listings' })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasListing?: 'true' | 'false';

  @ApiPropertyOptional({ format: 'uuid', description: 'SKU linked to a listing of this platform' })
  @IsOptional()
  @IsUUID()
  platformId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'SKU linked to a listing of this store' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  serialTracking?: 'true' | 'false';

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'skuCode', 'nameZh'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'skuCode', 'nameZh'])
  sortBy?: 'createdAt' | 'updatedAt' | 'skuCode' | 'nameZh';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class SkuResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'SKU000001' })
  skuCode!: string;

  @ApiProperty({ example: 'VK87 MAX V2 黑色' })
  nameZh!: string;

  @ApiProperty({ nullable: true })
  nameRu!: string | null;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'PRD000001' })
  productCode!: string;

  @ApiProperty({ example: 'VALKYRIE VK87 MAX V2 机械键盘' })
  productName!: string;

  @ApiProperty({ nullable: true })
  model!: string | null;

  @ApiProperty({ nullable: true })
  color!: string | null;

  @ApiProperty({ nullable: true })
  size!: string | null;

  @ApiProperty({ nullable: true, example: 950, description: 'Grams (g)' })
  weightG!: number | null;

  @ApiProperty({ nullable: true, example: 355, description: 'Millimeters (integer)' })
  lengthMm!: number | null;

  @ApiProperty({ nullable: true, example: 122, description: 'Millimeters (integer)' })
  widthMm!: number | null;

  @ApiProperty({ nullable: true, example: 34, description: 'Millimeters (integer)' })
  heightMm!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Backend-computed: length_mm x width_mm x height_mm (read-only)',
  })
  volumeMm3!: number | null;

  @ApiProperty({ nullable: true, maxLength: 1000, description: 'Procurement link' })
  purchaseUrl!: string | null;

  @ApiProperty({ nullable: true })
  latestPurchasePrice!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Reserved; null until the purchase sprint (task §24)',
  })
  movingAverageCost!: number | null;

  @ApiProperty({ example: 'CNY' })
  costCurrency!: string;

  @ApiProperty({ example: false })
  serialTracking!: boolean;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ nullable: true })
  remark!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class SkuListItemDto extends SkuResponseDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  brandId!: string | null;

  @ApiProperty({ nullable: true })
  brandName!: string | null;

  @ApiProperty({ nullable: true, description: 'Primary barcode value' })
  primaryBarcode!: string | null;

  @ApiProperty({ nullable: true, description: 'Signed URL of the primary image' })
  primaryImageUrl!: string | null;

  @ApiProperty({ example: 3 })
  listingCount!: number;
}

/** Product detail response: the product plus its SKUs (product detail page). */
export class ProductDetailDto {
  @ApiProperty({ type: ProductResponseDto })
  product!: ProductResponseDto;

  @ApiProperty({ type: [SkuResponseDto] })
  skus!: SkuResponseDto[];
}
