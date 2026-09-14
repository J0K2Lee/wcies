import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
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

/** Sprint 8 T1: quick-create Product+SKU(+barcode) and map the variant in one action. */
export class ListingOnboardRequestDto {
  @ApiPropertyOptional({
    description: '商品名；缺省取 Listing 标题',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  productNameZh?: string;

  @ApiPropertyOptional({
    description: 'SKU 名；缺省取 Listing 标题',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  skuNameZh?: string;

  @ApiPropertyOptional({
    default: true,
    description: '同时生成内部条码（W…，决策 0017），生成后可直接打印标签',
  })
  @IsOptional()
  @IsBoolean()
  generateBarcode?: boolean;

  @ApiPropertyOptional({
    description: 'Sprint 8.5 T2：挂靠到该已有商品（多变体同挂一个 Product）',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  existingProductId?: string;

  @ApiPropertyOptional({
    description: 'Sprint 8.5 T2：显式另建新商品（覆盖「缺省自动挂靠已有商品」）',
  })
  @IsOptional()
  @IsBoolean()
  createNewProduct?: boolean;

  @ApiPropertyOptional({
    description: 'Sprint 8.5 T4：商品品牌（仅新建商品时生效）',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({
    description: 'Sprint 8.5 T3c：商品分类（三级，仅新建商品时生效）',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Sprint 8.5 T3c：记住「平台类目→内部类目」映射（onboard 同一事务写入，同类目后续自动命中）',
  })
  @IsOptional()
  @IsBoolean()
  rememberCategoryMapping?: boolean;

  @ApiPropertyOptional({ description: 'Sprint 8.5 T5：重量（g），可编辑预填' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightG?: number;

  @ApiPropertyOptional({ description: 'Sprint 8.5 T5：长（mm）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lengthMm?: number;

  @ApiPropertyOptional({ description: 'Sprint 8.5 T5：宽（mm）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  widthMm?: number;

  @ApiPropertyOptional({ description: 'Sprint 8.5 T5：高（mm）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  heightMm?: number;

  @ApiPropertyOptional({
    description:
      'Sprint 8.5R1：最新采购价（CNY，人工录入通道；与仅由收货确认维护的移动加权平均成本无关）',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  latestPurchasePrice?: number;
}

export class ListingOnboardProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PN000012' })
  productCode!: string;

  @ApiProperty({ example: 'VK87 MAX V2 机械键盘' })
  nameZh!: string;
}

export class ListingOnboardSkuDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'SKU000012001' })
  skuCode!: string;

  @ApiProperty({ example: 'VK87 MAX V2 机械键盘' })
  nameZh!: string;
}

export class ListingOnboardResponseDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty({ format: 'uuid' })
  mappingId!: string;

  @ApiProperty({ enum: ['MAPPED'], description: '成功后恒为 MAPPED' })
  mappingStatus!: string;

  @ApiProperty({ type: ListingOnboardProductDto })
  product!: ListingOnboardProductDto;

  @ApiProperty({
    type: ListingOnboardSkuDto,
  })
  sku!: ListingOnboardSkuDto;

  @ApiProperty({ nullable: true, example: 'W00000042', description: '未勾选生成时为 null' })
  barcode!: string | null;

  @ApiProperty({
    example: false,
    description: 'Sprint 8.5 T2：本次是否新建了商品（false = 挂靠已有商品）',
  })
  productCreated!: boolean;
}

/** Sprint 8.5: one feed powering the enhanced onboarding dialog. */
export class OnboardContextVariantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['UNMAPPED', 'MAPPED'] })
  mappingStatus!: string;

  @ApiProperty({ nullable: true })
  platformSkuId!: string | null;

  @ApiProperty({ nullable: true })
  offerId!: string | null;

  @ApiProperty({ nullable: true })
  sellerSku!: string | null;

  @ApiProperty({ nullable: true, description: '已映射时该变体绑定的内部 SKU 编码' })
  skuCode!: string | null;

  @ApiProperty({ nullable: true, description: '已映射时该变体绑定的内部商品 id（挂靠目标）' })
  productId!: string | null;

  @ApiProperty({ nullable: true, description: '已映射时该变体绑定的内部商品编码' })
  productCode!: string | null;

  @ApiProperty({ nullable: true, description: 'raw_data.primary_image CDN 直链' })
  primaryImage!: string | null;

  @ApiProperty({ nullable: true, description: 'raw_data.color_image CDN 直链（转存优先用它）' })
  colorImage!: string | null;

  @ApiProperty({ nullable: true, description: '平台类目 id（raw_data.description_category_id）' })
  descriptionCategoryId!: string | null;

  @ApiProperty({ nullable: true, description: '平台类型 id（raw_data.type_id）' })
  descriptionTypeId!: string | null;

  @ApiProperty({
    nullable: true,
    format: 'uuid',
    description: '复合键命中的内部三级分类（未命中为 null，人工选择）',
  })
  suggestedCategoryId!: string | null;

  @ApiProperty({ nullable: true, description: 'v4 enrichment 预填重量（g）' })
  weightG!: number | null;

  @ApiProperty({ nullable: true, description: 'v4 enrichment 预填长（mm）' })
  lengthMm!: number | null;

  @ApiProperty({ nullable: true, description: 'v4 enrichment 预填宽（mm）' })
  widthMm!: number | null;

  @ApiProperty({ nullable: true, description: 'v4 enrichment 预填高（mm）' })
  heightMm!: number | null;
}

export class ListingOnboardContextDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty({
    nullable: true,
    format: 'uuid',
    description: '缺省挂靠目标：该 Listing 首个已建档变体的商品；无则为 null（新建）',
  })
  defaultAttachProductId!: string | null;

  @ApiProperty({ nullable: true, example: 'PN000012' })
  defaultAttachProductCode!: string | null;

  @ApiProperty({ nullable: true, example: 'VK87 MAX V2 机械键盘' })
  defaultAttachProductName!: string | null;

  @ApiProperty({ type: [OnboardContextVariantDto] })
  variants!: OnboardContextVariantDto[];
}

/** Sprint 8 T3: global mapped/unmapped counters for the workbench header. */
export class ListingMappingStatsDto {
  @ApiProperty({ example: 1 })
  mapped!: number;

  @ApiProperty({ example: 1323 })
  unmapped!: number;
}

/** Sprint 8 T2: signed-URL download descriptor for the unmapped export. */
export class UnmappedListingExportResponseDto {
  @ApiProperty({ example: 'exports/unmapped-listings/1760000000000-unmapped-listings.xlsx' })
  objectKey!: string;

  @ApiProperty({ description: '短时效签名下载链接（直接打开即下载）' })
  downloadUrl!: string;

  @ApiProperty({ example: 1323, description: '导出的未映射变体行数' })
  rowCount!: number;
}

export class UnmappedListingExportRequestDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  platformId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  storeId?: string;
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

  @ApiProperty({ example: 2, description: '该 Listing 的变体映射总数（含未映射）' })
  mappingCount!: number;

  @ApiProperty({
    enum: ['MAPPED', 'UNMAPPED'],
    example: 'MAPPED',
    description: '是否至少有一个 ACTIVE 且已绑定内部 SKU 的变体；与 mappingState 筛选同一判定',
  })
  mappingStatus!: 'MAPPED' | 'UNMAPPED';

  @ApiProperty({
    example: false,
    description:
      '是否有未解决的 ORDER_SKU_MAPPING_FAILED 异常撞上该 Listing（派生展示，Sprint 8 T3）',
  })
  hasOrderException!: boolean;
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

  @ApiPropertyOptional({ maxLength: 255, description: '解析标识之一（决策 0016）' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformSkuId?: string;

  @ApiPropertyOptional({ maxLength: 255, description: '解析标识之一（决策 0016）' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerSku?: string;
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

  @ApiProperty({
    example: null,
    nullable: true,
    description: '决策 0016 起恒为 null：Offer ID 可被运营修改，不作为订单解析依据（字段保留兼容）',
  })
  matchedOfferId!: string | null;

  @ApiProperty({ example: 'VK87-BLK', nullable: true })
  matchedSellerSku!: string | null;

  @ApiProperty({ example: '152987456', nullable: true })
  matchedPlatformSkuId!: string | null;
}

/** Sprint 8.5 T3b: dry-run import report (no writes). */
export class CategoryImportStatsDto {
  @ApiProperty({ example: 7933 })
  totalNodes!: number;

  @ApiProperty({ example: 0 })
  skippedDisabled!: number;

  @ApiProperty({ example: 0 })
  skippedOrphaned!: number;

  @ApiProperty({ example: 22 })
  duplicateCompositeKeys!: number;

  @ApiProperty({ type: Object })
  toCreate!: { level1: number; level2: number; level3: number };
}

export class CategoryImportConflictDto {
  @ApiProperty({ example: '积木' })
  name!: string;

  @ApiProperty({ example: 3 })
  level!: number;

  @ApiProperty({ example: 'name_ru「Конструктор」与现有分类「积木」精确重名' })
  reason!: string;
}

export class CategoryImportTopLevelPreviewDto {
  @ApiProperty({ example: '儿童用品' })
  nameZh!: string;

  @ApiProperty({ nullable: true, example: 'Детские товары' })
  nameRu!: string | null;

  @ApiProperty({ example: 21 })
  level2Count!: number;

  @ApiProperty({ example: 289 })
  level3Count!: number;
}

export class CategoryImportRenameDto {
  @ApiProperty({ example: '其他' })
  name!: string;

  @ApiProperty({ example: '其他 (91543)' })
  renamedTo!: string;
}

export class CategoryImportPreviewDto {
  @ApiProperty({ format: 'uuid' })
  platformId!: string;

  @ApiProperty({ type: CategoryImportStatsDto })
  stats!: CategoryImportStatsDto;

  @ApiProperty({ type: [CategoryImportConflictDto] })
  conflicts!: CategoryImportConflictDto[];

  @ApiProperty({
    type: [CategoryImportRenameDto],
    description: '同父同名候选的确定性去重命名（§89 不丢弃）',
  })
  disambiguatedNames!: CategoryImportRenameDto[];

  @ApiProperty({ example: 57 })
  disambiguatedCount!: number;

  @ApiProperty({ type: [CategoryImportTopLevelPreviewDto] })
  previewTopLevels!: CategoryImportTopLevelPreviewDto[];
}

export class CategoryImportResultDto {
  @ApiProperty({ format: 'uuid' })
  platformId!: string;

  @ApiProperty({ type: Object })
  created!: { level1: number; level2: number; level3: number };

  @ApiProperty({ example: 7365 })
  mappingCount!: number;
}

export class CategoryImportRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  platformId!: string;
}
