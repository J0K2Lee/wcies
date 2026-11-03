import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  CloseRemainingRequestDto,
  CloseRemainingResultDto,
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
  PurchaseOrderListQueryDto,
  UpdatePurchaseOrderRequestDto,
} from '../dto/purchase-order.dto';
import {
  PurchaseBatchDeleteRequestDto,
  PurchaseBatchDeleteResultDto,
} from '../dto/purchase-batch-delete.dto';
import { PurchaseOrderService } from '../services/purchase-order.service';

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly poService: PurchaseOrderService) {}

  @Get()
  @ApiOperation({ summary: '采购单列表（筛选：状态/供应商/日期/关联订单行）' })
  @ApiOkPagedEnvelope(PurchaseOrderListItemDto)
  async list(
    @Query() query: PurchaseOrderListQueryDto,
  ): Promise<{ success: true; data: PurchaseOrderListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.poService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登记采购单（同一订单行重复登记会被拒绝）' })
  @ApiOkEnvelope(PurchaseOrderDetailDto)
  async create(
    @Body() dto: CreatePurchaseOrderRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseOrderDetailDto }> {
    return ok(await this.poService.create(dto, operator));
  }

  // 批量路由必须先于 :id 参数路由声明（同订单模块约定，避免段名被当成 id）。
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '批量删除采购单（仅从未产生库存事实的：无 RECEIVED 收货单且未收数量为 0；逐笔隔离失败）',
  })
  @ApiOkEnvelope(PurchaseBatchDeleteResultDto)
  async deleteBatch(
    @Body() request: PurchaseBatchDeleteRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseBatchDeleteResultDto }> {
    return ok(await this.poService.deleteBatch(request.ids, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: '采购单详情（含明细与关联订单号）' })
  @ApiOkEnvelope(PurchaseOrderDetailDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: PurchaseOrderDetailDto }> {
    return ok(await this.poService.getDetail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改采购单（仅 ORDERED 状态）' })
  @ApiOkEnvelope(PurchaseOrderDetailDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseOrderDetailDto }> {
    return ok(await this.poService.update(id, dto, operator));
  }

  @Post(':id/close-remaining')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '短装结案（2026-11-03）：把供应商不再发货的剩余数量关掉（不写收货、不碰库存/成本）',
  })
  @ApiOkEnvelope(CloseRemainingResultDto)
  async closeRemaining(
    @Param('id') id: string,
    @Body() dto: CloseRemainingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CloseRemainingResultDto }> {
    return ok(await this.poService.closeRemaining(id, dto, operator));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消采购单（仅未收货）' })
  @ApiOkEnvelope(PurchaseOrderDetailDto)
  async cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseOrderDetailDto }> {
    return ok(await this.poService.cancel(id, operator, body.reason));
  }
}
