import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { RETURN_BATCH_STATUSES, RETURN_ITEM_CONDITIONS } from '../enums/return.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;

export interface ReturnBatchView {
  id: string;
  batchNo: string;
  warehouseId: string;
  status: string;
  sourceNote: string | null;
  itemCount: number;
  /** 检验结论仍为 PENDING 的行数（「还需要回库处理」的量化指标）。 */
  pendingItems: number;
  createdAt: Date;
}

export interface ReturnBatchItemView {
  id: string;
  batchId: string;
  platformReturnId: string | null;
  platformReturnNo: string | null;
  skuId: string;
  /** 内部 SKU 编码/名称（列表与详情直接可读，不再靠前 100 条本地映射）。 */
  skuCode: string;
  skuName: string;
  serialTracking: boolean;
  quantity: string;
  condition: string;
  binId: string | null;
  /** 回库库位编码（检验后可见；未检验/缺失为 null）。 */
  binCode: string | null;
  /** 扫码已扫到的序列号（SN 商品；扫满 quantity 才入库）。 */
  receivedSerialNumbers: string[];
  remark: string | null;
  createdAt: Date;
}

export interface PlatformReturnView {
  id: string;
  storeId: string;
  platformReturnId: string;
  platformOrderId: string | null;
  orderId: string | null;
  state: string | null;
  refundState: string | null;
  platformSkuId: string | null;
  offerId: string | null;
  /** 店铺内解析出的内部 SKU（未映射为 null）。 */
  skuCode: string | null;
  skuName: string | null;
  /** 已被哪个退货批次消费（对账锚点），未入批次为 null。 */
  batchNo: string | null;
  quantity: string;
  platformCreatedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Responses (documented for OpenAPI; the services return the view shapes)
// ---------------------------------------------------------------------------

export class PlatformReturnDto {
  @ApiProperty() id!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'R900001' }) platformReturnId!: string;
  @ApiProperty({ nullable: true, type: String }) platformOrderId!: string | null;
  @ApiProperty({ nullable: true, type: String }) orderId!: string | null;
  @ApiProperty({ nullable: true, type: String }) state!: string | null;
  @ApiProperty({ nullable: true, type: String }) refundState!: string | null;
  @ApiProperty({ nullable: true, type: String }) platformSkuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) offerId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '店铺内解析的内部 SKU 编码' })
  skuCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '内部 SKU 名称（中文）' })
  skuName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '已消费该记录的对账批次号' })
  batchNo!: string | null;
  @ApiProperty({ example: '1' }) quantity!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  platformCreatedAt!: Date | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class ReturnBatchDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'RT000001' }) batchNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ enum: RETURN_BATCH_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) sourceNote!: string | null;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ description: '待检验（还未回库处理）的行数' }) pendingItems!: number;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class ReturnBatchItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() batchId!: string;
  @ApiProperty({ nullable: true, type: String }) platformReturnId!: string | null;
  @ApiProperty({ nullable: true, type: String }) platformReturnNo!: string | null;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: 'SKU000012037' }) skuCode!: string;
  @ApiProperty({ example: '迈从-A7 V3 Ultra+ 黑色' }) skuName!: string;
  @ApiProperty({ description: '该 SKU 是否启用 SN 管理（决定是否必须扫序列号）' })
  serialTracking!: boolean;
  @ApiProperty({ example: '1.000' }) quantity!: string;
  @ApiProperty({ enum: RETURN_ITEM_CONDITIONS }) condition!: string;
  @ApiProperty({ nullable: true, type: String }) binId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '回库库位编码（检验合格/不合格时的落库位置；未检验或缺失为 null）',
  })
  binCode!: string | null;
  @ApiProperty({ type: [String], description: '扫码入库已扫到的序列号（SN 商品）' })
  receivedSerialNumbers!: string[];
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class ReturnBatchDetailDto extends ReturnBatchDto {
  @ApiProperty({ type: [ReturnBatchItemDto] }) items!: ReturnBatchItemDto[];
}

export class PlatformReturnSyncResultDto {
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty({ description: '无法关联订单的平台退货记录数（已创建 RETURN_ORDER_NOT_FOUND）' })
  unlinkable!: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export class ReturnBatchListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RETURN_BATCH_STATUSES })
  @IsOptional()
  @IsIn(RETURN_BATCH_STATUSES)
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;

  @ApiPropertyOptional({
    description: '搜索：批次号 / 平台退货单号 / 内部 SKU 编码（模糊匹配）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

export class PlatformReturnListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'linked=false：待收货对账视图（尚无退货批次行关联的平台退货记录）',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  linked?: string;

  @ApiPropertyOptional({
    description: '搜索：平台退货单号 / 平台订单号 / Offer ID / 平台 SKU',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * 扫码入库（2026-11-04）：扫 SKU 条码 → 命中本批次该 SKU 的待检验行 →
 * SN 商品逐件扫序列号（扫满才入库），非 SN 商品整行一次入库。
 */
export class ReturnBatchScanRequestDto {
  @ApiProperty({ example: '4601234506789', description: 'SKU 条码（USB/蓝牙扫码器=键盘输入）' })
  @IsString()
  @Length(1, 255)
  barcode!: string;

  @ApiPropertyOptional({ description: 'SN 管理商品必填：本次扫到的序列号' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  serialNumber?: string;

  @ApiPropertyOptional({ description: '回库目标库位；省略 = 该仓 STAGING 暂存位' })
  @IsOptional()
  @IsUUID()
  binId?: string;
}

export class ReturnBatchScanResultDto {
  @ApiProperty() batchId!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty({ example: 'SKU000012037' }) skuCode!: string;
  @ApiProperty({ example: '迈从-A7 V3 Ultra+ 黑色' }) skuName!: string;
  @ApiProperty({ example: '1.000' }) quantity!: string;
  @ApiProperty({ description: '本次扫到的序列号（非 SN 商品为空数组）', type: [String] })
  serialNumbers!: string[];
  @ApiProperty({ description: '已扫序列号数（SN 商品）' }) scannedSerials!: number;
  @ApiProperty({ description: '需要扫的序列号数（= 行数量；非 SN 为 0）' })
  requiredSerials!: number;
  @ApiProperty({ description: 'true = 该行已入库（condition 已落定）' }) completed!: boolean;
  @ApiProperty({ example: 'SELLABLE', nullable: true, type: String }) condition!: string | null;
}

export class ReturnBatchItemInputDto {
  @ApiPropertyOptional({ description: '人工行必须指定内部 SKU' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ description: '关联平台退货记录（对账锚点）' })
  @IsOptional()
  @IsUUID()
  platformReturnId?: string;

  @ApiProperty({ example: '1' })
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量必须为正数（最多3位小数）' })
  quantity!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class ReturnBatchCreateDto {
  @ApiProperty() @IsUUID() warehouseId!: string;

  @ApiPropertyOptional({ example: 'Amol 仓 9-15 批次' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceNote?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;

  @ApiProperty({ type: [ReturnBatchItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnBatchItemInputDto)
  items!: ReturnBatchItemInputDto[];
}

export class ReturnItemInspectDto {
  @ApiProperty({
    enum: ['SELLABLE', 'DEFECTIVE', 'LOST'],
    description:
      '检验结论（一次性写定）：SELLABLE/DEFECTIVE 回库（DEFECTIVE 入隔离库存）；LOST 不动库存',
  })
  @IsIn(['SELLABLE', 'DEFECTIVE', 'LOST'] as const)
  condition!: 'SELLABLE' | 'DEFECTIVE' | 'LOST';

  @ApiPropertyOptional({ description: '回库目标库位；空则自动落到该仓 STAGING 库位' })
  @IsOptional()
  @IsUUID()
  binId?: string;
}

export class PlatformReturnSyncDto {
  @ApiProperty() @IsUUID() storeId!: string;

  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @Length(0, 100) note?: string;
}
