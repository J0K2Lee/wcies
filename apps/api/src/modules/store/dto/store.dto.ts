import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { STORE_STATUSES } from '../constants/store.constants';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateStoreRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Platform the store belongs to' })
  @IsUUID()
  platformId!: string;

  @ApiPropertyOptional({
    description:
      'Auto-generated ({prefix}-%03d, e.g. ON-001) when omitted; immutable after creation',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  storeCode?: string;

  @ApiProperty({ example: 'OZON 店铺 A', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ example: '123456', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerId?: string;

  @ApiPropertyOptional({ example: 'RUB', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultCurrency?: string;

  @ApiPropertyOptional({ type: Object, description: 'Free-form store settings' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateStoreRequestDto {
  @ApiPropertyOptional({ example: 'OZON 店铺 A（新）', maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ example: '123456', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sellerId?: string;

  @ApiPropertyOptional({ example: 'RUB', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultCurrency?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class StoreListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  platformId?: string;

  @ApiPropertyOptional({ enum: STORE_STATUSES })
  @IsOptional()
  @IsIn(STORE_STATUSES)
  status?: (typeof STORE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Matches store_code / name' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class StoreResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  platformId!: string;

  @ApiProperty({ example: 'OZON' })
  platformCode!: string;

  @ApiProperty({ example: 'OZON' })
  platformName!: string;

  @ApiProperty({ example: 'OZON-A' })
  storeCode!: string;

  @ApiProperty({ example: 'OZON 店铺 A' })
  name!: string;

  @ApiProperty({ example: '123456', nullable: true })
  sellerId!: string | null;

  @ApiProperty({ example: 'RUB', nullable: true })
  defaultCurrency!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ type: Object, nullable: true })
  settings!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'https://hook.example.com/api/v1/webhooks/yandex/stores/YX-001',
    description:
      '入站 webhook 回调地址（OZON/WB/YANDEX）：平台侧订阅或「API 通知」里要填的地址；PUBLIC_BASE_URL 未配置时为 null',
  })
  webhookUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** List row with aggregated counts (single query, no N+1). */
export class StoreListItemDto extends StoreResponseDto {
  @ApiProperty({ example: true })
  credentialConfigured!: boolean;

  @ApiProperty({ example: 2 })
  bindingCount!: number;
}
