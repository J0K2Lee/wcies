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
  CreateSupplierRequestDto,
  SupplierListItemDto,
  SupplierListQueryDto,
  SupplierResponseDto,
  UpdateSupplierRequestDto,
} from '../dto/supplier.dto';
import { SupplierService } from '../services/supplier.service';

@ApiTags('suppliers')
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  @ApiOperation({ summary: 'List suppliers (paged + reference counts)' })
  @ApiOkPagedEnvelope(SupplierListItemDto)
  async list(
    @Query() query: SupplierListQueryDto,
  ): Promise<{ success: true; data: SupplierListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.supplierService.list(query);
    return okPage(items, meta);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a supplier (code auto-generated when omitted)' })
  @ApiOkEnvelope(SupplierResponseDto)
  async create(
    @Body() dto: CreateSupplierRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SupplierResponseDto }> {
    return ok(await this.supplierService.create(dto, operator));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier detail' })
  @ApiOkEnvelope(SupplierResponseDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: SupplierResponseDto }> {
    return ok(await this.supplierService.getById(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update supplier fields (code immutable)' })
  @ApiOkEnvelope(SupplierResponseDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SupplierResponseDto }> {
    return ok(await this.supplierService.update(id, dto, operator));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a supplier' })
  @ApiOkEnvelope(SupplierResponseDto)
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SupplierResponseDto }> {
    return ok(await this.supplierService.setStatus(id, 'ACTIVE', operator));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a supplier' })
  @ApiOkEnvelope(SupplierResponseDto)
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SupplierResponseDto }> {
    return ok(await this.supplierService.setStatus(id, 'INACTIVE', operator));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a supplier with zero references (else SUPPLIER_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async remove(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.supplierService.remove(id, operator);
    return ok({});
  }
}
