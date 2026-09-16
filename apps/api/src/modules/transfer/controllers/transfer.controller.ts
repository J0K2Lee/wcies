import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import {
  AddTransferLineRequestDto,
  CreateTransferRequestDto,
  TransferListQueryDto,
} from '../dto/transfer.dto';
import { TransferService } from '../services/transfer.service';

/** Warehouse transfer HTTP surface (Sprint 10, transfer.md). */
@ApiTags('transfers')
@Controller('transfers')
export class TransferController {
  constructor(private readonly transfers: TransferService) {}

  @Get()
  @ApiOperation({ summary: '调拨单列表' })
  @ApiOkPagedEnvelope(Object)
  async list(@Query() query: TransferListQueryDto) {
    const result = await this.transfers.list(
      {
        keyword: query.keyword,
        fromWarehouseId: query.fromWarehouseId,
        toWarehouseId: query.toWarehouseId,
        status: query.status,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: '调拨单详情（含行与库位）' })
  @ApiOkEnvelope(Object)
  async getDetail(@Param('id') id: string) {
    return ok(await this.transfers.getDetail(id));
  }

  @Post()
  @ApiOperation({ summary: '登记调拨单（DRAFT，可继续增删行）' })
  @ApiOkEnvelope(Object)
  async create(
    @Body() body: CreateTransferRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(
      await this.transfers.create(
        {
          fromWarehouseId: body.fromWarehouseId,
          toWarehouseId: body.toWarehouseId,
          remark: body.remark,
          lines: body.lines.map((line) => ({
            skuId: line.skuId,
            quantity: line.quantity,
            fromBinId: line.fromBinId ?? null,
            toBinId: line.toBinId ?? null,
            remark: line.remark ?? null,
          })),
        },
        operator,
      ),
    );
  }

  @Post(':id/lines')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '调拨单追加明细行（仅 DRAFT）' })
  @ApiOkEnvelope(Object)
  async addLine(
    @Param('id') id: string,
    @Body() body: AddTransferLineRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(
      await this.transfers.addLine(
        id,
        {
          skuId: body.skuId,
          quantity: body.quantity,
          fromBinId: body.fromBinId ?? null,
          toBinId: body.toBinId ?? null,
          remark: body.remark ?? null,
        },
        operator,
      ),
    );
  }

  @Delete(':id/lines/:lineId')
  @ApiOperation({ summary: '调拨单删除明细行（仅 DRAFT）' })
  @ApiOkEnvelope(Object)
  async removeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(await this.transfers.removeLine(id, lineId, operator));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '确认调拨（单事务双段移库，任一行失败整体回滚）' })
  @ApiOkEnvelope(Object)
  async confirm(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.transfers.confirm(id, operator));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消调拨（仅 DRAFT，未碰库存）' })
  @ApiOkEnvelope(Object)
  async cancel(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.transfers.cancel(id, operator));
  }
}
