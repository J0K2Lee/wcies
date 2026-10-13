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
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkNoDataEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  BrandResponseDto,
  CategoryResponseDto,
  CategoryTreeItemDto,
  CategoryTreeLiteItemDto,
  CreateBrandRequestDto,
  CreateCategoryRequestDto,
  UpdateBrandRequestDto,
  UpdateCategoryRequestDto,
} from '../dto/catalog.dto';
import { CatalogService } from '../catalog.service';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---- Brands ----

  @Get('brands')
  @ApiOperation({ summary: 'List brands (filterable by keyword)' })
  @ApiOkEnvelope(BrandResponseDto)
  async listBrands(
    @Query('keyword') keyword?: string,
  ): Promise<{ success: true; data: BrandResponseDto[] }> {
    return ok(await this.catalogService.listBrands(keyword));
  }

  @Post('brands')
  @ApiOperation({ summary: 'Create a brand' })
  @ApiOkEnvelope(BrandResponseDto)
  async createBrand(
    @Body() dto: CreateBrandRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BrandResponseDto }> {
    return ok(await this.catalogService.createBrand(dto, operator));
  }

  @Patch('brands/:id')
  @ApiOperation({ summary: 'Update a brand' })
  @ApiOkEnvelope(BrandResponseDto)
  async updateBrand(
    @Param('id') id: string,
    @Body() dto: UpdateBrandRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BrandResponseDto }> {
    return ok(await this.catalogService.updateBrand(id, dto, operator));
  }

  @Delete('brands/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a brand with zero references (else BRAND_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async removeBrand(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.catalogService.removeBrand(id, operator);
    return ok({});
  }

  // ---- Categories ----

  @Get('categories')
  @ApiOperation({ summary: 'List the category tree' })
  @ApiOkEnvelope(CategoryTreeItemDto)
  async listCategoryTree(): Promise<{ success: true; data: CategoryTreeItemDto[] }> {
    return ok(await this.catalogService.listCategoryTree());
  }

  @Get('categories/tree-lite')
  @ApiOperation({
    summary: 'List the category tree without entity bookkeeping columns (8k-node pickers)',
  })
  @ApiOkEnvelope(CategoryTreeLiteItemDto)
  async listCategoryTreeLite(): Promise<{ success: true; data: CategoryTreeLiteItemDto[] }> {
    return ok(await this.catalogService.listCategoryTreeLite());
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a category (tree node)' })
  @ApiOkEnvelope(CategoryResponseDto)
  async createCategory(
    @Body() dto: CreateCategoryRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CategoryResponseDto }> {
    return ok(await this.catalogService.createCategory(dto, operator));
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category (cycle-safe parent changes)' })
  @ApiOkEnvelope(CategoryResponseDto)
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: CategoryResponseDto }> {
    return ok(await this.catalogService.updateCategory(id, dto, operator));
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete a category with zero references (children -> CATEGORY_HAS_CHILDREN, skus -> CATEGORY_IN_USE)',
  })
  @ApiOkNoDataEnvelope()
  async removeCategory(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.catalogService.removeCategory(id, operator);
    return ok({});
  }
}
