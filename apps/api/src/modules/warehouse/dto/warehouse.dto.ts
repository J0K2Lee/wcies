import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FULFILLMENT_MODES, FulfillmentMode } from '../../platform/constants/platform.constants';
import { WAREHOUSE_STATUSES, WAREHOUSE_TYPES } from '../entities/warehouse.entity';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

// ---------------------------------------------------------------------------
// Warehouse
// ---------------------------------------------------------------------------

export class CreateWarehouseRequestDto {
  @ApiPropertyOptional({
    description:
      'Auto-generated ({prefix}-%02d, e.g. ZG-01) when omitted; immutable after creation',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  warehouseCode?: string;

  @ApiProperty({ example: '深圳自管仓', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ enum: WAREHOUSE_TYPES, example: 'SELF' })
  @IsIn(WAREHOUSE_TYPES)
  warehouseType!: (typeof WAREHOUSE_TYPES)[number];

  @ApiPropertyOptional({ example: 'CN', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @ApiPropertyOptional({ example: '广东', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @ApiPropertyOptional({ example: '深圳', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: '深圳市宝安区...', maxLength: 500 })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateWarehouseRequestDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: (typeof WAREHOUSE_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class WarehouseListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches warehouse_code / name / city' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ enum: WAREHOUSE_TYPES })
  @IsOptional()
  @IsIn(WAREHOUSE_TYPES)
  warehouseType?: (typeof WAREHOUSE_TYPES)[number];

  @ApiPropertyOptional({ enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: (typeof WAREHOUSE_STATUSES)[number];
}

export class WarehouseResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'SZ01' })
  warehouseCode!: string;

  @ApiProperty({ example: '深圳自管仓' })
  name!: string;

  @ApiProperty({ example: 'SELF' })
  warehouseType!: string;

  @ApiProperty({ example: 'CN', nullable: true })
  countryCode!: string | null;

  @ApiProperty({ nullable: true })
  province!: string | null;

  @ApiProperty({ nullable: true })
  city!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true })
  contactName!: string | null;

  @ApiProperty({ nullable: true })
  contactPhone!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ nullable: true })
  remark!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class WarehouseListItemDto extends WarehouseResponseDto {
  @ApiProperty({ example: 20 })
  binCount!: number;

  @ApiProperty({ example: 4, description: '已绑定的平台仓库数（ACTIVE）' })
  boundPlatformWarehouseCount!: number;
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

export class CreateBinRequestDto {
  @ApiPropertyOptional({
    example: 'ZG-01-A03-1',
    description: '完整库位编码，仅导入与特例使用；一般留空，由 zone + rackNumber + level 生成',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  binCode?: string;

  @ApiPropertyOptional({ example: 'A', description: '库区；同时作为货架编码前缀（A → 货架 A03）' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zone?: string;

  @ApiPropertyOptional({
    example: 3,
    description: '货架号；与 zone 组合成完整货架（区 A + 3 → A03）。与 rack 二选一。',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  rackNumber?: number;

  @ApiPropertyOptional({ example: 'A03', description: '完整货架值，仅导入使用；一般用 rackNumber' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  rack?: string;

  @ApiPropertyOptional({ example: '1', description: '层号' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  level?: string;

  @ApiPropertyOptional({ example: '02', description: '位号（选填）' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @ApiPropertyOptional({ example: 'ZG-01-A03-1', description: '留空则与库位编码相同' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  barcode?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateBinRequestDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  rack?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  level?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  barcode?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class BinListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches bin_code / barcode / zone / rack' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Exact zone match' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class BinResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId!: string;

  @ApiProperty({ example: 'ZG-01-A01-1' })
  binCode!: string;

  @ApiProperty({ nullable: true })
  zone!: string | null;

  @ApiProperty({ nullable: true })
  rack!: string | null;

  @ApiProperty({ nullable: true })
  level!: string | null;

  @ApiProperty({ nullable: true })
  position!: string | null;

  @ApiProperty({ example: 'ZG-01-A01-1', nullable: true })
  barcode!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ nullable: true })
  remark!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/**
 * Batch creation (task §41, revised 2026-09-11): the caller states the layout
 * intent and the server owns the bin_code format, because bin_code is
 * immutable and printed on physical labels:
 *   zone 'A', rackStart 1, rackCount 5, levelsPerRack 4
 *     -> ZG-01-A01-1 … ZG-01-A05-4 (20 bins)
 */
export class BatchCreateBinsRequestDto {
  @ApiPropertyOptional({
    example: 'A',
    description: '库区；同时作为货架编码前缀（A → 货架 A01）。留空则货架编码无前缀。',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zone?: string;

  @ApiProperty({ example: 1, description: '起始货架号（含）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  rackStart!: number;

  @ApiProperty({ example: 5, description: '货架数量' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  rackCount!: number;

  @ApiProperty({ example: 4, description: '每个货架的层数' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  levelsPerRack!: number;
}

export class BatchCreateBinsResponseDto {
  @ApiProperty({ example: 20 })
  createdCount!: number;

  @ApiProperty({ type: [BinResponseDto] })
  bins!: BinResponseDto[];
}

/**
 * 批量删除（用户指示 2026-09-28）：逐个执行与单删完全相同的零引用规则
 * （decision 0003）——被引用/不存在的库位跳过并逐条返回原因，部分成功。
 */
export class BatchDeleteBinsRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: '要删除的库位 ID 列表（1~2000 个，重复自动去重）',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  binIds!: string[];
}

export class BatchDeleteBinFailureDto {
  @ApiProperty({ format: 'uuid' })
  binId!: string;

  @ApiProperty({ nullable: true, example: 'ZG-01-A03-1' })
  binCode!: string | null;

  @ApiProperty({ example: '该库位已被引用（inventory_balances），只能停用不能删除' })
  reason!: string;
}

export class BatchDeleteBinsResponseDto {
  @ApiProperty({ example: 18, description: '成功删除的库位数' })
  deletedCount!: number;

  @ApiProperty({ type: [BatchDeleteBinFailureDto], description: '未删除的库位及原因' })
  failures!: BatchDeleteBinFailureDto[];
}

// ---------------------------------------------------------------------------
// Warehouse platform bindings（仓库绑定平台仓库，用户指示 2026-09-17）
// ---------------------------------------------------------------------------

export class CreatePlatformBindingRequestDto {
  @ApiProperty({ format: 'uuid', description: '平台仓库归属的店铺' })
  @IsUUID()
  storeId!: string;

  @ApiProperty({
    example: '1020005000770362',
    description: '平台仓库 ID（OZON warehouse_id 等），同店铺内唯一',
  })
  @IsString()
  @Length(1, 64)
  platformWarehouseId!: string;

  @ApiPropertyOptional({ example: 'OZON 莫斯科东仓', description: '平台侧仓库名称快照' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformWarehouseName?: string;

  @ApiProperty({ enum: FULFILLMENT_MODES, example: 'OZON_FBO' })
  @IsIn(FULFILLMENT_MODES)
  fulfillmentMode!: FulfillmentMode;

  @ApiPropertyOptional({ example: '俄东主仓', description: '操作者备注名' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarkName?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number;
}

export class PlatformBindingListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: '按仓库过滤' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class PlatformBindingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId!: string;

  @ApiProperty({ example: 'SZ01' })
  warehouseCode!: string;

  @ApiProperty({ example: '深圳自管仓' })
  warehouseName!: string;

  @ApiProperty({ format: 'uuid' })
  storeId!: string;

  @ApiProperty({ example: 'OZON-A' })
  storeCode!: string;

  @ApiProperty({ example: 'OZON A店' })
  storeName!: string;

  @ApiProperty({ example: 'OZON' })
  platformCode!: string;

  @ApiProperty({ example: '1020005000770362' })
  platformWarehouseId!: string;

  @ApiProperty({ nullable: true, example: 'OZON 莫斯科东仓' })
  platformWarehouseName!: string | null;

  @ApiProperty({ example: 'OZON_FBO' })
  fulfillmentMode!: string;

  @ApiProperty({ nullable: true, example: '俄东主仓' })
  remarkName!: string | null;

  @ApiProperty({ example: 100 })
  priority!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
