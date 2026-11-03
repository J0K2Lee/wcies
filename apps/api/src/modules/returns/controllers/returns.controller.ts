import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { ReturnsService } from '../services/returns.service';
import { PlatformReturnSyncService } from '../services/platform-return-sync.service';
import {
  PlatformReturnDto,
  PlatformReturnListQueryDto,
  PlatformReturnSyncDto,
  PlatformReturnSyncResultDto,
  ReturnBatchCreateDto,
  ReturnBatchDetailDto,
  ReturnBatchDto,
  ReturnBatchItemDto,
  ReturnBatchListQueryDto,
  ReturnItemInspectDto,
} from '../dto/return.dto';

@ApiTags('returns')
@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly returnsService: ReturnsService,
    private readonly platformReturnSync: PlatformReturnSyncService,
  ) {}

  // -------------------------------------------------------------------------
  // Platform return records (read-only facts)
  // -------------------------------------------------------------------------

  @Get('platform')
  @ApiOperation({ summary: '平台退货记录列表（只读事实，支持待收货对账视图）' })
  @ApiOkPagedEnvelope(PlatformReturnDto)
  async listPlatformReturns(@Query() query: PlatformReturnListQueryDto) {
    const result = await this.platformReturnSync.list(
      {
        storeId: query.storeId,
        orderId: query.orderId,
        linked: query.linked === undefined ? undefined : query.linked === 'false' ? false : true,
        keyword: query.keyword,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(result.items, result.meta);
  }

  @Post('platform/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '手动拉取店铺平台退货记录（OZON /v2/returns/rfbs/list，只读；不写库存）',
  })
  @ApiOkEnvelope(PlatformReturnSyncResultDto)
  async syncPlatformReturns(
    @Body() input: PlatformReturnSyncDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(await this.platformReturnSync.syncStoreReturns(input.storeId, operator));
  }

  // -------------------------------------------------------------------------
  // Return batches (the physical work documents)
  // -------------------------------------------------------------------------

  @Get('batches')
  @ApiOperation({ summary: '退货批次列表' })
  @ApiOkPagedEnvelope(ReturnBatchDto)
  async listBatches(@Query() query: ReturnBatchListQueryDto) {
    const result = await this.returnsService.listBatches(
      { status: query.status, warehouseId: query.warehouseId, keyword: query.keyword },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(result.items, result.meta);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: '退货批次详情（含行与检验结论）' })
  @ApiOkEnvelope(ReturnBatchDetailDto)
  async getBatch(@Param('id') id: string) {
    return ok(await this.returnsService.getBatch(id));
  }

  @Post('batches')
  @ApiOperation({ summary: '创建退货批次（DRAFT：登记批次与预期行）' })
  @ApiOkEnvelope(ReturnBatchDetailDto)
  async createBatch(
    @Body() input: ReturnBatchCreateDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(await this.returnsService.createBatch(input, operator));
  }

  @Post('batches/:id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '确认收货（实物已到退货仓并清点；此后行不可增删）' })
  @ApiOkEnvelope(ReturnBatchDetailDto)
  async receiveBatch(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.returnsService.receiveBatch(id, operator));
  }

  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消批次（仅 DRAFT：实物未到、未入账）' })
  @ApiOkEnvelope(ReturnBatchDetailDto)
  async cancelBatch(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.returnsService.cancelBatch(id, operator));
  }

  @Post('items/:itemId/inspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '检验退货行（一次性结论：SELLABLE/DEFECTIVE 经库存模块回库，LOST 不动库存；关联平台记录的差异行创建 RETURN_DIFFERENCE）',
  })
  @ApiOkEnvelope(ReturnBatchItemDto)
  async inspectItem(
    @Param('itemId') itemId: string,
    @Body() input: ReturnItemInspectDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(await this.returnsService.inspectItem({ itemId, ...input }, operator));
  }
}
