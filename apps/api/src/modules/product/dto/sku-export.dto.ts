import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SKU_STATUSES } from '../entities/sku.entity';

/**
 * SKU 自定义列导出（2026-11-04）。
 *
 * 筛选条件与 `SkuListQueryDto` 同构（不含分页）：「导出 = 当前筛选结果」。
 * 列的合法性在服务层用列目录白名单校验 —— 未知列回一个明确的 422，
 * 而不是把 40 个合法 key 全塞进校验消息里。
 */
export class SkuExportFiltersDto {
  @ApiPropertyOptional({ description: 'Matches sku_code / name_zh / name_ru / model / barcode' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '含全部子分类（决策 0005 §9.5）' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: SKU_STATUSES })
  @IsOptional()
  @IsIn(SKU_STATUSES)
  status?: (typeof SKU_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasListing?: 'true' | 'false';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  platformId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  serialTracking?: 'true' | 'false';
}

export class CreateSkuExportRequestDto {
  @ApiProperty({
    example: ['skuCode', 'nameZh', 'brand', 'platform'],
    description: '列 key，必须来自 GET /skus/exports/columns；含平台映射列时一行一 listing',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  columns!: string[];

  @ApiPropertyOptional({ type: SkuExportFiltersDto, description: '不传 = 全部 SKU' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SkuExportFiltersDto)
  filters?: SkuExportFiltersDto;

  @ApiPropertyOptional({
    type: [String],
    description: '只导出这些 SKU（表格多选）；与该字段同时存在时忽略 filters',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  skuIds?: string[];

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'skuCode', 'nameZh'],
    default: 'skuCode',
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'skuCode', 'nameZh'])
  sortBy?: 'createdAt' | 'updatedAt' | 'skuCode' | 'nameZh';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    example: 480,
    description: '浏览器时区偏移（分钟，东八区 = 480）。时间列按它换算后写入 Excel。',
  })
  @IsOptional()
  @IsInt()
  @Min(-840)
  @Max(840)
  tzOffsetMinutes?: number;
}

/** 列目录项（前端渲染勾选弹窗用）。 */
export class SkuExportColumnDto {
  @ApiProperty({ example: 'skuCode' })
  key!: string;

  @ApiProperty({ example: 'SKU编码' })
  label!: string;

  @ApiProperty({ example: 'BASIC' })
  group!: string;

  @ApiProperty({ example: '基础' })
  groupLabel!: string;

  @ApiProperty({ example: true, description: '勾选后按「一行一 listing」展开' })
  listing!: boolean;

  @ApiProperty({ example: true })
  defaultSelected!: boolean;
}

export const SKU_EXPORT_JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type SkuExportJobStatus = (typeof SKU_EXPORT_JOB_STATUSES)[number];

export class SkuExportJobCreatedDto {
  @ApiProperty({ example: '12' })
  jobId!: string;

  @ApiProperty({ enum: SKU_EXPORT_JOB_STATUSES })
  status!: SkuExportJobStatus;
}

export class SkuExportJobStatusDto {
  @ApiProperty({ example: '12' })
  jobId!: string;

  @ApiProperty({ enum: SKU_EXPORT_JOB_STATUSES })
  status!: SkuExportJobStatus;

  @ApiProperty({ example: 42, description: '进度百分比 0–100' })
  progress!: number;

  @ApiPropertyOptional({ example: 1234 })
  rowCount?: number;

  @ApiPropertyOptional({ example: 'SKU导出_20261104_1530.xlsx' })
  fileName?: string;

  @ApiPropertyOptional({ description: '签名下载地址（30 分钟有效），仅 COMPLETED 时返回' })
  downloadUrl?: string;

  @ApiPropertyOptional({ example: '导出失败原因' })
  error?: string;
}
