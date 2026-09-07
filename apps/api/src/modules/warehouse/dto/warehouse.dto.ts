import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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
  @ApiProperty({ example: 'SZ01', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  warehouseCode!: string;

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

  @ApiProperty({ example: 4 })
  boundStoreCount!: number;
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

export class CreateBinRequestDto {
  @ApiProperty({ example: 'SZ01-A01-01', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  binCode!: string;

  @ApiPropertyOptional({ example: 'A' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @ApiPropertyOptional({ example: 'A01' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  rack?: string;

  @ApiPropertyOptional({ example: '01' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  level?: string;

  @ApiPropertyOptional({ example: '01' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @ApiPropertyOptional({ example: 'BIN-SZ01-A01-01', description: 'Auto-generated when omitted' })
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

  @ApiProperty({ example: 'SZ01-A01-01' })
  binCode!: string;

  @ApiProperty({ nullable: true })
  zone!: string | null;

  @ApiProperty({ nullable: true })
  rack!: string | null;

  @ApiProperty({ nullable: true })
  level!: string | null;

  @ApiProperty({ nullable: true })
  position!: string | null;

  @ApiProperty({ example: 'BIN-SZ01-A01-01', nullable: true })
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

/** Batch creation (task §41): e.g. rack A01~A05 x level 01~04. */
export class BatchCreateBinsRequestDto {
  @ApiPropertyOptional({ example: 'A', description: 'Stored on every generated bin' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @ApiProperty({ example: 'A01' })
  @IsString()
  @MaxLength(100)
  rackFrom!: string;

  @ApiProperty({ example: 'A05' })
  @IsString()
  @MaxLength(100)
  rackTo!: string;

  @ApiProperty({ example: '01' })
  @IsString()
  @MaxLength(100)
  levelFrom!: string;

  @ApiProperty({ example: '04' })
  @IsString()
  @MaxLength(100)
  levelTo!: string;

  @ApiPropertyOptional({
    example: '01',
    description: 'Position range; omit for no position suffix',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  positionFrom?: string;

  @ApiPropertyOptional({ example: '02' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  positionTo?: string;
}

export class BatchCreateBinsResponseDto {
  @ApiProperty({ example: 20 })
  createdCount!: number;

  @ApiProperty({ type: [BinResponseDto] })
  bins!: BinResponseDto[];
}

// ---------------------------------------------------------------------------
// Store warehouse bindings
// ---------------------------------------------------------------------------

export class CreateBindingRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: FULFILLMENT_MODES, example: 'OZON_RFBS' })
  @IsIn(FULFILLMENT_MODES)
  fulfillmentMode!: FulfillmentMode;

  @ApiPropertyOptional({ example: '123456', description: 'Warehouse id on the platform side' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformWarehouseId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isInventorySource?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isInventoryPushEnabled?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateBindingRequestDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  platformWarehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isInventorySource?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isInventoryPushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class BindingListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class BindingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  storeId!: string;

  @ApiProperty({ example: 'OZON-A' })
  storeCode!: string;

  @ApiProperty({ example: 'OZON A店' })
  storeName!: string;

  @ApiProperty({ example: 'OZON' })
  platformCode!: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId!: string;

  @ApiProperty({ example: 'SZ01' })
  warehouseCode!: string;

  @ApiProperty({ example: '深圳自管仓' })
  warehouseName!: string;

  @ApiProperty({ example: 'OZON_RFBS' })
  fulfillmentMode!: string;

  @ApiProperty({ nullable: true })
  platformWarehouseId!: string | null;

  @ApiProperty({ example: true })
  isInventorySource!: boolean;

  @ApiProperty({ example: false })
  isInventoryPushEnabled!: boolean;

  @ApiProperty({ example: 100 })
  priority!: number;

  @ApiProperty({ type: Object, nullable: true })
  settings!: Record<string, unknown> | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
