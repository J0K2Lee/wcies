import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { SyncDispatchService } from '../services/sync-dispatch.service';
import { SyncJobService } from '../services/sync-job.service';
import {
  RawEventDto,
  RawEventListQueryDto,
  StoreSyncOverviewDto,
  SyncJobDto,
  SyncJobListQueryDto,
  TriggerSyncRequestDto,
} from '../dto/sync.dto';

/**
 * Sync Center API (Sprint 5 task §31/§34): manual dispatch creates a job and
 * returns 202 immediately - the HTTP request NEVER waits for the platform.
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly dispatchService: SyncDispatchService,
    private readonly jobService: SyncJobService,
  ) {}

  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '手动触发订单同步（创建 SyncJob，立即返回）' })
  @ApiOkEnvelope(SyncJobDto)
  async triggerOrderSync(
    @Body() request: TriggerSyncRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SyncJobDto }> {
    return ok(
      this.jobService.toDto(
        await this.dispatchService.dispatch({
          storeId: request.storeId,
          syncType: 'ORDER_SYNC',
          trigger: 'MANUAL',
        }),
        { storeCode: '', storeName: '', platformCode: '' },
        operator,
      ),
    );
  }

  @Post('listings')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '手动触发 Listing 同步（创建 SyncJob，立即返回）' })
  @ApiOkEnvelope(SyncJobDto)
  async triggerListingSync(
    @Body() request: TriggerSyncRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SyncJobDto }> {
    return ok(
      this.jobService.toDto(
        await this.dispatchService.dispatch({
          storeId: request.storeId,
          syncType: 'LISTING_SYNC',
          trigger: 'MANUAL',
        }),
        { storeCode: '', storeName: '', platformCode: '' },
        operator,
      ),
    );
  }

  @Post('category-tree')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '手动触发类目树同步（Sprint 8.5 T3a：ZH_HANS+RU 双语合并落缓存表）' })
  @ApiOkEnvelope(SyncJobDto)
  async triggerCategoryTreeSync(
    @Body() request: TriggerSyncRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SyncJobDto }> {
    return ok(
      this.jobService.toDto(
        await this.dispatchService.dispatch({
          storeId: request.storeId,
          syncType: 'CATEGORY_TREE_SYNC',
          trigger: 'MANUAL',
        }),
        { storeCode: '', storeName: '', platformCode: '' },
        operator,
      ),
    );
  }

  @Post('product-enrichment')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '手动触发商品属性补齐（Sprint 8.5 T5：v4 attributes 并入 raw_data）',
  })
  @ApiOkEnvelope(SyncJobDto)
  async triggerProductEnrichmentSync(
    @Body() request: TriggerSyncRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SyncJobDto }> {
    return ok(
      this.jobService.toDto(
        await this.dispatchService.dispatch({
          storeId: request.storeId,
          syncType: 'PRODUCT_ENRICHMENT_SYNC',
          trigger: 'MANUAL',
        }),
        { storeCode: '', storeName: '', platformCode: '' },
        operator,
      ),
    );
  }

  @Get('jobs')
  @ApiOperation({ summary: '同步任务列表（Sync Dashboard）' })
  @ApiOkPagedEnvelope(SyncJobDto)
  async list(@Query() query: SyncJobListQueryDto): Promise<{
    success: true;
    data: SyncJobDto[];
    meta: PageMeta;
  }> {
    const { rows, total } = await this.jobService.list(query);
    return okPage(
      rows.map((row) => this.jobService.toDto(row, row)),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: '同步任务详情（含游标与错误）' })
  @ApiOkEnvelope(SyncJobDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: SyncJobDto }> {
    return ok(await this.jobService.getDto(id));
  }

  @Get('stores/:storeId/overview')
  @ApiOperation({ summary: '店铺同步概览（凭证状态/最近同步/连续失败）' })
  @ApiOkEnvelope(StoreSyncOverviewDto)
  async storeOverview(
    @Param('storeId') storeId: string,
  ): Promise<{ success: true; data: StoreSyncOverviewDto }> {
    return ok(await this.jobService.storeOverview(storeId));
  }

  @Get('events')
  @ApiOperation({ summary: '外部原始事件列表（Webhook 审计）' })
  @ApiOkPagedEnvelope(RawEventDto)
  async listEvents(@Query() query: RawEventListQueryDto): Promise<{
    success: true;
    data: RawEventDto[];
    meta: PageMeta;
  }> {
    const { rows, total } = await this.jobService.listRawEvents(query);
    return okPage(
      rows.map((row) => this.jobService.toRawEventDto(row)),
      {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    );
  }
}
