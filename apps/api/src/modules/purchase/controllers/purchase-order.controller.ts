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
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
  PurchaseOrderListQueryDto,
  UpdatePurchaseOrderRequestDto,
} from '../dto/purchase-order.dto';
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
