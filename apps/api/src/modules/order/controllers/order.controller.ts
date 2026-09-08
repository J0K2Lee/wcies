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
import { OrderService } from '../services/order.service';
import { OrderIngestionService } from '../services/order-ingestion.service';
import {
  NormalizedOrderInputDto,
  OrderCancelRequestDto,
  OrderCancelResultDto,
  OrderDetailDto,
  OrderIngestResultDto,
  OrderListItemDto,
  OrderListQueryDto,
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
  async list(@Query() query: OrderListQueryDto) {
    const result = await this.orderService.list(query, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage<OrderListItemDto>(result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（行/预约/历史/异常/拦截/拣货）' })
  async get(@Param('id') id: string) {
    return ok<OrderDetailDto>(await this.orderService.getDetail(id));
  }

  @Post('ingest')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '标准化订单摄入（管理员/开发测试入口；未来 SyncService 复用 Service）',
  })
  async ingest(
    @Body() input: NormalizedOrderInputDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderIngestResultDto>(await this.ingestionService.ingest(input, operator));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消订单（按行处理库存：Reserved 释放 / Picked 拦截）' })
  async cancel(
    @Param('id') id: string,
    @Body() request: OrderCancelRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderCancelResultDto>(await this.orderService.cancel(id, operator, request.reason));
  }

  @Post('items/:itemId/retry-allocation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试分配库存（BACKORDERED / PENDING 行）' })
  async retryAllocation(
    @Param('itemId') itemId: string,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<OrderRetryAllocationResultDto>(
      await this.orderService.retryAllocation(itemId, operator),
    );
  }
}
