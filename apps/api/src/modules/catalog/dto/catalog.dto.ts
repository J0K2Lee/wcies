import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';

const COMMON_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class CreateBrandRequestDto {
  @ApiPropertyOptional({ description: 'Auto-generated (BN%05d) when omitted' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  code?: string;

  @ApiProperty({ example: 'Valkyrie', description: 'General name; default display name' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ example: '瓦尔基里', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameZh?: string;

  @ApiPropertyOptional({ example: 'Valkyrie', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'ВАЛЬКИРИЯ', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameRu?: string;
}

export class UpdateBrandRequestDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameZh?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameRu?: string;

  @ApiPropertyOptional({ enum: COMMON_STATUSES })
  @IsOptional()
  @IsIn(COMMON_STATUSES)
  status?: (typeof COMMON_STATUSES)[number];
}

export class BrandResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BN00001' })
  code!: string;

  @ApiProperty({ example: 'Valkyrie' })
  name!: string;

  @ApiProperty({ example: '瓦尔基里', nullable: true })
  nameZh!: string | null;

  @ApiProperty({ nullable: true })
  nameEn!: string | null;

  @ApiProperty({ nullable: true })
  nameRu!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CreateCategoryRequestDto {
  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ example: 'CN00251', description: 'Auto-generated (CN%05d) when omitted' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  code?: string;

  @ApiProperty({ example: '键盘', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  nameZh!: string;

  @ApiPropertyOptional({ example: 'Клавиатуры', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameRu?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCategoryRequestDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  nameZh?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameRu?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ enum: COMMON_STATUSES })
  @IsOptional()
  @IsIn(COMMON_STATUSES)
  status?: (typeof COMMON_STATUSES)[number];
}

export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ example: 'CN00251' })
  code!: string;

  @ApiProperty({ example: '键盘' })
  nameZh!: string;

  @ApiProperty({ nullable: true })
  nameRu!: string | null;

  @ApiProperty({ example: 3, description: '1..3; products may only reference level 3' })
  level!: number;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Category node with children for tree display. */
export class CategoryTreeItemDto extends CategoryResponseDto {
  @ApiProperty({ type: [CategoryTreeItemDto] })
  children!: CategoryTreeItemDto[];
}

/**
 * Column-pruned category node (Sprint 8.5R1): the category pickers and the
 * classification manager only ever read these fields, so the 8k-node OZON
 * tree is shipped without the entity's bookkeeping columns. `code` IS kept -
 * the 分类管理 panel displays it (ProductsPage). `GET /categories` stays as-is
 * for callers that need the full entity shape.
 */
export class CategoryTreeLiteItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ example: 'CN00251' })
  code!: string;

  @ApiProperty({ example: '键盘' })
  nameZh!: string;

  @ApiProperty({ nullable: true })
  nameRu!: string | null;

  @ApiProperty({ example: 3, description: '1..3; products may only reference level 3' })
  level!: number;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ type: [CategoryTreeLiteItemDto] })
  children!: CategoryTreeLiteItemDto[];
}
