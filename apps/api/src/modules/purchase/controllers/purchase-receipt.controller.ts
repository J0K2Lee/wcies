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
  CreatePurchaseReceiptRequestDto,
  GenerateReceiptFromPoRequestDto,
  PurchaseReceiptConfirmResultDto,
  PurchaseReceiptDetailDto,
  PurchaseReceiptListItemDto,
  PurchaseReceiptListQueryDto,
  UpdatePurchaseReceiptRequestDto,
} from '../dto/purchase-receipt.dto';
import { PurchaseReceiptService } from '../services/purchase-receipt.service';

@ApiTags('purchase-receipts')
@Controller('purchase-receipts')
export class PurchaseReceiptController {
  constructor(private readonly receiptService: PurchaseReceiptService) {}

  @Get()
  @ApiOperation({ summary: '收货单列表（筛选：状态/仓库/来源采购单）' })
  @ApiOkPagedEnvelope(PurchaseReceiptListItemDto)
  async list(
    @Query() query: PurchaseReceiptListQueryDto,
  ): Promise<{ success: true; data: PurchaseReceiptListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.receiptService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新建收货单草稿（确认时才写库存）' })
  @ApiOkEnvelope(PurchaseReceiptDetailDto)
  async create(
    @Body() dto: CreatePurchaseReceiptRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseReceiptDetailDto }> {
    return ok(await this.receiptService.create(dto, operator));
  }

  @Post('from-po/:poId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '从采购单生成收货单（预填剩余数量/成本/供应商）' })
  @ApiOkEnvelope(PurchaseReceiptDetailDto)
  async generateFromPo(
    @Param('poId') poId: string,
    @Body() dto: GenerateReceiptFromPoRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseReceiptDetailDto }> {
    return ok(await this.receiptService.generateFromPo(poId, dto, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: '收货单详情（确认前预览即此数据）' })
  @ApiOkEnvelope(PurchaseReceiptDetailDto)
  async getById(
    @Param('id') id: string,
  ): Promise<{ success: true; data: PurchaseReceiptDetailDto }> {
    return ok(await this.receiptService.getDetail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改收货单草稿（仅 DRAFT）' })
  @ApiOkEnvelope(PurchaseReceiptDetailDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseReceiptRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseReceiptDetailDto }> {
    return ok(await this.receiptService.update(id, dto, operator));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '确认收货（整单一个事务写入库存与流水；重复确认幂等）',
  })
  @ApiOkEnvelope(PurchaseReceiptConfirmResultDto)
  async confirm(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseReceiptConfirmResultDto }> {
    return ok(await this.receiptService.confirm(id, operator));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消收货单（仅 DRAFT，从未碰库存）' })
  @ApiOkEnvelope(PurchaseReceiptDetailDto)
  async cancel(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PurchaseReceiptDetailDto }> {
    return ok(await this.receiptService.cancel(id, operator));
  }
}
