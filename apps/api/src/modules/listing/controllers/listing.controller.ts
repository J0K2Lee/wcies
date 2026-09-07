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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  AddListingSkuRequestDto,
  CreateListingRequestDto,
  ListingDetailDto,
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
  platformCode!: string;
  storeCode!: string;
  platformProductId!: string;
  title!: string | null;
  url!: string | null;
}

class ListingListEnvelopeDto {
  success!: true;
  data!: ListingResponseDto[];
  meta!: PageMeta;
}

class ListingDetailEnvelopeDto {
  success!: true;
  data!: ListingDetailDto;
}

class ListingSkuEnvelopeDto {
  success!: true;
  data!: ListingSkuResponseDto;
}

class ResolveEnvelopeDto {
  success!: true;
  data!: ResolveSkuResponseDto;
}

class SkuMappingsEnvelopeDto {
  success!: true;
  data!: SkuMappingRowDto[];
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
  @ApiOkResponse({ type: ListingListEnvelopeDto })
  async list(@Query() query: ListingListQueryDto): Promise<ListingListEnvelopeDto> {
    const { items, meta } = await this.listingService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create a listing with variant SKU mappings in one submit' })
  @ApiOkResponse({ type: ListingDetailEnvelopeDto })
  async create(
    @Body() dto: CreateListingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ListingDetailEnvelopeDto> {
    return ok(await this.listingService.create(dto, operator));
  }

  @Get('resolve')
  @ApiOperation({
    summary: 'Resolve an internal SKU by platform identifiers (STRICTLY store-scoped)',
  })
  @ApiOkResponse({ type: ResolveEnvelopeDto })
  async resolve(@Query() query: ResolveSkuRequestDto): Promise<ResolveEnvelopeDto> {
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
  @ApiOkResponse({ type: SkuMappingsEnvelopeDto })
  async listMappingsOfSku(@Param('skuId') skuId: string): Promise<SkuMappingsEnvelopeDto> {
    return ok(await this.listingService.listMappingsOfSku(skuId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Listing detail incl. variant mappings' })
  @ApiOkResponse({ type: ListingDetailEnvelopeDto })
  async getById(@Param('id') id: string): Promise<ListingDetailEnvelopeDto> {
    return ok(await this.listingService.getDetail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update listing title/url/rawData' })
  @ApiOkResponse({ type: ListingDetailEnvelopeDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateListingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ListingDetailEnvelopeDto> {
    return ok(await this.listingService.update(id, dto, operator));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a listing' })
  @ApiOkResponse({ type: ListingDetailEnvelopeDto })
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ListingDetailEnvelopeDto> {
    return ok(await this.listingService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a listing' })
  @ApiOkResponse({ type: ListingDetailEnvelopeDto })
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ListingDetailEnvelopeDto> {
    return ok(await this.listingService.setStatus(id, 'INACTIVE', operator));
  }

  @Post(':listingId/skus')
  @ApiOperation({ summary: 'Add a variant mapping to an existing listing' })
  @ApiOkResponse({ type: ListingSkuEnvelopeDto })
  async addMapping(
    @Param('listingId') listingId: string,
    @Body() dto: AddListingSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ListingSkuEnvelopeDto> {
    return ok(await this.listingService.addMapping(listingId, dto, operator));
  }

  @Patch(':listingId/skus/:id')
  @ApiOperation({ summary: 'Update a variant mapping' })
  @ApiOkResponse({ type: ListingSkuEnvelopeDto })
  async updateMapping(
    @Param('listingId') listingId: string,
    @Param('id') mappingId: string,
    @Body() dto: UpdateListingSkuRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ListingSkuEnvelopeDto> {
    return ok(await this.listingService.updateMapping(listingId, mappingId, dto, operator));
  }

  @Delete(':listingId/skus/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a mapping without order history' })
  async deleteMapping(
    @Param('listingId') listingId: string,
    @Param('id') mappingId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.listingService.deleteMapping(listingId, mappingId, operator);
    return ok({});
  }
}
