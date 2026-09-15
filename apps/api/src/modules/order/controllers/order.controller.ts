import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { OrderGoodsStateFilter, OrderStageFilter } from '../enums/order.constants';
import {
  NormalizedOrderInputDto,
  OrderCancelRequestDto,
  OrderCancelResultDto,
  OrderDetailDto,
  OrderIngestResultDto,
  OrderListItemDto,
  OrderListQueryDto,
  OrderMarkExternalFulfillmentRequestDto,
  OrderMarkExternalFulfillmentResultDto,
  OrderRetryAllocationResultDto,
} from '../dto/order.dto';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly ingestionService: OrderIngestionService,
  ) {}

  @Get()
  @ApiOperation({ summary: '订单列表（分页 + 汇总计数 + 未处理异常数）' })
  @ApiOkPagedEnvelope(OrderListItemDto)
  async list(@Query() query: OrderListQueryDto) {
    const result = await this.orderService.list(
      {
        keyword: query.keyword?.trim() || undefined,
        erpStatus: query.erpStatus,
        stage: query.stage as OrderStageFilter | undefined,
        goodsState: query.goodsState as OrderGoodsStateFilter | undefined,
        storeId: query.storeId,
        pendingProcurement: query.pendingProcurement === 'true',
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
}
