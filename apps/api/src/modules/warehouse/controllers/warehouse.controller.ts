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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  BatchCreateBinsRequestDto,
  BatchCreateBinsResponseDto,
  BinListQueryDto,
  BinResponseDto,
  BindingListQueryDto,
  BindingResponseDto,
  CreateBindingRequestDto,
  CreateBinRequestDto,
  CreateWarehouseRequestDto,
  UpdateBindingRequestDto,
  UpdateBinRequestDto,
  UpdateWarehouseRequestDto,
  WarehouseListItemDto,
  WarehouseListQueryDto,
  WarehouseResponseDto,
} from '../dto/warehouse.dto';
import { WarehouseService } from '../services/warehouse.service';
import { WarehouseBinService } from '../services/warehouse-bin.service';
import { StoreWarehouseBindingService } from '../services/store-warehouse-binding.service';

@ApiTags('warehouses')
@Controller()
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('warehouses')
  @ApiOperation({ summary: 'List warehouses (with bin + bound store counts)' })
  @ApiOkPagedEnvelope(WarehouseListItemDto)
  async list(
    @Query() query: WarehouseListQueryDto,
  ): Promise<{ success: true; data: WarehouseListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.warehouseService.list(query);
    return okPage(items, meta);
  }

  @Post('warehouses')
  @ApiOperation({ summary: 'Create a warehouse' })
  @ApiOkEnvelope(WarehouseResponseDto)
  async create(
    @Body() dto: CreateWarehouseRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: WarehouseResponseDto }> {
    return ok(await this.warehouseService.create(dto, operator));
  }

  @Get('warehouses/:id')
  @ApiOperation({ summary: 'Get warehouse detail' })
  @ApiOkEnvelope(WarehouseResponseDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: WarehouseResponseDto }> {
    return ok(await this.warehouseService.getById(id));
  }

  @Patch('warehouses/:id')
  @ApiOperation({ summary: 'Update warehouse fields' })
  @ApiOkEnvelope(WarehouseResponseDto)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: WarehouseResponseDto }> {
    return ok(await this.warehouseService.update(id, dto, operator));
  }

  @Post('warehouses/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a warehouse' })
  @ApiOkEnvelope(WarehouseResponseDto)
  async activate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: WarehouseResponseDto }> {
    return ok(await this.warehouseService.setStatus(id, 'ACTIVE', operator));
  }

  @Post('warehouses/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a warehouse (no hard delete)' })
  @ApiOkEnvelope(WarehouseResponseDto)
  async deactivate(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: WarehouseResponseDto }> {
    return ok(await this.warehouseService.setStatus(id, 'INACTIVE', operator));
  }
}

@ApiTags('warehouse-bins')
@Controller()
export class WarehouseBinController {
  constructor(private readonly binService: WarehouseBinService) {}

  @Get('warehouses/:warehouseId/bins')
  @ApiOperation({ summary: 'List bins of a warehouse (paged)' })
  @ApiOkPagedEnvelope(BinResponseDto)
  async list(
    @Param('warehouseId') warehouseId: string,
    @Query() query: BinListQueryDto,
  ): Promise<{ success: true; data: BinResponseDto[]; meta: PageMeta }> {
    const { items, meta } = await this.binService.list(warehouseId, query);
    return okPage(items, meta);
  }

  @Post('warehouses/:warehouseId/bins')
  @ApiOperation({ summary: 'Create a single bin' })
  @ApiOkEnvelope(BinResponseDto)
  async create(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreateBinRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BinResponseDto }> {
    return ok(await this.binService.create(warehouseId, dto, operator));
  }

  @Post('warehouses/:warehouseId/bins/batch')
  @ApiOperation({ summary: 'Batch-create bins (rack A01~A05 x level 01~04)' })
  @ApiOkEnvelope(BatchCreateBinsResponseDto)
  async batchCreate(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: BatchCreateBinsRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BatchCreateBinsResponseDto }> {
    return ok(await this.binService.batchCreate(warehouseId, dto, operator));
  }

  @Patch('warehouses/:warehouseId/bins/:binId')
  @ApiOperation({ summary: 'Update a bin' })
  @ApiOkEnvelope(BinResponseDto)
  async update(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @Body() dto: UpdateBinRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BinResponseDto }> {
    return ok(await this.binService.update(warehouseId, binId, dto, operator));
  }

  @Post('warehouses/:warehouseId/bins/:binId/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a bin' })
  @ApiOkEnvelope(BinResponseDto)
  async disable(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BinResponseDto }> {
    return ok(await this.binService.setStatus(warehouseId, binId, 'INACTIVE', operator));
  }

  @Post('warehouses/:warehouseId/bins/:binId/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable a bin' })
  @ApiOkEnvelope(BinResponseDto)
  async enable(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BinResponseDto }> {
    return ok(await this.binService.setStatus(warehouseId, binId, 'ACTIVE', operator));
  }
}

@ApiTags('store-warehouse-bindings')
@Controller()
export class StoreWarehouseBindingController {
  constructor(private readonly bindingService: StoreWarehouseBindingService) {}

  @Get('warehouse-bindings')
  @ApiOperation({ summary: 'List bindings across stores (paged, filterable)' })
  @ApiOkPagedEnvelope(BindingResponseDto)
  async list(
    @Query() query: BindingListQueryDto,
  ): Promise<{ success: true; data: BindingResponseDto[]; meta: PageMeta }> {
    const { items, meta } = await this.bindingService.list(query);
    return okPage(items, meta);
  }

  @Get('stores/:storeId/warehouse-bindings')
  @ApiOperation({ summary: 'List bindings of a store' })
  @ApiOkPagedEnvelope(BindingResponseDto)
  async listByStore(
    @Param('storeId') storeId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<{ success: true; data: BindingResponseDto[]; meta: PageMeta }> {
    const { items, meta } = await this.bindingService.listByStore(storeId, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage(items, meta);
  }

  @Post('stores/:storeId/warehouse-bindings')
  @ApiOperation({ summary: 'Bind a warehouse to a store with a fulfillment mode' })
  @ApiOkEnvelope(BindingResponseDto)
  async create(
    @Param('storeId') storeId: string,
    @Body() dto: CreateBindingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BindingResponseDto }> {
    return ok(await this.bindingService.create(storeId, dto, operator));
  }

  @Patch('stores/:storeId/warehouse-bindings/:id')
  @ApiOperation({ summary: 'Update a binding' })
  @ApiOkEnvelope(BindingResponseDto)
  async update(
    @Param('storeId') storeId: string,
    @Param('id') bindingId: string,
    @Body() dto: UpdateBindingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BindingResponseDto }> {
    return ok(await this.bindingService.update(storeId, bindingId, dto, operator));
  }

  @Post('stores/:storeId/warehouse-bindings/:id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a binding' })
  @ApiOkEnvelope(BindingResponseDto)
  async disable(
    @Param('storeId') storeId: string,
    @Param('id') bindingId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BindingResponseDto }> {
    return ok(await this.bindingService.setStatus(storeId, bindingId, 'DISABLED', operator));
  }

  @Post('stores/:storeId/warehouse-bindings/:id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable a binding' })
  @ApiOkEnvelope(BindingResponseDto)
  async enable(
    @Param('storeId') storeId: string,
    @Param('id') bindingId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: BindingResponseDto }> {
    return ok(await this.bindingService.setStatus(storeId, bindingId, 'ACTIVE', operator));
  }
}
