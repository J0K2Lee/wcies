import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  ERP_ORDER_STATUSES,
  ORDER_INTERCEPTION_STATUSES,
  ORDER_ITEM_FULFILLMENT_STATUSES,
  ORDER_ITEM_MAPPING_STATUSES,
} from '../enums/order.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;
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
// Ingest (NormalizedOrderInput, task §11)
// ---------------------------------------------------------------------------

export class NormalizedOrderItemInputDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) platformProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) platformSkuId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) sellerSku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) offerId?: string;
  @ApiProperty({ example: '2' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量必须为正数（最多3位小数）' })
  quantity!: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  rawData?: Record<string, unknown>;
}

export type NormalizedOrderInput = NormalizedOrderInputDto;

export class NormalizedOrderInputDto {
  @ApiProperty() @IsUUID() storeId!: string;
  @ApiProperty({ example: 'OZON-123456789' })
  @IsString()
  @Length(1, 255)
  platformOrderId!: string;
  @ApiPropertyOptional({ example: 'awaiting_packaging' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  platformStatus?: string;
  @ApiPropertyOptional({ example: 'FBS' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fulfillmentMode?: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  orderedAt!: Date;
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: '平台要求的发货截止时间（平台事实，非 ERP 状态；可空）',
  })
  @IsOptional()
  @IsDateString()
  shipmentDeadline?: Date;
  @ApiPropertyOptional({ example: 'RUB' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  currency?: string;
  @ApiProperty({ type: [NormalizedOrderItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NormalizedOrderItemInputDto)
  items!: NormalizedOrderItemInputDto[];
  @ApiPropertyOptional({ type: Object, description: '平台原始报文（保留事实，task §14）' })
  @IsOptional()
  @IsObject()
  rawData?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiPropertyOptional({
    enum: ['MANUAL', 'API', 'POLLING', 'WEBHOOK'],
    description: '订单进入系统的渠道（Sprint 5 §58；默认 API）',
  })
  @IsOptional()
  @IsIn(['MANUAL', 'API', 'POLLING', 'WEBHOOK'])
  syncSource?: string;
}

export class OrderIngestItemResultDto {
  @ApiProperty() orderItemId!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ enum: ORDER_ITEM_MAPPING_STATUSES }) mappingStatus!: string;
  @ApiProperty({ enum: ORDER_ITEM_FULFILLMENT_STATUSES }) fulfillmentStatus!: string;
  @ApiProperty({ nullable: true, type: String }) skuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) reservationId!: string | null;
}

export class OrderIngestResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty({ example: false }) alreadyIngested!: boolean;
  @ApiProperty({ type: [OrderIngestItemResultDto] }) itemResults!: OrderIngestItemResultDto[];
}

// ---------------------------------------------------------------------------
// Queries / responses
// ---------------------------------------------------------------------------

export class OrderListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '订单号 / 平台订单号模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: ERP_ORDER_STATUSES })
  @IsOptional()
  @IsIn(ERP_ORDER_STATUSES)
  erpStatus?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
}

export class OrderListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'OZON A店' }) storeName!: string;
  @ApiProperty({ example: 'OZON' }) platformCode!: string;
  @ApiProperty({ example: '123456789' }) platformOrderId!: string;
  @ApiProperty({ nullable: true, type: String, example: 'awaiting_packaging' })
  platformStatus!: string | null;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty({ nullable: true, type: String }) fulfillmentMode!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ type: Date }) orderedAt!: Date;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: '平台要求的发货截止时间（平台事实，非 ERP 状态）',
  })
  shipmentDeadline!: Date | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ nullable: true, enum: ['MANUAL', 'API', 'POLLING', 'WEBHOOK'] })
  syncSource!: string | null;
  @ApiProperty() itemsCount!: number;
  @ApiProperty() reservedCount!: number;
  @ApiProperty() backorderedCount!: number;
  @ApiProperty() pickedCount!: number;
  @ApiProperty() mappingFailedCount!: number;
  @ApiProperty() openExceptionsCount!: number;
}

export class OrderReservationLineDto {
  @ApiProperty() binId!: string;
  @ApiProperty({ example: 'ZG-01-A01-1' }) binCode!: string;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiProperty({ example: '0.000' }) pickedQty!: string;
  @ApiProperty() status!: string;
}

export class OrderItemExceptionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'EXC00000001' }) exceptionNo!: string;
  @ApiProperty() exceptionType!: string;
  @ApiProperty() status!: string;
  @ApiProperty() message!: string;
}

export class OrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ nullable: true, type: String }) platformProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) platformSkuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiProperty({ nullable: true, type: String }) offerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) listingSkuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) skuId!: string | null;
  @ApiProperty({ example: 'VK87-BLK' }) skuCode!: string;
  @ApiProperty({ example: 'VK87 MAX V2 黑色' }) skuName!: string;
  @ApiProperty({ nullable: true, type: String }) warehouseId!: string | null;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiProperty({ enum: ORDER_ITEM_FULFILLMENT_STATUSES }) fulfillmentStatus!: string;
  @ApiProperty({ enum: ORDER_ITEM_MAPPING_STATUSES }) mappingStatus!: string;
  @ApiProperty({ nullable: true, type: String }) reservationId!: string | null;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: '库存预约（含多 Bin 分配行，task §49-§50）',
  })
  reservation!: {
    id: string;
    reservationNo: string;
    status: string;
    lines: OrderReservationLineDto[];
  } | null;
  @ApiProperty({ nullable: true, type: Object }) rawData!: Record<string, unknown> | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiProperty({ type: [OrderItemExceptionDto] }) exceptions!: OrderItemExceptionDto[];
}

export class OrderHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) fromStatus!: string | null;
  @ApiProperty() toStatus!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ nullable: true, type: String }) operatorName!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class OrderInterceptionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ITC00000001' }) interceptionNo!: string;
  @ApiProperty({ nullable: true, type: String }) orderItemId!: string | null;
  @ApiProperty() warehouseId!: string;
  @ApiProperty({ enum: ORDER_INTERCEPTION_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class OrderPickingTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PCK00000001' }) pickingNo!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() totalItems!: number;
  @ApiProperty() pickedItems!: number;
  @ApiProperty({ type: Date }) createdAt!: Date;
}

export class OrderDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'OZON A店' }) storeName!: string;
  @ApiProperty({ example: 'OZON' }) platformCode!: string;
  @ApiProperty({ example: '123456789' }) platformOrderId!: string;
  @ApiProperty({ nullable: true, type: String }) platformStatus!: string | null;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty({ nullable: true, type: String }) fulfillmentMode!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ type: Date }) orderedAt!: Date;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: '平台要求的发货截止时间（平台事实，非 ERP 状态）',
  })
  shipmentDeadline!: Date | null;
  @ApiProperty({ nullable: true, type: Object }) rawData!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ nullable: true, enum: ['MANUAL', 'API', 'POLLING', 'WEBHOOK'] })
  syncSource!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ type: [OrderHistoryDto] }) history!: OrderHistoryDto[];
  @ApiProperty({ type: [OrderInterceptionDto] }) interceptions!: OrderInterceptionDto[];
  @ApiProperty({ type: [OrderPickingTaskDto] }) pickingTasks!: OrderPickingTaskDto[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export class OrderCancelRequestDto {
  @ApiPropertyOptional({ description: '取消原因（记入历史与拦截任务）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class OrderRetryAllocationResultDto {
  @ApiProperty() orderItemId!: string;
  @ApiProperty({ enum: ORDER_ITEM_FULFILLMENT_STATUSES }) fulfillmentStatus!: string;
  @ApiProperty() reserved!: boolean;
}

export class OrderCancelResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty() releasedItems!: number;
  @ApiProperty() interceptions!: number;
}
