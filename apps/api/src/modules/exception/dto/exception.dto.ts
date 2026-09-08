import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  EXCEPTION_SEVERITIES,
  EXCEPTION_STATUSES,
  EXCEPTION_TYPES,
} from '../enums/exception.constants';

export class ExceptionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'EXC00000001' }) exceptionNo!: string;
  @ApiProperty({ enum: EXCEPTION_TYPES }) exceptionType!: string;
  @ApiProperty({ enum: EXCEPTION_SEVERITIES }) severity!: string;
  @ApiProperty({ enum: EXCEPTION_STATUSES }) status!: string;
  @ApiProperty({ example: 'ORDER_ITEM' }) referenceType!: string;
  @ApiProperty() referenceId!: string;
  @ApiProperty({ nullable: true, type: String }) storeId!: string | null;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: Object }) details!: Record<string, unknown> | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) resolvedAt!: Date | null;
}

export class ExceptionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EXCEPTION_TYPES })
  @IsOptional()
  @IsIn(EXCEPTION_TYPES)
  exceptionType?: string;

  @ApiPropertyOptional({ enum: EXCEPTION_STATUSES })
  @IsOptional()
  @IsIn(EXCEPTION_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  referenceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

export class ExceptionCloseRequestDto {
  @ApiPropertyOptional({ description: '处理备注（记录在 details.closeRemark）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
