import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TRANSFER_ORDER_STATUSES } from '../enums/transfer.constants';

const POSITIVE_QTY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;
const asQuantityString = ({ value }: { value: unknown }): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
};

export class TransferLineInputDto {
  @ApiProperty() @IsUUID() skuId!: string;
  @ApiProperty({ example: '5' })
  @Transform(asQuantityString)
  @Matches(POSITIVE_QTY_PATTERN, { message: '数量必须为正数（最多3位小数）' })
  quantity!: string;
  @ApiPropertyOptional({ description: '源库位（空 = 源仓默认库位）' })
  @IsOptional()
  @IsUUID()
  fromBinId?: string;
  @ApiPropertyOptional({ description: '目标库位（空 = 目标仓默认库位）' })
  @IsOptional()
  @IsUUID()
  toBinId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}

export class CreateTransferRequestDto {
  @ApiProperty({ description: '源仓库' }) @IsUUID() fromWarehouseId!: string;
  @ApiProperty({ description: '目标仓库' }) @IsUUID() toWarehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @ApiProperty({ type: [TransferLineInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferLineInputDto)
  lines!: TransferLineInputDto[];
}

export class AddTransferLineRequestDto extends TransferLineInputDto {}

export class TransferListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '调拨单号模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() fromWarehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toWarehouseId?: string;
  @ApiPropertyOptional({ enum: TRANSFER_ORDER_STATUSES })
  @IsOptional()
  @IsIn(TRANSFER_ORDER_STATUSES)
  status?: string;
}
