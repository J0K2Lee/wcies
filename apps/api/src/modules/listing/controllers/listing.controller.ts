import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import {
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiOkNoDataEnvelope,
  ApiOkPagedEnvelope,
} from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  AddListingSkuRequestDto,
  CreateListingRequestDto,
  EnsureListingVariantRequestDto,
  EnsureListingVariantResponseDto,
  ListingDetailDto,
  ListingMappingStatsDto,
  ListingOnboardContextDto,
  ListingOnboardRequestDto,
  ListingOnboardResponseDto,
  MapListingSkuRequestDto,
  ListingListQueryDto,
  ListingResponseDto,
  ListingSkuResponseDto,
  ResolveSkuRequestDto,
  FindUnmappedVariantQueryDto,
  FindUnmappedVariantResponseDto,
  SkuMatchCandidatesDto,
  SkuMatchCandidatesQueryDto,
  ResolveSkuResponseDto,
  UnmappedListingExportRequestDto,
  UnmappedListingExportResponseDto,
  UpdateListingRequestDto,
  UpdateListingSkuRequestDto,
} from '../dto/listing.dto';
import { ListingService } from '../services/listing.service';
import { ListingResolverService } from '../services/listing-resolver.service';
import { ListingOnboardingService } from '../services/listing-onboarding.service';
import { ListingSkuMatchService } from '../services/listing-sku-match.service';
import { ListingExportService } from '../services/listing-export.service';
import { ListingVariantBackfillService } from '../services/listing-variant-backfill.service';

/** Mapping row enriched with store/listing context (SKU drawer, task §91). */
export class SkuMappingRowDto extends ListingSkuResponseDto {
  @ApiProperty({ example: 'OZON' })
  platformCode!: string;
  @ApiProperty({ example: 'OZON-A' })
  storeCode!: string;
  @ApiProperty({ example: '152987456001' })
  platformProductId!: string;
  @ApiProperty({ nullable: true, type: String, example: 'VK87 MAX V2 机械键盘' })
  title!: string | null;
  @ApiProperty({ nullable: true, type: String })
  url!: string | null;
}

@ApiTags('listings')
@Controller('listings')
export class ListingController {
  constructor(
    private readonly listingService: ListingService,
    private readonly resolverService: ListingResolverService,
    private readonly onboardingService: ListingOnboardingService,
    private readonly skuMatchService: ListingSkuMatchService,
    private readonly exportService: ListingExportService,
    private readonly backfillService: ListingVariantBackfillService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List listings (platform/store/sku/status/mappingState filters)' })
  @ApiOkPagedEnvelope(ListingResponseDto)
  async list(
    @Query() query: ListingListQueryDto,
  ): Promise<{ success: true; data: ListingResponseDto[]; meta: PageMeta }> {
    const { items, meta } = await this.listingService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create a listing with variant SKU mappings in one submit' })
  @ApiOkEnvelope(ListingDetailDto)
  async create(
    @Body() dto: CreateListingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingDetailDto }> {
    return ok(await this.listingService.create(dto, operator));
  }

  @Post('ensure-variant')
  @ApiOperation({
    summary:
      '订单行按需补链接（2026-10-20）：本地缺失时定向读平台变体（一次调用），或按订单事实本地补建',
  })
  @ApiOkEnvelope(EnsureListingVariantResponseDto)
  async ensureVariant(
    @Body() dto: EnsureListingVariantRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: EnsureListingVariantResponseDto }> {
    return ok(
      await this.backfillService.ensure(
        {
          storeId: dto.storeId,
          platformProductId: dto.platformProductId ?? null,
          platformSkuId: dto.platformSkuId ?? null,
          offerId: dto.offerId ?? null,
          sellerSku: dto.sellerSku ?? null,
          source: dto.source ?? 'PLATFORM',
        },
        operator,
      ),
    );
  }

  @Get('unmapped-variant')
  @ApiOperation({
    summary: '订单行 → 本店未映射变体（精确匹配，映射弹窗按订单行预选；找不到返回 data=null）',
  })
  @ApiOkEnvelope(FindUnmappedVariantResponseDto)
  async findUnmappedVariant(@Query() query: FindUnmappedVariantQueryDto) {
    return ok(
      await this.resolverService.findUnmappedVariant({
        storeId: query.storeId,
        platformSkuId: query.platformSkuId,
        sellerSku: query.sellerSku,
        offerId: query.offerId,
      }),
    );
  }

  @Get('resolve')
  @ApiOperation({
    summary:
      'Resolve an internal SKU by platform identifiers (STRICTLY store-scoped, decision 0016)',
  })
  @ApiOkEnvelope(ResolveSkuResponseDto)
  async resolve(
    @Query() query: ResolveSkuRequestDto,
  ): Promise<{ success: true; data: ResolveSkuResponseDto }> {
    return ok(
      await this.resolverService.resolveInternalSku({
        storeId: query.storeId,
        platformSkuId: query.platformSkuId,
        sellerSku: query.sellerSku,
      }),
    );
  }

  @Get('mapping-stats')
  @ApiOperation({ summary: 'Mapped / unmapped listing counters (Sprint 8 unmapped workbench)' })
  @ApiOkEnvelope(ListingMappingStatsDto)
  async mappingStats(): Promise<{ success: true; data: ListingMappingStatsDto }> {
    return ok(await this.listingService.getMappingStats());
  }

  @Get(':listingId/skus/:id/match-candidates')
  @ApiOperation({
    summary:
      '重复档案候选（2026-10-24）：映射/建档之前提示同店铺同变体、同名档案、同型号其他变体（只读）',
  })
  @ApiOkEnvelope(SkuMatchCandidatesDto)
  async matchCandidates(
    @Param('listingId') listingId: string,
    @Param('id') id: string,
    @Query() query: SkuMatchCandidatesQueryDto,
  ): Promise<{ success: true; data: SkuMatchCandidatesDto }> {
    return ok(
      await this.skuMatchService.findCandidates(listingId, id, {
        name: query.name ?? null,
        brandId: query.brandId ?? null,
      }),
    );
  }

  @Get(':listingId/onboard-context')
  @ApiOperation({
    summary: '建档弹窗上下文（Sprint 8.5）：变体图片/类目键/类目建议/预填尺寸重量 + 缺省挂靠商品',
  })
  @ApiOkEnvelope(ListingOnboardContextDto)
  async onboardContext(
    @Param('listingId') listingId: string,
  ): Promise<{ success: true; data: ListingOnboardContextDto }> {
    return ok(await this.onboardingService.getOnboardContext(listingId));
  }

  @Post('exports/unmapped')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export unmapped variants as a LISTING_MAPPING-compatible Excel (signed URL download)',
  })
  @ApiOkEnvelope(UnmappedListingExportResponseDto)
  async exportUnmapped(
    @Body() dto: UnmappedListingExportRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: UnmappedListingExportResponseDto }> {
    return ok(
      await this.exportService.exportUnmapped(
        { platformId: dto.platformId, storeId: dto.storeId },
        operator,
      ),
    );
  }

  @Get('skus/:skuId/mappings')
  @ApiOperation({ summary: 'All platform mappings of an internal SKU' })
  @ApiOkArrayEnvelope(SkuMappingRowDto)
  async listMappingsOfSku(
    @Param('skuId') skuId: string,
  ): Promise<{ success: true; data: SkuMappingRowDto[] }> {
    return ok(await this.listingService.listMappingsOfSku(skuId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Listing detail incl. variant mappings' })
  @ApiOkEnvelope(ListingDetailDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: ListingDetailDto }> {
    return ok(await this.listingService.getDetail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update listing title/url/rawData' })
  @ApiOkEnvelope(ListingDetailDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateListingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingDetailDto }> {
    return ok(await this.listingService.update(id, dto, operator));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a listing' })
  @ApiOkEnvelope(ListingDetailDto)
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingDetailDto }> {
    return ok(await this.listingService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a listing' })
  @ApiOkEnvelope(ListingDetailDto)
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingDetailDto }> {
    return ok(await this.listingService.setStatus(id, 'INACTIVE', operator));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a listing with zero mappings (else LISTING_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async remove(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.listingService.remove(id, operator);
    return ok({});
  }

  @Post(':listingId/skus')
  @ApiOperation({ summary: 'Add a variant mapping to an existing listing' })
  @ApiOkEnvelope(ListingSkuResponseDto)
  async addMapping(
    @Param('listingId') listingId: string,
    @Body() dto: AddListingSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingSkuResponseDto }> {
    return ok(await this.listingService.addMapping(listingId, dto, operator));
  }

  @Post(':listingId/skus/:id/map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '人工映射：将同步来的 UNMAPPED 平台SKU 绑定到 Internal SKU（同步不覆盖）',
  })
  @ApiOkEnvelope(ListingSkuResponseDto)
  async mapUnmappedSku(
    @Param('listingId') listingId: string,
    @Param('id') mappingId: string,
    @Body() dto: MapListingSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingSkuResponseDto }> {
    return ok(await this.listingService.mapUnmappedSku(listingId, mappingId, dto, operator));
  }

  @Post(':listingId/skus/:id/onboard')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      '建档并映射（Sprint 8 T1）：一个事务内建 Product + SKU +（可选）内部条码并映射该未映射变体，失败整体回滚',
  })
  @ApiOkEnvelope(ListingOnboardResponseDto)
  async onboard(
    @Param('listingId') listingId: string,
    @Param('id') mappingId: string,
    @Body() dto: ListingOnboardRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingOnboardResponseDto }> {
    return ok(await this.onboardingService.onboard(listingId, mappingId, dto, operator));
  }

  @Patch(':listingId/skus/:id')
  @ApiOperation({ summary: 'Update a variant mapping' })
  @ApiOkEnvelope(ListingSkuResponseDto)
  async updateMapping(
    @Param('listingId') listingId: string,
    @Param('id') mappingId: string,
    @Body() dto: UpdateListingSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ListingSkuResponseDto }> {
    return ok(await this.listingService.updateMapping(listingId, mappingId, dto, operator));
  }

  @Delete(':listingId/skus/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a mapping without order history' })
  @ApiOkNoDataEnvelope()
  async deleteMapping(
    @Param('listingId') listingId: string,
    @Param('id') mappingId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.listingService.deleteMapping(listingId, mappingId, operator);
    return ok({});
  }
}
