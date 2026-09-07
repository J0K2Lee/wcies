import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../../../common/dto/api-response';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  BrandResponseDto,
  CategoryResponseDto,
  CategoryTreeItemDto,
  CreateBrandRequestDto,
  CreateCategoryRequestDto,
  UpdateBrandRequestDto,
  UpdateCategoryRequestDto,
} from '../dto/catalog.dto';
import { CatalogService } from '../catalog.service';

class BrandListEnvelopeDto {
  success!: true;
  data!: BrandResponseDto[];
}

class BrandEnvelopeDto {
  success!: true;
  data!: BrandResponseDto;
}

class CategoryTreeEnvelopeDto {
  success!: true;
  data!: CategoryTreeItemDto[];
}

class CategoryEnvelopeDto {
  success!: true;
  data!: CategoryResponseDto;
}

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---- Brands ----

  @Get('brands')
  @ApiOperation({ summary: 'List brands (filterable by keyword)' })
  @ApiOkResponse({ type: BrandListEnvelopeDto })
  async listBrands(@Query('keyword') keyword?: string): Promise<BrandListEnvelopeDto> {
    return ok(await this.catalogService.listBrands(keyword));
  }

  @Post('brands')
  @ApiOperation({ summary: 'Create a brand' })
  @ApiOkResponse({ type: BrandEnvelopeDto })
  async createBrand(
    @Body() dto: CreateBrandRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<BrandEnvelopeDto> {
    return ok(await this.catalogService.createBrand(dto, operator));
  }

  @Patch('brands/:id')
  @ApiOperation({ summary: 'Update a brand' })
  @ApiOkResponse({ type: BrandEnvelopeDto })
  async updateBrand(
    @Param('id') id: string,
    @Body() dto: UpdateBrandRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<BrandEnvelopeDto> {
    return ok(await this.catalogService.updateBrand(id, dto, operator));
  }

  // ---- Categories ----

  @Get('categories')
  @ApiOperation({ summary: 'List the category tree' })
  @ApiOkResponse({ type: CategoryTreeEnvelopeDto })
  async listCategoryTree(): Promise<CategoryTreeEnvelopeDto> {
    return ok(await this.catalogService.listCategoryTree());
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a category (tree node)' })
  @ApiOkResponse({ type: CategoryEnvelopeDto })
  async createCategory(
    @Body() dto: CreateCategoryRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CategoryEnvelopeDto> {
    return ok(await this.catalogService.createCategory(dto, operator));
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category (cycle-safe parent changes)' })
  @ApiOkResponse({ type: CategoryEnvelopeDto })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<CategoryEnvelopeDto> {
    return ok(await this.catalogService.updateCategory(id, dto, operator));
  }
}
