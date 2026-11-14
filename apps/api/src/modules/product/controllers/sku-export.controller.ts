import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkArrayEnvelope, ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { SKU_EXPORT_COLUMNS, SKU_EXPORT_GROUPS } from '../constants/sku-export-columns';
import {
  CreateSkuExportRequestDto,
  SkuExportColumnDto,
  SkuExportJobCreatedDto,
  SkuExportJobStatusDto,
} from '../dto/sku-export.dto';
import { SkuExportQueueService } from '../services/sku-export-queue.service';

/**
 * SKU 自定义列导出（2026-11-04）。
 *
 * 路由放在 `/skus/exports/*`（三段），与 `/skus/:id`（两段）不冲突：
 * - GET  /skus/exports/columns  → 列目录（前端唯一事实源）
 * - POST /skus/exports          → 提交导出任务（202 + jobId）
 * - GET  /skus/exports/:jobId   → 轮询状态 / 取签名下载地址
 *
 * Controller 只做 HTTP + 参数 → Service（AGENTS §6）；Excel 生成在 Service，
 * 执行在 BullMQ processor。
 */
@ApiTags('sku-exports')
@Controller('skus/exports')
export class SkuExportController {
  constructor(private readonly exportQueue: SkuExportQueueService) {}

  @Get('columns')
  @ApiOperation({ summary: '导出可选列目录（含分组与默认勾选）' })
  @ApiOkArrayEnvelope(SkuExportColumnDto)
  columns(): { success: true; data: SkuExportColumnDto[] } {
    const groupLabels = new Map(SKU_EXPORT_GROUPS.map((group) => [group.key, group.label]));
    return ok(
      SKU_EXPORT_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        group: column.group,
        groupLabel: groupLabels.get(column.group) ?? column.group,
        listing: column.listing,
        defaultSelected: column.defaultSelected,
      })),
    );
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '提交 SKU 导出任务（一行一 listing；全量，走队列）' })
  @ApiOkEnvelope(SkuExportJobCreatedDto)
  async create(
    @Body() dto: CreateSkuExportRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuExportJobCreatedDto }> {
    const filters = dto.filters;
    return ok(
      await this.exportQueue.createExport(
        {
          columns: dto.columns,
          skuIds: dto.skuIds,
          filters:
            filters === undefined
              ? undefined
              : {
                  keyword: filters.keyword,
                  brandId: filters.brandId,
                  categoryId: filters.categoryId,
                  status: filters.status,
                  hasListing:
                    filters.hasListing === undefined ? undefined : filters.hasListing === 'true',
                  platformId: filters.platformId,
                  storeId: filters.storeId,
                  serialTracking:
                    filters.serialTracking === undefined
                      ? undefined
                      : filters.serialTracking === 'true',
                },
          sortBy: dto.sortBy ?? 'skuCode',
          sortOrder: dto.sortOrder ?? 'asc',
          tzOffsetMinutes: dto.tzOffsetMinutes ?? 0,
        },
        operator,
      ),
    );
  }

  @Get(':jobId')
  @ApiOperation({ summary: '导出任务状态（COMPLETED 时带 30 分钟签名下载地址）' })
  @ApiOkEnvelope(SkuExportJobStatusDto)
  async status(
    @Param('jobId') jobId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SkuExportJobStatusDto }> {
    return ok(await this.exportQueue.getStatus(jobId, operator));
  }
}
