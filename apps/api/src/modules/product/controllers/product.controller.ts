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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import {
  ApiOkEnvelope,
  ApiOkNoDataEnvelope,
  ApiOkPagedEnvelope,
} from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  CreateProductRequestDto,
  ProductDetailDto,
  ProductListItemDto,
  ProductListQueryDto,
  ProductResponseDto,
  UpdateProductRequestDto,
} from '../dto/product-sku.dto';
import { ProductService } from '../services/product.service';

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List products (paged, keyword/brand/category/status filters)' })
  @ApiOkPagedEnvelope(ProductListItemDto)
  async list(
    @Query() query: ProductListQueryDto,
  ): Promise<{ success: true; data: ProductListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.productService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product (code auto-generated when omitted)' })
  @ApiOkEnvelope(ProductResponseDto)
  async create(
    @Body() dto: CreateProductRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ProductResponseDto }> {
    return ok(await this.productService.create(dto, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail incl. its SKUs' })
  @ApiOkEnvelope(ProductDetailDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: ProductDetailDto }> {
    return ok(await this.productService.getDetail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update product fields (code read-only after creation)' })
  @ApiOkEnvelope(ProductResponseDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ProductResponseDto }> {
    return ok(await this.productService.update(id, dto, operator));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a product with zero references (else PRODUCT_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async remove(
    @Param('id') id: string,
    @Query('force') force: string | undefined,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    // force=true cascades the product's SKUs and their master-data children
    // (decision 0008); SKUs with business history still refuse.
    if (force === 'true' || force === '1') {
      await this.productService.forceRemove(id, operator);
    } else {
      await this.productService.remove(id, operator);
    }
    return ok({});
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a product' })
  @ApiOkEnvelope(ProductResponseDto)
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ProductResponseDto }> {
    return ok(await this.productService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a product (no hard delete once referenced)' })
  @ApiOkEnvelope(ProductResponseDto)
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ProductResponseDto }> {
    return ok(await this.productService.setStatus(id, 'INACTIVE', operator));
  }
}
