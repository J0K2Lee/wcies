import {
  Body,
  Controller,
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
  CreateProductRequestDto,
  ProductListItemDto,
  ProductListQueryDto,
  ProductResponseDto,
  SkuResponseDto,
  UpdateProductRequestDto,
} from '../dto/product-sku.dto';
import { ProductService } from '../services/product.service';

class ProductListEnvelopeDto {
  success!: true;
  data!: ProductListItemDto[];
  meta!: PageMeta;
}

class ProductEnvelopeDto {
  success!: true;
  data!: ProductResponseDto;
}

class ProductDetailEnvelopeDto {
  success!: true;
  data!: { product: ProductResponseDto; skus: SkuResponseDto[] };
}

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List products (paged, keyword/brand/category/status filters)' })
  @ApiOkResponse({ type: ProductListEnvelopeDto })
  async list(@Query() query: ProductListQueryDto): Promise<ProductListEnvelopeDto> {
    const { items, meta } = await this.productService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product (code auto-generated when omitted)' })
  @ApiOkResponse({ type: ProductEnvelopeDto })
  async create(
    @Body() dto: CreateProductRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ProductEnvelopeDto> {
    return ok(await this.productService.create(dto, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail incl. its SKUs' })
  @ApiOkResponse({ type: ProductDetailEnvelopeDto })
  async getById(@Param('id') id: string): Promise<ProductDetailEnvelopeDto> {
    return ok(await this.productService.getDetail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update product fields (business code editable, UUID immutable)' })
  @ApiOkResponse({ type: ProductEnvelopeDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ProductEnvelopeDto> {
    return ok(await this.productService.update(id, dto, operator));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a product' })
  @ApiOkResponse({ type: ProductEnvelopeDto })
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ProductEnvelopeDto> {
    return ok(await this.productService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a product (no hard delete once referenced)' })
  @ApiOkResponse({ type: ProductEnvelopeDto })
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ProductEnvelopeDto> {
    return ok(await this.productService.setStatus(id, 'INACTIVE', operator));
  }
}
