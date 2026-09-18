import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { OrderPlatformShipService } from '../services/order-platform-ship.service';
import { QuickShipService } from '../../shipment/services/quick-ship.service';
import { QuickShipResultDto, ShippingLabelDto } from '../../shipment/dto/shipment.dto';
import { FetchShippingLabelQueryDto, PrepareShipmentResultDto } from '../dto/order-fulfillment.dto';

/**
 * Order fulfillment actions of the real daily flow
 * 「获取运单号 → 拣货 → 打单 → 发货」(user instruction 2026-09-18).
 *
 * Lives with the sync/platform layer - not in OrderController - because two of
 * the four actions are REAL platform operations and must dispatch through the
 * adapter layer with store credentials (arch Rule 5). Same arrangement as
 * PlatformWarehouseController; the routes stay order-scoped.
 */
@ApiTags('orders')
@Controller('orders')
export class OrderFulfillmentController {
  constructor(
    private readonly platformShipService: OrderPlatformShipService,
    private readonly quickShipService: QuickShipService,
  ) {}

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
