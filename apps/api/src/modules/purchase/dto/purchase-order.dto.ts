import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PROCUREMENT_STATES, PURCHASE_ORDER_STATUSES } from '../enums/purchase.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;
const COST_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
const asQuantityString = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : undefined;

export class PurchaseOrderItemInputDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiPropertyOptional({ description: '为哪张订单行采购（可空 = 备货采购）' })
  @IsOptional()
  @IsUUID()
  orderItemId?: string;
  @ApiProperty({ example: '2' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量必须为正数（最多3位小数）' })
  quantity!: string;
  @ApiPropertyOptional({ example: '59.9000', description: '单位成本（可空）' })
  @IsOptional()
  @Transform(asQuantityString)
  @Matches(COST_PATTERN, { message: '单位成本格式错误（最多4位小数）' })
  unitCost?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class ReceivingOptionDto {
  @ApiProperty({ description: '收货仓库' }) @IsUUID() warehouseId!: string;
  @ApiPropertyOptional({ description: '默认收货库位' })
  @IsOptional()
  @IsUUID()
  defaultBinId?: string;
}

export class CreatePurchaseOrderRequestDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: '采购时间（可空=当前时刻）',
  })
  @IsOptional()
  @IsDateString()
  orderedAt?: string;
  @ApiPropertyOptional({ type: ReceivingOptionDto, description: '同时生成独立收货草稿（不入库）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceivingOptionDto)
  receipt?: ReceivingOptionDto;
  @ApiPropertyOptional({ description: '固定供应商（可空）' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
  @ApiPropertyOptional({
    description: '一次性网购的货源说明（如「淘宝 订单号 12345678」）',
    example: '淘宝 订单号 12345678',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceNote?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', description: '预计到货时间' })
  @IsOptional()
  @IsDateString()
  expectedAt?: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty({ type: [PurchaseOrderItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items!: PurchaseOrderItemInputDto[];
}

export class UpdatePurchaseOrderRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expectedAt?: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiPropertyOptional({
    type: [PurchaseOrderItemInputDto],
    description: '整体替换明细（仅 ORDERED 状态）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items?: PurchaseOrderItemInputDto[];
}

export class PurchaseOrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001001' }) skuCode!: string;
  @ApiProperty({ example: 'VK87 MAX V2 黑色' }) skuName!: string;
  @ApiPropertyOptional({ nullable: true }) orderItemId!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '关联订单号（展示用）' }) orderNo!:
    string | null;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiPropertyOptional({ nullable: true, example: '59.9000' }) unitCost!: string | null;
  @ApiProperty({ example: '0.000' }) receivedQuantity!: string;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
}

export class PurchaseOrderListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PO000001' }) poNo!: string;
  @ApiPropertyOptional({ nullable: true }) supplierId!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierName!: string | null;
  @ApiPropertyOptional({ nullable: true }) sourceNote!: string | null;
  @ApiProperty({ enum: PURCHASE_ORDER_STATUSES }) status!: string;
  @ApiProperty({ type: Date }) orderedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) expectedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    description: '收货仓库意向（创建时选择，回显用；库存事实仍在收货单上）',
  })
  receivingWarehouseId!: string | null;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ example: '2.000' }) totalQuantity!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'SKU000012022',
    description: '明细第一行的内部 SKU 编码（列表「采购商品」列）',
  })
  firstItemSkuCode!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '迈从-A7 V3 Ultra+-鼠标-玄影',
    description: '明细第一行的 SKU 名称（列表「采购商品」列）',
  })
  firstItemName!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '1.000',
    description: '明细第一行的数量（列表「采购商品」列）',
  })
  firstItemQuantity!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
}

export class PurchaseOrderDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PO000001' }) poNo!: string;
  @ApiPropertyOptional({ nullable: true }) supplierId!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierName!: string | null;
  @ApiPropertyOptional({ nullable: true }) sourceNote!: string | null;
  @ApiProperty({ enum: PURCHASE_ORDER_STATUSES }) status!: string;
  @ApiProperty({ type: Date }) orderedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) expectedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) receivingWarehouseId!: string | null;
  @ApiPropertyOptional({ nullable: true }) receivingWarehouseName!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiProperty({ type: [PurchaseOrderItemDto] }) items!: PurchaseOrderItemDto[];
}

export class PurchaseOrderListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'PO号 / 货源说明 / 供应商名 / 明细 SKU 编码或名称 模糊搜索（2026-10-17）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
  @ApiPropertyOptional({ enum: PURCHASE_ORDER_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_ORDER_STATUSES)
  status?: string;
  @ApiPropertyOptional({
    enum: PURCHASE_ORDER_STATUSES,
    isArray: true,
    description:
      '多状态过滤（repeated query key，如 ?statuses=ORDERED&statuses=PARTIALLY_RECEIVED）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(PURCHASE_ORDER_STATUSES, { each: true })
  statuses?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderItemId?: string;
  @ApiPropertyOptional({ example: '2026-09-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  orderedFrom?: Date;
  @ApiPropertyOptional({ example: '2026-09-30T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  orderedTo?: Date;
}

/** Reused by the order module's derived procurement state (purchase.md §3.5). */
export class ProcurementStateDto {
  @ApiProperty({ enum: PROCUREMENT_STATES }) state!: string;
}
