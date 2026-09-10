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
  ListingDetailDto,
  MapListingSkuRequestDto,
  ListingListQueryDto,
  ListingResponseDto,
  ListingSkuResponseDto,
  ResolveSkuRequestDto,
  ResolveSkuResponseDto,
  UpdateListingRequestDto,
  UpdateListingSkuRequestDto,
} from '../dto/listing.dto';
import { ListingService } from '../services/listing.service';
import { ListingResolverService } from '../services/listing-resolver.service';

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

  @Get('resolve')
  @ApiOperation({
    summary: 'Resolve an internal SKU by platform identifiers (STRICTLY store-scoped)',
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
        offerId: query.offerId,
      }),
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
