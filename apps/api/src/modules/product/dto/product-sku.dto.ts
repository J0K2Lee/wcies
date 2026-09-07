import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
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

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export class CreateProductRequestDto {
  @ApiPropertyOptional({
    example: 'PRD000001',
    description: 'Auto-generated (PRD%06d) when omitted',
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
  @ApiPropertyOptional({
    description: 'Business code is editable; the UUID never changes (task §16)',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  productCode?: string;

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

export class ProductListQueryDto {
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
    example: 'VK87-BLK',
    description: 'Auto-generated (SKU%06d) when omitted',
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

  @ApiPropertyOptional({ example: 0.95 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  weightKg?: number;

  @ApiPropertyOptional({
    example: 35.5,
    description: 'Provide with width and height or not at all',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  lengthCm?: number;

  @ApiPropertyOptional({ example: 12.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  widthCm?: number;

  @ApiPropertyOptional({ example: 3.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  heightCm?: number;

  @ApiPropertyOptional({ example: 299.0, description: 'Manually maintained in Sprint 1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  latestPurchasePrice?: number;

  @ApiPropertyOptional({ example: 'CNY', default: 'CNY', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  costCurrency?: string;

  @ApiPropertyOptional({ example: false, description: 'SN tracking config only (task §25)' })
  @IsOptional()
  serialTracking?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateSkuRequestDto {
  @ApiPropertyOptional({ description: 'Business code is editable; the UUID never changes' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  skuCode?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  weightKg?: number;

  @ApiPropertyOptional({ description: 'Provide with width and height or not at all' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  lengthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  widthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  heightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  latestPurchasePrice?: number;

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  costCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  serialTracking?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class SkuListQueryDto {
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

  @ApiProperty({ nullable: true, example: 0.95 })
  weightKg!: number | null;

  @ApiProperty({ nullable: true, example: 35.5 })
  lengthCm!: number | null;

  @ApiProperty({ nullable: true, example: 12.2 })
  widthCm!: number | null;

  @ApiProperty({ nullable: true, example: 3.4 })
  heightCm!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Backend-computed: length x width x height (read-only)',
  })
  volumeCm3!: number | null;

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
