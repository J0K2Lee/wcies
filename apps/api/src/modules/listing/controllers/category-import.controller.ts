import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { CategoryImportService } from '../services/category-import.service';
import {
  CategoryImportPreviewDto,
  CategoryImportRequestDto,
  CategoryImportResultDto,
} from '../dto/listing.dto';

/**
 * Sprint 8.5 T3b: one-click platform tree import (dry-run -> confirm ->
 * single transaction). Preview is read-only; execute creates the internal
 * three-level categories + composite-key mapping rows in ONE transaction
 * and refuses on any conflict (AGENTS.md §89).
 */
@ApiTags('listings')
@Controller('listings/category-import')
export class CategoryImportController {
  constructor(private readonly importService: CategoryImportService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '类目导入预演（dry-run，不落库；冲突清单 + 建树预览）' })
  @ApiOkEnvelope(CategoryImportPreviewDto)
  async preview(
    @Body() dto: CategoryImportRequestDto,
  ): Promise<{ success: true; data: CategoryImportPreviewDto }> {
    return { success: true, data: await this.importService.preview(dto.platformId) };
  }

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '确认导入（单事务：三级类目 + 复合键映射；有冲突时 409 拒绝）',
  })
  @ApiOkEnvelope(CategoryImportResultDto)
  async execute(
    @Body() dto: CategoryImportRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CategoryImportResultDto }> {
    return { success: true, data: await this.importService.execute(dto.platformId, operator) };
  }
}
