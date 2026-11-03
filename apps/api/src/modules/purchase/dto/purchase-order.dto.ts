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
import { PURCHASE_ORDER_STATUSES } from '../enums/purchase.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;
const COST_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
const asQuantityString = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : undefined;

export class PurchaseOrderItemInputDto {
  @ApiProperty() @IsUUID() skuId!: string;
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
  @ApiPropertyOptional({ description: '默认收货库位（必须属于采购单目标仓）' })
  @IsOptional()
  @IsUUID()
  defaultBinId?: string;
}

export class CreatePurchaseOrderRequestDto {
  @ApiProperty({ description: '收货仓库（采购单的目标仓，必填）', format: 'uuid' })
  @IsUUID()
  receivingWarehouseId!: string;
  @ApiPropertyOptional({
    enum: ['REPLENISH', 'STOCK'],
    default: 'STOCK',
    description:
      'REPLENISH = 订单页按缺口补货（校验缺口并限购）；STOCK = 采购单页备货（不校验缺口）',
  })
  @IsOptional()
  @IsIn(['REPLENISH', 'STOCK'])
  purpose?: 'REPLENISH' | 'STOCK';
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
    format: 'uuid',
    description: '收货仓库（仅在采购单尚无收货记录时可改）',
  })
  @IsOptional()
  @IsUUID()
  receivingWarehouseId?: string;
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
  @ApiProperty({
    example: '0.000',
    description: '短装结案数量（供应商不再发货、操作员显式关闭的数量；不是收货）',
  })
  closedQuantity!: string;
  @ApiPropertyOptional({ nullable: true, type: Date }) closedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) closeReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '该 SKU 主图签名 URL（展开明细图片列，2026-10-24）；未上传图片为 null',
  })
  imageUrl!: string | null;
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
  @ApiProperty({
    example: '0.000',
    description:
      '短装结案数量合计（2026-11-03）：status=RECEIVED 且该值 > 0 时列表打「短装结案」标签',
  })
  closedQuantity!: string;
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

// ---------------------------------------------------------------------------
// 短装结案（2026-11-03）
// ---------------------------------------------------------------------------

export class CloseRemainingItemInputDto {
  @ApiProperty({ description: '采购单明细 id' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({
    example: '2',
    description: '本次关闭数量；省略 = 该行全部剩余（允许只关一部分，剩下的继续等货）',
  })
  @IsOptional()
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '关闭数量必须为正数（最多3位小数）' })
  quantity?: string;
}

export class CloseRemainingRequestDto {
  @ApiProperty({
    example: '供应商确认缺货，不再补发',
    description: '结案原因（必填，写入操作日志与行上 close_reason）',
  })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    type: [CloseRemainingItemInputDto],
    description: '要结案的行；省略 = 所有还有未收数量的行',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CloseRemainingItemInputDto)
  items?: CloseRemainingItemInputDto[];
}

export class ClosedRemainingItemDto {
  @ApiProperty() itemId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty({ example: '2.000' }) closedQuantity!: string;
  @ApiProperty({ example: '0.000' }) remainingQuantity!: string;
}

export class CloseRemainingResultDto {
  @ApiProperty({ example: 'PO000001' }) poNo!: string;
  @ApiProperty({ enum: PURCHASE_ORDER_STATUSES }) status!: string;
  @ApiProperty({ example: '2.000' }) totalClosed!: string;
  @ApiProperty({ type: [ClosedRemainingItemDto] }) items!: ClosedRemainingItemDto[];
}
