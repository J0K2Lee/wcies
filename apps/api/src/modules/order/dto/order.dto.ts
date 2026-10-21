import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { PLATFORM_ORDER_STAGES } from '@wcies/platform-contracts';
import {
  ERP_ORDER_STATUSES,
  ORDER_GOODS_STATE_FILTERS,
  ORDER_INTERCEPTION_STATUSES,
  ORDER_ITEM_FULFILLMENT_STATUSES,
  ORDER_ITEM_MAPPING_STATUSES,
  ORDER_LIST_SORT_FIELDS,
  ORDER_STAGE_FILTERS,
  OrderListSortField,
} from '../enums/order.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;
const UNIT_PRICE_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
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
  @ApiPropertyOptional({
    example: '107.0000',
    nullable: true,
    description: '平台单价（财务事实，finance.md §2）；平台未提供为 null，禁止臆造为 0',
  })
  @IsOptional()
  @Transform(asQuantityString)
  @Matches(UNIT_PRICE_PATTERN, { message: '单价格式错误（最多4位小数）' })
  unitPrice?: string | null;
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
  @ApiPropertyOptional({
    enum: PLATFORM_ORDER_STAGES,
    nullable: true,
    description: '归一化平台物流阶段（平台事实，非 ERP 状态）；未归类/未同步为 null（双轴 T1）',
  })
  @IsOptional()
  @IsIn(PLATFORM_ORDER_STAGES)
  platformStage?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: '平台自身记录的进入该阶段时间（停滞时钟锚点）；缺失为 null',
  })
  @IsOptional()
  @IsDateString()
  platformStageChangedAt?: Date | null;
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
  @ApiPropertyOptional({
    example: '89491381-0072-1',
    nullable: true,
    description:
      '平台运单号（OZON tracking_number，平台事实）；出库时自动填入发货单物流单号。' +
      '这不是被禁止的 orders.tracking_number 物流模型——Shipment/Package 仍是唯一物流载体。',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformTrackingNo?: string | null;
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
  @ApiPropertyOptional({
    description:
      '混合搜索（用户指示 2026-09-28）：订单号 / 平台订单号 / 内部 SKU 编码 / ' +
      'offer_id / seller_sku / platform_sku_id 任一命中',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({
    description: '平台代码精确过滤（stores 所属平台 code，如 OZON/WB/YANDEX）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @ApiPropertyOptional({ enum: ERP_ORDER_STATUSES })
  @IsOptional()
  @IsIn(ERP_ORDER_STATUSES)
  erpStatus?: string;

  @ApiPropertyOptional({
    enum: ORDER_STAGE_FILTERS,
    description:
      '一级 · 物流阶段（双轴 §2.1）：PENDING=erp_status 非 SHIPPED/CANCELLED（缺货/分歧单均在内，' +
      '**不含**外部履约单）；EXTERNAL=外部履约单（FBO/FBP/FBW/FBY，ERP 无可履约行）尚未平台妥投（用户指示 2026-10-16）；' +
      'IN_TRANSIT=已发货且平台未妥投（platform_stage 非 DELIVERED，含未同步）；COMPLETED=已发货且平台已妥投',
  })
  @IsOptional()
  @IsIn(ORDER_STAGE_FILTERS)
  stage?: string;

  @ApiPropertyOptional({
    enum: ORDER_GOODS_STATE_FILTERS,
    description:
      '二级 · 行级货物状态（双轴 §2.2，单选）：TO_PICK=存在 RESERVED 行；PICKING=erp_status PICKING；' +
      'TO_SHIP=存在 PICKED 行；BACKORDERED=存在缺货行；MAPPING_FAILED=存在映射失败行；' +
      'SHIPMENT_OVERDUE=已过发货时限未发完（平台已事实发货 IN_TRANSIT/DELIVERED 的不算，用户指示 2026-10-14）；' +
      'ABNORMAL=缺货∪映射失败∪发货超时∪物流停滞（OPEN ORDER_TRACKING_STALLED）',
  })
  @IsOptional()
  @IsIn(ORDER_GOODS_STATE_FILTERS)
  goodsState?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;

  @ApiPropertyOptional({
    description:
      '履约方式精确匹配（用户指示 2026-09-17）：订单头 fulfillment_mode 原值，' +
      'OZON 订单为 FBS / RFBS / FBP / FBO 短码',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fulfillmentMode?: string;

  @ApiPropertyOptional({
    enum: ['true'],
    description: '待采购视图：存在 MAPPED+BACKORDERED 且无未取消采购单覆盖的订单行',
  })
  @IsOptional()
  @IsIn(['true'])
  pendingProcurement?: string;

  @ApiPropertyOptional({
    enum: ORDER_LIST_SORT_FIELDS,
    description:
      '排序字段（2026-10-14）：skuCode=该单最小 SKU 编码（全未映射排最后）；' +
      'orderedAt=下单时间（默认）；shipmentDeadline=发货时限（无时限排最后）',
  })
  @IsOptional()
  @IsIn(ORDER_LIST_SORT_FIELDS)
  sortBy?: OrderListSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '排序方向；默认 desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
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
  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['AWAITING_SHIPMENT', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
    description:
      '归一化物流阶段（平台事实，非 ERP 状态）：AWAITING_SHIPMENT=待揽收、' +
      'IN_TRANSIT=运输中、DELIVERED=已签收；未归类/未同步为 null',
  })
  platformStage!: string | null;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: '面单已打印时间（人工确认）；null = 未打印，用于「已打单」筛选',
  })
  labelPrintedAt!: Date | null;
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
  @ApiProperty({
    nullable: true,
    type: String,
    description: '平台运单号（平台事实）；已组包后由平台返回，出库时自动填入发货单物流单号',
  })
  platformTrackingNo!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ nullable: true, enum: ['MANUAL', 'API', 'POLLING', 'WEBHOOK'] })
  syncSource!: string | null;
  @ApiProperty() itemsCount!: number;
  @ApiProperty() reservedCount!: number;
  @ApiProperty() backorderedCount!: number;
  @ApiProperty() pickedCount!: number;
  @ApiProperty() mappingFailedCount!: number;
  @ApiProperty() openExceptionsCount!: number;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '该单 SKU 编码的字典序最小值（主表 SKU 列展示 + SKU 排序键；全行未映射为 null）',
  })
  firstSkuCode!: string | null;
  @ApiProperty({ description: '该单不同 SKU 编码的种类数' })
  skuKindCount!: number;
  @ApiPropertyOptional({
    description: '缺货行中缺口已被在途采购覆盖（COVERED）的行数（2026-10-21 决策 0023）',
  })
  backorderedCoveredCount!: number;
  @ApiPropertyOptional({
    description: '缺货行中仍无在途采购覆盖（SHORT，仍可继续采购）的行数（2026-10-21 决策 0023）',
  })
  backorderedShortCount!: number;
  @ApiPropertyOptional({
    description: '加急订单（ADR 0022）：列表恒定置顶，缺货到货后优先参与库存分配',
  })
  isUrgent!: boolean;
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
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      '最近采购价（SKU 主数据操作者维护，master-data.md §4.3；用户指示 2026-09-17 展开行展示）',
  })
  latestPurchasePrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) warehouseId!: string | null;
  @ApiProperty({ example: '2.000' }) quantity!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: '107.0000',
    description: '平台单价（财务事实，finance.md §2）；平台未提供为 null',
  })
  unitPrice!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '214.0000',
    description: '行金额 = 单价 × 数量；无价为 null',
  })
  totalPrice!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '已映射行使用内部 SKU 主图签名 URL；未映射行使用平台公开图片直链',
  })
  imageUrl!: string | null;
  @ApiProperty({ nullable: true, enum: ['INTERNAL', 'PLATFORM'] })
  imageSource!: 'INTERNAL' | 'PLATFORM' | null;
  @ApiProperty({ enum: ORDER_ITEM_FULFILLMENT_STATUSES }) fulfillmentStatus!: string;
  @ApiProperty({ enum: ORDER_ITEM_MAPPING_STATUSES }) mappingStatus!: string;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['COVERED', 'SHORT'],
    description:
      '缺口覆盖状态（purchase.md §3.5 派生，不落库）：COVERED = 该 SKU 在该仓的在途采购已按分配优先级覆盖到此行；SHORT = 仍缺。未映射行为 NULL',
  })
  procurementCoverage!: 'COVERED' | 'SHORT' | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '该 SKU 在该仓的剩余缺口数量（需求 − 在途，已扣除优先级更高的行）；仅 SHORT 有值',
  })
  procurementGapQty!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '该 SKU 在该仓的在途未收采购总量（同 SKU 同仓所有未取消采购单的未收数量之和）',
  })
  procurementInTransitQty!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '缺口计算所用的仓（该店铺绑定仓，与订单分配同源）',
  })
  procurementWarehouseId!: string | null;
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

/** Raw platform status transition (Sprint 9 T1, decision 5 = plan B). */
export class PlatformStatusHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String, example: 'awaiting_packaging' })
  fromStatus!: string | null;
  @ApiProperty({ example: 'delivering' }) toStatus!: string;
  @ApiProperty({ nullable: true, type: String, example: 'ORDER_SYNC' }) source!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      '平台侧的迁移时间（webhook changed_state_date / 回读阶段锚点）；缺失时以 createdAt 为准（双轴 T2）',
  })
  platformChangedAt!: Date | null;
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
  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['AWAITING_SHIPMENT', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
    description: '归一化物流阶段（平台事实，非 ERP 状态）',
  })
  platformStage!: string | null;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  labelPrintedAt!: Date | null;
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
  @ApiProperty({
    nullable: true,
    type: String,
    description: '平台运单号（平台事实）；已组包后由平台返回，出库时自动填入发货单物流单号',
  })
  platformTrackingNo!: string | null;
  @ApiProperty({
    description:
      '该店铺平台是否支持订单履约写能力（获取运单号 / 打单）。前端据此显隐按钮，' +
      '不猜测平台；后端同时以 PLATFORM_CAPABILITY_UNSUPPORTED 兜底。',
    example: { prepareShipment: true, fetchShippingLabel: true },
  })
  platformCapabilities!: { prepareShipment: boolean; fetchShippingLabel: boolean };
  @ApiProperty({ nullable: true, type: Object }) rawData!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ nullable: true, enum: ['MANUAL', 'API', 'POLLING', 'WEBHOOK'] })
  syncSource!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ type: [OrderHistoryDto] }) history!: OrderHistoryDto[];
  @ApiProperty({
    type: [PlatformStatusHistoryDto],
    description: '平台状态迁移时间线（与 ERP 历史按 createdAt 合并展示）',
  })
  platformStatusHistory!: PlatformStatusHistoryDto[];
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
  @ApiProperty({
    description:
      '本次是否修复了平台映射（修复失败的订单行时会先补映射、关异常，再按分配状态决定是否占库存）',
  })
  mappingRepaired!: boolean;
}

export class OrderCancelResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty() releasedItems!: number;
  @ApiProperty() interceptions!: number;
}

/** 标记面单已打印（用户指示 2026-10-19；单笔与批量共用同一接口）。 */
export class OrderMarkLabelPrintedRequestDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  orderIds!: string[];
}

export class OrderMarkLabelPrintedResultDto {
  @ApiProperty({ description: '请求的订单数（去重后）' }) total!: number;
  @ApiProperty({ description: '本次新置为已打印的订单数（此前已打印的不计）' })
  updated!: number;
  @ApiProperty({ type: [String], description: '本次新置位的订单 id' })
  orderIds!: string[];
}

/** 标记 / 取消加急（用户指示 2026-10-16，ADR 0022）。 */
export class OrderSetUrgentRequestDto {
  @ApiProperty({ description: 'true = 标记加急；false = 取消加急' })
  @IsBoolean()
  urgent!: boolean;
}

export class OrderSetUrgentResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty({ description: '标记后的加急状态' }) isUrgent!: boolean;
}

/** Sprint 9 T6: close out an order fulfilled outside WCIES. */
export class OrderMarkExternalFulfillmentRequestDto {
  @ApiProperty({
    description: '外部履约原因（必填，记入状态历史与操作日志；如线下直发买家）',
  })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class OrderMarkExternalFulfillmentResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: ERP_ORDER_STATUSES }) erpStatus!: string;
  @ApiProperty() releasedItems!: number;
}

// ---------------------------------------------------------------------------
// 批量标记外部履约（订单页多选, 2026-10-14）
// ---------------------------------------------------------------------------

export class OrderBatchMarkExternalFulfillmentRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 50,
    description: '勾选的订单（单批上限 50，逐单执行）',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  orderIds!: string[];

  @ApiProperty({
    description: '外部履约原因（必填，应用于全部勾选订单，逐单记入状态历史与操作日志）',
  })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class OrderBatchMarkExternalFulfillmentItemDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '订单不可读时为 null（前端用缓存行标注）',
  })
  orderNo!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, description: '失败时的错误码' })
  code?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '失败时的错误信息' })
  message?: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '标记后订单 ERP 状态（成功时为 SHIPPED）',
  })
  erpStatus!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: '关账的订单行数（成功时）' })
  releasedItems!: number | null;
}

export class OrderBatchMarkExternalFulfillmentResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [OrderBatchMarkExternalFulfillmentItemDto] })
  results!: OrderBatchMarkExternalFulfillmentItemDto[];
}
