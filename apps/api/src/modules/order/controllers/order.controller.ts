import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { OrderService } from '../services/order.service';
import { OrderIngestionService } from '../services/order-ingestion.service';
import { OrderPurgeService } from '../services/order-purge.service';
import { OrderGoodsStateFilter, OrderStageFilter } from '../enums/order.constants';
import {
  NormalizedOrderInputDto,
  OrderBatchMarkExternalFulfillmentRequestDto,
  OrderBatchMarkExternalFulfillmentResultDto,
  OrderCancelRequestDto,
  OrderCancelResultDto,
  OrderDetailDto,
  OrderIngestResultDto,
  OrderListItemDto,
  OrderListQueryDto,
  OrderMarkExternalFulfillmentRequestDto,
  OrderMarkExternalFulfillmentResultDto,
  OrderCancelExternalFulfillmentRequestDto,
  OrderCancelExternalFulfillmentResultDto,
  OrderMarkLabelPrintedRequestDto,
  OrderMarkLabelPrintedResultDto,
  OrderPurgePreviewDto,
  OrderPurgeRequestDto,
  OrderPurgeResultDto,
  OrderReleaseReservationResultDto,
  OrderRetryAllocationResultDto,
  OrderSetUrgentRequestDto,
  OrderSetUrgentResultDto,
} from '../dto/order.dto';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly ingestionService: OrderIngestionService,
    private readonly purgeService: OrderPurgeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '订单列表（分页 + 汇总计数 + 未处理异常数）' })
  @ApiOkPagedEnvelope(OrderListItemDto)
  async list(@Query() query: OrderListQueryDto) {
    const result = await this.orderService.list(
      {
        keyword: query.keyword?.trim() || undefined,
        platform: query.platform?.trim() || undefined,
        erpStatus: query.erpStatus,
        stage: query.stage as OrderStageFilter | undefined,
        goodsState: query.goodsState as OrderGoodsStateFilter | undefined,
        storeId: query.storeId,
        fulfillmentMode: query.fulfillmentMode?.trim() || undefined,
        pendingProcurement: query.pendingProcurement === 'true',
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
      {
        page: query.page,
        pageSize: query.pageSize,
      },
    );
    return okPage<OrderListItemDto>(result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（行/预约/历史/异常/拦截/拣货）' })
  @ApiOkEnvelope(OrderDetailDto)
  async get(@Param('id') id: string) {
    return ok<OrderDetailDto>(await this.orderService.getDetail(id));
  }

  @Post('ingest')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '标准化订单摄入（管理员/开发测试入口；未来 SyncService 复用 Service）',
  })
  @ApiOkEnvelope(OrderIngestResultDto)
  async ingest(
    @Body() input: NormalizedOrderInputDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderIngestResultDto>(await this.ingestionService.ingest(input, operator));
  }

  // 批量路由先于 :id 参数路由声明（同 from-po/batch 约定，避免段名被当成 id）。
  @Post('batch-mark-label-printed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '标记面单已打印（单笔/批量共用；幂等，只置位尚未打印的订单）',
  })
  @ApiOkEnvelope(OrderMarkLabelPrintedResultDto)
  async markLabelPrinted(
    @Body() request: OrderMarkLabelPrintedRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderMarkLabelPrintedResultDto>(
      await this.orderService.markLabelPrinted(request.orderIds, operator),
    );
  }

  @Post('batch-mark-external-fulfillment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '批量标记外部履约（订单页多选；同一原因逐单关账，不产生库存流水，单笔失败不影响其余）',
  })
  @ApiOkEnvelope(OrderBatchMarkExternalFulfillmentResultDto)
  async markExternalFulfillmentBatch(
    @Body() request: OrderBatchMarkExternalFulfillmentRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderBatchMarkExternalFulfillmentResultDto>(
      await this.orderService.markExternalFulfillmentBatch(
        request.orderIds,
        request.reason,
        operator,
      ),
    );
  }

  @Get(':id/purge-preview')
  @ApiOperation({
    summary: '错误摄入订单的移除预览（2026-10-24）：会删掉哪些附属行、被哪些业务事实阻止（只读）',
  })
  @ApiOkEnvelope(OrderPurgePreviewDto)
  async purgePreview(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true; data: OrderPurgePreviewDto }> {
    return ok(await this.purgeService.preview(id));
  }

  @Post(':id/purge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '彻底移除错误摄入的订单（不可逆）：仅当订单未产生任何业务事实时允许，需再次输入订单号',
  })
  @ApiOkEnvelope(OrderPurgeResultDto)
  async purge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderPurgeRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: OrderPurgeResultDto }> {
    return ok(await this.purgeService.purge(id, operator, dto));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消订单（按行处理库存：Reserved 释放 / Picked 拦截）' })
  @ApiOkEnvelope(OrderCancelResultDto)
  async cancel(
    @Param('id') id: string,
    @Body() request: OrderCancelRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderCancelResultDto>(await this.orderService.cancel(id, operator, request.reason));
  }

  @Post(':id/mark-external-fulfillment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '标记外部履约（订单在系统外完成：行关账、不产生库存流水、关闭缺货/时限异常）',
  })
  @ApiOkEnvelope(OrderMarkExternalFulfillmentResultDto)
  async markExternalFulfillment(
    @Param('id') id: string,
    @Body() request: OrderMarkExternalFulfillmentRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderMarkExternalFulfillmentResultDto>(
      await this.orderService.markExternalFulfillment(id, operator, request.reason),
    );
  }

  @Post(':id/cancel-external-fulfillment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '取消外部履约标记（平台未发货时可用）：RELEASED 行还原为 PENDING，可重新分配库存',
  })
  @ApiOkEnvelope(OrderCancelExternalFulfillmentResultDto)
  async cancelExternalFulfillment(
    @Param('id') id: string,
    @Body() request: OrderCancelExternalFulfillmentRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderCancelExternalFulfillmentResultDto>(
      await this.orderService.cancelExternalFulfillment(id, operator, request.reason),
    );
  }

  @Post('items/:itemId/retry-allocation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试分配库存（BACKORDERED / PENDING 行）' })
  @ApiOkEnvelope(OrderRetryAllocationResultDto)
  async retryAllocation(
    @Param('itemId') itemId: string,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderRetryAllocationResultDto>(
      await this.orderService.retryAllocation(itemId, operator),
    );
  }

  @Post('items/:itemId/release-reservation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '释放该行的库存占用（已占用 → 待分配；释放后不会立即重新分配）',
  })
  @ApiOkEnvelope(OrderReleaseReservationResultDto)
  async releaseReservation(
    @Param('itemId') itemId: string,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderReleaseReservationResultDto>(
      await this.orderService.releaseItemReservation(itemId, operator),
    );
  }

  @Post(':id/urgent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '标记 / 取消加急（列表置顶 + 缺货到货优先分配；已发货/已取消订单不可标记）',
  })
  @ApiOkEnvelope(OrderSetUrgentResultDto)
  async setUrgent(
    @Param('id') id: string,
    @Body() request: OrderSetUrgentRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderSetUrgentResultDto>(
      await this.orderService.setUrgent(id, request.urgent, operator),
    );
  }
}
