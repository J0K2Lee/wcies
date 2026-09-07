import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';

const COMMON_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class CreateBrandRequestDto {
  @ApiProperty({ example: 'VALKYRIE', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  code!: string;

  @ApiProperty({ example: 'VALKYRIE', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  nameZh!: string;

  @ApiPropertyOptional({ example: 'Valkyrie', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'VALKYRIE', maxLength: 200 })
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

  @ApiProperty({ example: 'VALKYRIE' })
  code!: string;

  @ApiProperty({ example: 'VALKYRIE' })
  nameZh!: string;

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

  @ApiProperty({ example: 'KEYBOARD', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  code!: string;

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

  @ApiProperty({ example: 'KEYBOARD' })
  code!: string;

  @ApiProperty({ example: '键盘' })
  nameZh!: string;

  @ApiProperty({ nullable: true })
  nameRu!: string | null;

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
