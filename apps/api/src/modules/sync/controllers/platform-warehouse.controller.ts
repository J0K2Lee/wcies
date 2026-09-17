import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PlatformWarehouseQueryService } from '../services/platform-warehouse-query.service';

export class PlatformWarehouseOptionDto {
  @ApiProperty({ example: '1020005000770362' })
  platformWarehouseId!: string;

  @ApiProperty({ example: 'Екатеринбург_РФЦ' })
  name!: string;

  @ApiProperty({ example: 'OZON_FBO', enum: ['OZON_RFBS', 'OZON_FBS', 'OZON_FBP', 'OZON_FBO'] })
  @IsIn(['OZON_RFBS', 'OZON_FBS', 'OZON_FBP', 'OZON_FBO'])
  fulfillmentMode!: string;

  @ApiProperty({ example: 'MANAGED', enum: ['SELF_MANAGED', 'SEMI_MANAGED', 'MANAGED'] })
  @IsIn(['SELF_MANAGED', 'SEMI_MANAGED', 'MANAGED'])
  category!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  status?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  partnerName?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Boolean })
  @IsOptional()
  isActive?: boolean | null;
}

/**
 * 平台仓库目录（实时查询平台 API，用户指示 2026-09-17）：
 * GET /api/v1/stores/:storeId/platform-warehouses
 */
@ApiTags('platform-warehouses')
@Controller()
export class PlatformWarehouseController {
  constructor(private readonly queryService: PlatformWarehouseQueryService) {}

  @Get('stores/:storeId/platform-warehouses')
  @ApiOperation({ summary: '查询店铺的平台仓库目录（实时调用平台 API；当前仅 OZON）' })
  @ApiOkEnvelope(PlatformWarehouseOptionDto)
  async list(
    @Param('storeId') storeId: string,
  ): Promise<{ success: true; data: PlatformWarehouseOptionDto[] }> {
    const options = await this.queryService.listByStore(storeId);
    return ok(
      options.map((option) => ({
        platformWarehouseId: option.platformWarehouseId,
        name: option.name,
        fulfillmentMode: option.fulfillmentMode,
        category: option.category,
        status: option.detail.status ?? null,
        address: option.detail.address ?? null,
        partnerName: option.detail.partnerName ?? null,
        isActive: option.detail.isActive ?? null,
      })),
    );
  }
}
