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
  createdAt: Date;
}

export interface ReturnBatchItemView {
  id: string;
  batchId: string;
  platformReturnId: string | null;
  platformReturnNo: string | null;
  skuId: string;
  quantity: string;
  condition: string;
  binId: string | null;
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
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class ReturnBatchItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() batchId!: string;
  @ApiProperty({ nullable: true, type: String }) platformReturnId!: string | null;
  @ApiProperty({ nullable: true, type: String }) platformReturnNo!: string | null;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: '1.000' }) quantity!: string;
  @ApiProperty({ enum: RETURN_ITEM_CONDITIONS }) condition!: string;
  @ApiProperty({ nullable: true, type: String }) binId!: string | null;
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
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

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
