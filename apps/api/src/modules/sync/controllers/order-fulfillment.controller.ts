import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { OrderPlatformShipService } from '../services/order-platform-ship.service';
import { QuickShipService } from '../../shipment/services/quick-ship.service';
import { QuickShipResultDto, ShippingLabelDto } from '../../shipment/dto/shipment.dto';
import {
  BatchOrderActionRequestDto,
  BatchPrepareShipmentResultDto,
  BatchShipResultDto,
  FetchShippingLabelQueryDto,
  PrepareShipmentResultDto,
} from '../dto/order-fulfillment.dto';

/**
 * Order fulfillment actions of the real daily flow
 * 「获取运单号 → 拣货 → 打单 → 发货」(user instruction 2026-09-18).
 *
 * Lives with the sync/platform layer - not in OrderController - because two of
 * the four actions are REAL platform operations and must dispatch through the
 * adapter layer with store credentials (arch Rule 5). Same arrangement as
 * PlatformWarehouseController; the routes stay order-scoped.
 *
 * Batch twins of 获取运单号/发货 (订单页多选, 2026-10-13) live here too: they
 * run the SAME per-order paths sequentially and report per-order outcomes, so
 * one failing order never fails the batch (AGENTS.md §36/§43).
 */
@ApiTags('orders')
@Controller('orders')
export class OrderFulfillmentController {
  constructor(
    private readonly platformShipService: OrderPlatformShipService,
    private readonly quickShipService: QuickShipService,
  ) {}

  @Post('batch-prepare-shipment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '批量获取运单号（订单页多选；逐单平台组包，真实平台写操作，单笔失败不影响其余）',
  })
  @ApiOkEnvelope(BatchPrepareShipmentResultDto)
  async prepareShipmentBatch(
    @Body() request: BatchOrderActionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<BatchPrepareShipmentResultDto>(
      await this.platformShipService.prepareShipmentBatch(request.orderIds, operator),
    );
  }

  @Post('batch-ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '批量发货（订单页多选；逐单一键出库扣库存，单笔失败不影响其余）',
  })
  @ApiOkEnvelope(BatchShipResultDto)
  async quickShipBatch(
    @Body() request: BatchOrderActionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<BatchShipResultDto>(
      await this.quickShipService.quickShipBatch(request.orderIds, operator),
    );
  }

  @Post(':id/prepare-shipment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '获取运单号（平台组包；真实平台写操作，幂等：已组包则不重复写）',
  })
  @ApiOkEnvelope(PrepareShipmentResultDto)
  async prepareShipment(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<PrepareShipmentResultDto>(
      await this.platformShipService.prepareShipment(id, operator),
    );
  }

  @Post(':id/shipping-label')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '打单（取平台面单 PDF 存私有桶，返回签名 URL 供浏览器打开打印）',
  })
  @ApiOkEnvelope(ShippingLabelDto)
  async fetchShippingLabel(
    @Param('id') id: string,
    @Query() query: FetchShippingLabelQueryDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok<ShippingLabelDto>(
      await this.platformShipService.fetchShippingLabel(
        id,
        { refresh: query.refresh === 'true' },
        operator,
      ),
    );
  }

  @Get(':id/shipping-labels')
  @ApiOperation({ summary: '该订单的平台面单列表（不调用平台）' })
  @ApiOkEnvelope(ShippingLabelDto)
  async listShippingLabels(@Param('id') id: string) {
    return ok<ShippingLabelDto[]>(await this.platformShipService.listShippingLabels(id));
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '一键发货：自动建发货单+单包裹装箱封箱 → 正式出库扣减库存 → 订单 SHIPPED',
  })
  @ApiOkEnvelope(QuickShipResultDto)
  async quickShip(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok<QuickShipResultDto>(await this.quickShipService.quickShipOrder(id, operator));
  }
}
