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

// ---------------------------------------------------------------------------
// Response DTOs (contract guard: envelopes must resolve to real schemas).
// ---------------------------------------------------------------------------

export class TransferOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TRF000001' }) transferNo!: string;
  @ApiProperty() fromWarehouseId!: string;
  @ApiProperty() toWarehouseId!: string;
  @ApiProperty({ enum: TRANSFER_ORDER_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ nullable: true, type: String }) createdBy!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: String }) fromWarehouseName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) toWarehouseName!: string | null;
  @ApiPropertyOptional({ example: 2 }) linesCount!: number;
}

export class TransferOrderLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() transferId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty({ example: '4.000' }) quantity!: string;
  @ApiProperty({ nullable: true, type: String }) fromBinId!: string | null;
  @ApiProperty({ nullable: true, type: String }) toBinId!: string | null;
  @ApiProperty({ nullable: true, type: String }) outEventNo!: string | null;
  @ApiProperty({ nullable: true, type: String }) inEventNo!: string | null;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiPropertyOptional({ example: 'SKU000001001' }) skuCode!: string;
  @ApiPropertyOptional({ example: '浴帘 黑色' }) skuName!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) fromBinCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) toBinCode!: string | null;
}

export class TransferOrderDetailDto extends TransferOrderDto {
  @ApiProperty({ type: [TransferOrderLineDto] }) lines!: TransferOrderLineDto[];
}
