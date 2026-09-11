import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { SUPPLIER_STATUSES } from '../entities/supplier.entity';

export class SupplierListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SUP0001' }) code!: string;
  @ApiProperty({ example: '深圳华强北电子供应商' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) contactName!: string | null;
  @ApiPropertyOptional({ nullable: true }) contactPhone!: string | null;
  @ApiProperty({ enum: SUPPLIER_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  /** How many non-cancelled purchase documents reference this supplier. */
  @ApiProperty() referenceCount!: number;
}

export class SupplierResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SUP0001' }) code!: string;
  @ApiProperty({ example: '深圳华强北电子供应商' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) contactName!: string | null;
  @ApiPropertyOptional({ nullable: true }) contactPhone!: string | null;
  @ApiProperty({ enum: SUPPLIER_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
}

export class CreateSupplierRequestDto {
  @ApiProperty({ example: '深圳华强北电子供应商' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ description: '留空自动生成 SUP%04d；创建后不可改' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  code?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class UpdateSupplierRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) contactPhone?: string;
  @ApiPropertyOptional({ enum: SUPPLIER_STATUSES })
  @IsOptional()
  @IsIn(SUPPLIER_STATUSES)
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class SupplierListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '编码 / 名称模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: SUPPLIER_STATUSES })
  @IsOptional()
  @IsIn(SUPPLIER_STATUSES)
  status?: string;
}
