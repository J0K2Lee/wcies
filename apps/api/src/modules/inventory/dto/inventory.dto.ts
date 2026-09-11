import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  INVENTORY_CONDITIONS,
  INVENTORY_EVENT_TYPES,
  INVENTORY_REFERENCE_TYPES,
  INVENTORY_ROW_STATUSES,
  RESERVATION_REFERENCE_TYPES,
  RESERVATION_STATUSES,
} from '../enums/inventory.constants';
import {
  InventoryCondition,
  InventoryEventType,
  InventoryReferenceType,
  InventoryRowStatus,
  ReservationReferenceType,
  ReservationStatus,
} from '../enums/inventory.constants';

/** NUMERIC(18,3) string; sign only where deltas are allowed. */
const QTY_PATTERN = /^-?\d{1,15}(\.\d{1,3})?$/;
const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;

/** Accepts both 3 and "3" from clients; the wire format stays string. */
const asQuantityString = ({ value }: { value: unknown }): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

export class BalanceSnapshotDto {
  @ApiProperty() balanceId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() binId!: string;
  @ApiProperty({ enum: INVENTORY_CONDITIONS }) condition!: string;
  @ApiProperty({ example: '10.000' }) onHandQty!: string;
  @ApiProperty({ example: '0.000' }) reservedQty!: string;
  @ApiProperty({ example: '0.000' }) pickedQty!: string;
}

export class StockChangeResultDto {
  @ApiProperty({ example: 'IEV00000042' }) eventNo!: string;
  @ApiProperty({ type: [String], example: ['IEV00000042-1'] }) transactionNos!: string[];
  @ApiProperty({ type: BalanceSnapshotDto }) balance!: BalanceSnapshotDto;
  @ApiProperty({ example: false }) idempotentReplay!: boolean;
}

export class MoveBinResultDto extends StockChangeResultDto {
  @ApiProperty() fromBalance!: { balanceId: string; binId: string; onHandQty: string };
  @ApiProperty() toBalance!: { balanceId: string; binId: string; onHandQty: string };
}

export class InventoryRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'VK87-BLK' }) skuCode!: string;
  @ApiProperty({ example: 'VK87 MAX V2 黑色' }) skuName!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ example: 'SZ01' }) warehouseCode!: string;
  @ApiProperty({ example: '深圳自管仓' }) warehouseName!: string;
  @ApiProperty() binId!: string;
  @ApiProperty({ example: 'ZG-01-A01-1' }) binCode!: string;
  @ApiProperty({ enum: INVENTORY_CONDITIONS }) condition!: string;
  @ApiProperty({ example: '10.000' }) onHandQty!: string;
  @ApiProperty({ example: '2.000' }) reservedQty!: string;
  @ApiProperty({ example: '0.000' }) pickedQty!: string;
  @ApiProperty({ example: '8.000' }) physicalAvailableQty!: string;
  @ApiProperty({ example: '2.000' }) safetyQty!: string;
  @ApiProperty({ example: '6.000' }) sellableAvailableQty!: string;
  @ApiProperty({ enum: INVENTORY_ROW_STATUSES }) status!: string;
}

export class SkuInventoryWarehouseDto {
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty() onHandQty!: string;
  @ApiProperty() reservedQty!: string;
  @ApiProperty() pickedQty!: string;
  @ApiProperty() physicalAvailableQty!: string;
  @ApiProperty() safetyQty!: string;
  @ApiProperty() sellableAvailableQty!: string;
}

export class SkuInventoryTotalsDto {
  @ApiProperty() onHandQty!: string;
  @ApiProperty() reservedQty!: string;
  @ApiProperty() pickedQty!: string;
  @ApiProperty() physicalAvailableQty!: string;
  @ApiProperty() safetyQty!: string;
  @ApiProperty() sellableAvailableQty!: string;
}

export class SkuInventoryDetailDto {
  @ApiProperty() skuId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty() skuName!: string;
  @ApiProperty({ type: SkuInventoryTotalsDto }) totals!: SkuInventoryTotalsDto;
  @ApiProperty({ type: [SkuInventoryWarehouseDto] }) warehouses!: SkuInventoryWarehouseDto[];
  @ApiProperty({ type: [InventoryRowDto] }) bins!: InventoryRowDto[];
}

export class TransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'IEV00000042-1' }) transactionNo!: string;
  @ApiProperty({ example: 'IEV00000042' }) eventNo!: string;
  @ApiProperty({ enum: INVENTORY_EVENT_TYPES }) eventType!: string;
  @ApiProperty({ enum: INVENTORY_EVENT_TYPES }) transactionType!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty() binId!: string;
  @ApiProperty() binCode!: string;
  @ApiProperty() quantityBefore!: string;
  @ApiProperty() quantityChange!: string;
  @ApiProperty() quantityAfter!: string;
  @ApiPropertyOptional({ nullable: true }) reservedBefore!: string | null;
  @ApiPropertyOptional({ nullable: true }) reservedChange!: string | null;
  @ApiPropertyOptional({ nullable: true }) reservedAfter!: string | null;
  @ApiPropertyOptional({ nullable: true }) pickedBefore!: string | null;
  @ApiPropertyOptional({ nullable: true }) pickedChange!: string | null;
  @ApiPropertyOptional({ nullable: true }) pickedAfter!: string | null;
  @ApiProperty({ enum: INVENTORY_REFERENCE_TYPES }) referenceType!: string;
  @ApiProperty() referenceId!: string;
  @ApiPropertyOptional({ nullable: true }) operatorId!: string | null;
  @ApiPropertyOptional({ nullable: true }) operatorName!: string | null;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class ReservationLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() binId!: string;
  @ApiProperty() binCode!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() pickedQty!: string;
  @ApiProperty() status!: string;
}

export class ReservationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'RSV00000001' }) reservationNo!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty({ enum: RESERVATION_REFERENCE_TYPES }) referenceType!: string;
  @ApiProperty() referenceId!: string;
  @ApiProperty() requestedQty!: string;
  @ApiProperty({ enum: RESERVATION_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) pickedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) releasedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) consumedAt!: Date | null;
  @ApiProperty({ type: [ReservationLineDto] }) lines!: ReservationLineDto[];
  @ApiProperty({ example: false }) idempotentReplay!: boolean;
}

export class ReservationListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() reservationNo!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty() referenceType!: string;
  @ApiProperty() referenceId!: string;
  @ApiProperty() requestedQty!: string;
  @ApiProperty({ enum: RESERVATION_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) pickedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) releasedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) consumedAt!: Date | null;
}

export class SafetyStockDto {
  @ApiProperty() id!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty() safetyQty!: string;
  @ApiProperty({ type: Date }) updatedAt!: Date;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class InitializeStockRequestDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiPropertyOptional({ description: '省略时仅允许无库位仓库（自动 DEFAULT 虚拟库位）' })
  @IsOptional()
  @IsUUID()
  binId?: string;
  @ApiPropertyOptional({ enum: INVENTORY_CONDITIONS, default: 'SELLABLE' })
  @IsOptional()
  @IsIn(INVENTORY_CONDITIONS)
  condition?: InventoryCondition;
  @ApiProperty({ example: '10', description: '允许 0（建立零余额记录），不允许负数' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量格式错误（最多3位小数）' })
  quantity!: string;
  @ApiPropertyOptional({
    type: [String],
    description: 'SN 管理商品必填：与数量一致的 SN 列表；非 SN 商品禁止提供',
  })
  @IsOptional()
  @IsString({ each: true })
  serialNumbers?: string[];
  @ApiProperty({ enum: INVENTORY_REFERENCE_TYPES })
  @IsIn(INVENTORY_REFERENCE_TYPES)
  referenceType!: InventoryReferenceType;
  @ApiProperty() @IsUUID() referenceId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty({ example: 'INIT:PRD-VK87:2026-09-08' })
  @IsString()
  @Length(1, 200)
  idempotencyKey!: string;
}

export class ReceiveStockRequestDto extends InitializeStockRequestDto {}

export class AdjustStockRequestDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiProperty() @IsUUID() binId!: string;
  @ApiPropertyOptional({ enum: INVENTORY_CONDITIONS, default: 'SELLABLE' })
  @IsOptional()
  @IsIn(INVENTORY_CONDITIONS)
  condition?: InventoryCondition;
  @ApiProperty({ example: '-1', description: '带符号增量，不允许 0' })
  @Transform(asQuantityString)
  @Matches(QTY_PATTERN, { message: '数量格式错误（最多3位小数）' })
  quantityDelta!: string;
  @ApiProperty({ example: '盘点补录' }) @IsString() @Length(1, 100) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty() @IsString() @Length(1, 200) idempotencyKey!: string;
}

export class MoveBinRequestDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiProperty() @IsUUID() fromBinId!: string;
  @ApiProperty() @IsUUID() toBinId!: string;
  @ApiPropertyOptional({ enum: INVENTORY_CONDITIONS, default: 'SELLABLE' })
  @IsOptional()
  @IsIn(INVENTORY_CONDITIONS)
  condition?: InventoryCondition;
  @ApiProperty({ example: '4' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量格式错误（最多3位小数）' })
  quantity!: string;
  @ApiProperty({ enum: INVENTORY_REFERENCE_TYPES })
  @IsIn(INVENTORY_REFERENCE_TYPES)
  referenceType!: InventoryReferenceType;
  @ApiProperty() @IsUUID() referenceId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty() @IsString() @Length(1, 200) idempotencyKey!: string;
}

export class ReserveStockRequestDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiProperty({ example: '3' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量格式错误（最多3位小数）' })
  quantity!: string;
  @ApiProperty({ enum: RESERVATION_REFERENCE_TYPES })
  @IsIn(RESERVATION_REFERENCE_TYPES)
  referenceType!: ReservationReferenceType;
  @ApiProperty() @IsUUID() referenceId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty({ example: 'ORDER_RESERVE:orderItem123' })
  @IsString()
  @Length(1, 200)
  idempotencyKey!: string;
}

export class ReservationLifecycleRequestDto {
  @ApiPropertyOptional({ description: '同一业务事件重复请求时传相同 key 以幂等重放' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  idempotencyKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class UpsertSafetyStockRequestDto {
  @ApiProperty({ example: '2' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量格式错误（最多3位小数）' })
  safetyQty!: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export class InventoryListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() skuId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() binId?: string;
  @ApiPropertyOptional({ enum: INVENTORY_CONDITIONS })
  @IsOptional()
  @IsIn(INVENTORY_CONDITIONS)
  condition?: InventoryCondition;
  @ApiPropertyOptional({
    enum: INVENTORY_ROW_STATUSES,
    description: 'IN_STOCK=有可售, OUT_OF_STOCK=无可售',
  })
  @IsOptional()
  @IsIn(INVENTORY_ROW_STATUSES)
  status?: InventoryRowStatus;
}

export class TransactionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() skuId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() binId?: string;
  @ApiPropertyOptional({ enum: INVENTORY_EVENT_TYPES })
  @IsOptional()
  @IsIn(INVENTORY_EVENT_TYPES)
  transactionType?: InventoryEventType;
  @ApiPropertyOptional({ enum: INVENTORY_REFERENCE_TYPES })
  @IsOptional()
  @IsIn(INVENTORY_REFERENCE_TYPES)
  referenceType?: InventoryReferenceType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() referenceId?: string;
  @ApiPropertyOptional({ example: '2026-09-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : new Date(value as string),
  )
  createdFrom?: Date;
  @ApiPropertyOptional({ example: '2026-09-08T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : new Date(value as string),
  )
  createdTo?: Date;
}

export class ReservationListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() skuId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: RESERVATION_STATUSES })
  @IsOptional()
  @IsIn(RESERVATION_STATUSES)
  status?: ReservationStatus;
  @ApiPropertyOptional({ enum: RESERVATION_REFERENCE_TYPES })
  @IsOptional()
  @IsIn(RESERVATION_REFERENCE_TYPES)
  referenceType?: ReservationReferenceType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() referenceId?: string;
}

export class SafetyStockListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() skuId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
