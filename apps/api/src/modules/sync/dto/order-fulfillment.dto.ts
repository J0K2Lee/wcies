import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { QuickShipShipmentDto } from '../../shipment/dto/shipment.dto';
import { ORDER_LIST_SORT_FIELDS, OrderListSortField } from '../../order/enums/order.constants';

/** Query of `POST /orders/:id/shipping-label` (2026-09-18 fulfillment flow). */
export class FetchShippingLabelQueryDto {
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'true = 忽略已存档面单，重新向平台取一次（平台面单接口限流，默认复用本地存档）',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  refresh?: string;
}

/** Response of `POST /orders/:id/prepare-shipment` (获取运单号). */
export class PrepareShipmentResultDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'ORD00000001' }) orderNo!: string;
  @ApiProperty({ example: 'OZON' }) platformCode!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '平台运单号；平台在组包后才分配，未返回时为 null',
  })
  trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '组包后的平台订单状态（平台原文）' })
  platformStatus!: string | null;
  @ApiProperty({ description: '平台此前已受理该订单（本次未再写平台）' })
  alreadyPrepared!: boolean;
  @ApiProperty({
    description:
      '平台已受理组包但尚未确认（OZON 异步处理，正常中间态）：运单号暂不可读，稍后再次点击即可收敛',
  })
  assemblyPending!: boolean;
  @ApiProperty({ description: '本次点击是否完成平台组包写（受理中/已组包过则为 false）' })
  platformWritePerformed!: boolean;
}

// ---------------------------------------------------------------------------
// Batch endpoints (订单页多选批量, 2026-10-13)
// ---------------------------------------------------------------------------

/** Request of `POST /orders/batch-prepare-shipment` and `POST /orders/batch-ship`. */
export class BatchOrderActionRequestDto {
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
}

/** One order's outcome of `POST /orders/batch-prepare-shipment`. */
export class BatchPrepareShipmentItemDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '失败且订单不可读时为 null（前端用自己缓存的列表行标注）',
  })
  orderNo!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, description: '失败时的错误码' })
  code?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: '失败时的错误信息' })
  message?: string | null;
  @ApiProperty({ nullable: true, type: String, description: '平台运单号（成功时）' })
  trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '组包后的平台订单状态' })
  platformStatus!: string | null;
  @ApiProperty({ description: '平台此前已受理该订单' })
  alreadyPrepared!: boolean;
  @ApiProperty({ description: '平台已受理组包但尚未确认（运单号稍后可取）' })
  assemblyPending!: boolean;
}

export class BatchPrepareShipmentResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [BatchPrepareShipmentItemDto] }) results!: BatchPrepareShipmentItemDto[];
}

/** One order's outcome of `POST /orders/batch-ship`. */
export class BatchShipItemDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ nullable: true, type: String }) orderNo!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) code?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) message?: string | null;
  @ApiProperty({ nullable: true, type: String, description: '出库后订单 ERP 状态（成功时）' })
  orderErpStatus!: string | null;
  @ApiProperty({ type: [QuickShipShipmentDto] }) shipments!: QuickShipShipmentDto[];
}

export class BatchShipResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [BatchShipItemDto] }) results!: BatchShipItemDto[];
}

// ---------------------------------------------------------------------------
// 批量打印面单（用户指示 2026-10-17）
// ---------------------------------------------------------------------------

/** Request of `POST /orders/batch-shipping-label`. */
export class BatchShippingLabelRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 50,
    description: '勾选的订单（单批上限 50，逐单顺序取面单以尊重平台限流）',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  orderIds!: string[];

  @ApiPropertyOptional({
    description: 'true = 忽略已存档面单，逐单向平台重新取（平台面单接口限流，默认复用本地存档）',
  })
  @IsOptional()
  refresh?: boolean;

  @ApiPropertyOptional({
    enum: ORDER_LIST_SORT_FIELDS,
    description: '订单列表当前排序字段（决定合并 PDF 的面单顺序，与列表一致；缺省=下单时间新→旧）',
  })
  @IsOptional()
  @IsIn(ORDER_LIST_SORT_FIELDS)
  sortBy?: OrderListSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '排序方向（与列表一致）' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** One order's outcome of `POST /orders/batch-shipping-label`. */
export class BatchShippingLabelItemDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '失败且订单不可读时为 null',
  })
  orderNo!: string | null;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) code?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) message?: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '面单签名 URL（成功时）；前端放进同一个打印窗口批量打印',
  })
  signedUrl!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '面单文件名（成功时）' })
  fileName!: string | null;
  @ApiProperty({
    description: 'true = 直接复用本地存档，本次未调用平台（2026-10-21 预取后通常为 true）',
  })
  fromArchive!: boolean;
}

export class BatchShippingLabelResultDto {
  @ApiProperty() total!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({
    description:
      '因订单已终态（完成/取消）被拒绝的单数；这些单不再取面单，也不进合并 PDF（2026-10-21）',
  })
  notPrintable!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      '成功面单合并成的单个 PDF（base64）。平台面单自带纸张尺寸（OZON 57.9×40mm），' +
      '必须用浏览器原生 PDF 查看器打印才能保持原尺寸；合并失败或全部失败时为 null',
  })
  mergedPdfBase64!: string | null;
  @ApiProperty({ description: '合并 PDF 的总页数（每张面单通常 1 页）' })
  mergedPageCount!: number;
  @ApiProperty({ type: [BatchShippingLabelItemDto] }) results!: BatchShippingLabelItemDto[];
}
