import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PageMeta } from '@wcies/shared';
import { IMPORT_STATUSES, IMPORT_TYPES, ImportRowError } from '../entities/import-job.entity';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ImportJobResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: IMPORT_TYPES })
  importType!: string;

  @ApiProperty({ enum: IMPORT_STATUSES })
  status!: string;

  @ApiProperty({ example: 'skus-2026.xlsx' })
  originalFilename!: string;

  @ApiProperty({ example: 100 })
  totalRows!: number;

  @ApiProperty({ example: 92 })
  validRows!: number;

  @ApiProperty({ example: 8 })
  invalidRows!: number;

  @ApiProperty({ example: 92 })
  importedRows!: number;

  @ApiProperty({ example: 0 })
  failedRows!: number;

  @ApiProperty({ type: Array, description: 'Row-level errors with exact Excel row numbers' })
  errors!: ImportRowError[] | null;

  @ApiProperty({ nullable: true })
  createdBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ format: 'date-time', nullable: true })
  importedAt!: Date | null;
}

export class ImportListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: IMPORT_TYPES })
  @IsOptional()
  @IsIn(IMPORT_TYPES)
  importType?: (typeof IMPORT_TYPES)[number];

  @ApiPropertyOptional({ enum: IMPORT_STATUSES })
  @IsOptional()
  @IsIn(IMPORT_STATUSES)
  status?: (typeof IMPORT_STATUSES)[number];
}

export class ImportTypeParamDto {
  @IsIn(IMPORT_TYPES)
  @IsString()
  type!: string;
}

export class ImportPageMetaDto implements PageMeta {
  page!: number;
  pageSize!: number;
  total!: number;
}
