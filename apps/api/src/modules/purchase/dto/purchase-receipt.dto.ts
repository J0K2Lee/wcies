import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PURCHASE_RECEIPT_STATUSES } from '../enums/purchase.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;
const COST_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
const asQuantityString = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : undefined;

export class PurchaseReceiptItemInputDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiPropertyOptional({ description: '来源采购明细（可空 = 直接收货）' })
  @IsOptional()
  @IsUUID()
  purchaseOrderItemId?: string;
  @ApiProperty({ example: '2' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量必须为正数（最多3位小数）' })
  quantity!: string;
  @ApiPropertyOptional({ example: '59.9000' })
  @IsOptional()
  @Transform(asQuantityString)
  @Matches(COST_PATTERN, { message: '单位成本格式错误（最多4位小数）' })
  unitCost?: string;
  @ApiPropertyOptional({ description: '目标库位（可空 → 库存层既有解析规则）' })
  @IsOptional()
  @IsUUID()
  binId?: string;
  @ApiPropertyOptional({
    type: [String],
    description: 'SN 管理商品必填：与数量一致的 SN 列表；非 SN 商品禁止提供',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  serialNumbers?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class CreatePurchaseReceiptRequestDto {
  @ApiPropertyOptional({ description: '来源采购单（可空 = 直接收货）' })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @ApiProperty() @IsUUID() warehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty({ type: [PurchaseReceiptItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReceiptItemInputDto)
  items!: PurchaseReceiptItemInputDto[];
}

export class UpdatePurchaseReceiptRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiPropertyOptional({
    type: [PurchaseReceiptItemInputDto],
    description: '整体替换明细（仅 DRAFT）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReceiptItemInputDto)
  items?: PurchaseReceiptItemInputDto[];
}

export class GenerateReceiptFromPoRequestDto {
  @ApiPropertyOptional({
    description: '收货仓库（可省略：省略时使用采购单上的收货仓库意向，ERP 建议#4）',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
  @ApiPropertyOptional({ description: '默认目标库位（明细可单独覆盖）' })
  @IsOptional()
  @IsUUID()
  defaultBinId?: string;
}

// ---------------------------------------------------------------------------
// 批量生成收货单（采购单页多选, 2026-10-13）
// ---------------------------------------------------------------------------

export class GenerateReceiptFromPoBatchItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() poId!: string;
  @ApiPropertyOptional({
    description: '收货仓库（省略 = 用采购单上的收货仓库意向；两者皆无则该单失败）',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class GenerateReceiptsFromPosRequestDto {
  @ApiProperty({ type: [GenerateReceiptFromPoBatchItemDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GenerateReceiptFromPoBatchItemDto)
  items!: GenerateReceiptFromPoBatchItemDto[];
}

export class GenerateReceiptFromPoBatchItemResultDto {
  @ApiProperty() poId!: string;
  @ApiProperty({ nullable: true, type: String, description: '采购单号（单据不存在时为 null）' })
  poNo!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) receiptId?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) receiptNo?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '失败时的错误码' })
  code?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '失败时的错误信息' })
  message?: string | null;
}

export class GenerateReceiptsFromPosResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [GenerateReceiptFromPoBatchItemResultDto] })
  results!: GenerateReceiptFromPoBatchItemResultDto[];
}

export class PurchaseReceiptItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000001001' }) skuCode!: string;
  @ApiProperty({ example: 'VK87 MAX V2 黑色' }) skuName!: string;
  @ApiPropertyOptional({ nullable: true }) purchaseOrderItemId!: string | null;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiPropertyOptional({ nullable: true, example: '59.9000' }) unitCost!: string | null;
  @ApiPropertyOptional({ nullable: true }) binId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'ZG-01-A01-1' }) binCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) serialNumbers!: string[] | null;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
}

export class PurchaseReceiptListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PR000001' }) receiptNo!: string;
  @ApiPropertyOptional({ nullable: true }) purchaseOrderId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'PO000001' }) purchaseOrderNo!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierId!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierName!: string | null;
  @ApiPropertyOptional({ nullable: true }) sourceNote!: string | null;
  @ApiProperty() warehouseId!: string;
  @ApiPropertyOptional({ nullable: true, example: 'ZG-01' }) warehouseCode!: string | null;
  @ApiProperty({ enum: PURCHASE_RECEIPT_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true, type: Date }) receivedAt!: Date | null;
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

export class PurchaseReceiptDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PR000001' }) receiptNo!: string;
  @ApiPropertyOptional({ nullable: true }) purchaseOrderId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'PO000001' }) purchaseOrderNo!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierId!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierName!: string | null;
  @ApiPropertyOptional({ nullable: true }) sourceNote!: string | null;
  @ApiProperty() warehouseId!: string;
  @ApiPropertyOptional({ nullable: true, example: 'ZG-01' }) warehouseCode!: string | null;
  @ApiProperty({ enum: PURCHASE_RECEIPT_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true, type: Date }) receivedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiProperty({ type: [PurchaseReceiptItemDto] }) items!: PurchaseReceiptItemDto[];
}

export class PurchaseReceiptListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '收货单号 / 货源说明 / 明细 SKU 编码或名称 模糊搜索（2026-10-17）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
  @ApiPropertyOptional({ enum: PURCHASE_RECEIPT_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_RECEIPT_STATUSES)
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseOrderId?: string;
}

export class PurchaseReceiptConfirmResultDto extends PurchaseReceiptDetailDto {
  /** True when the receipt was already RECEIVED and nothing was re-booked. */
  @ApiProperty({ example: false }) idempotentReplay!: boolean;
}
