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
import {
  ApiOkEnvelope,
  ApiOkNoDataEnvelope,
  ApiOkPagedEnvelope,
} from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import {
  BatchCreateBinsRequestDto,
  BatchCreateBinsResponseDto,
  BinListQueryDto,
  BinResponseDto,
  CreateBinRequestDto,
  CreatePlatformBindingRequestDto,
  CreateWarehouseRequestDto,
  PlatformBindingListQueryDto,
  PlatformBindingResponseDto,
  UpdateBinRequestDto,
  UpdateWarehouseRequestDto,
  WarehouseListItemDto,
  WarehouseListQueryDto,
  WarehouseResponseDto,
} from '../dto/warehouse.dto';
import { WarehouseService } from '../services/warehouse.service';
import { WarehouseBinService } from '../services/warehouse-bin.service';
import { WarehousePlatformBindingService } from '../services/warehouse-platform-binding.service';

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

  @Delete('warehouses/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a warehouse with zero references (else WAREHOUSE_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async remove(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.warehouseService.remove(id, operator);
    return ok({});
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

  @Get('warehouses/:warehouseId/bins/zones')
  @ApiOperation({ summary: 'Distinct zones present in a warehouse' })
  // Inline schema: a bare `string[]` via ApiOkArrayEnvelope(String) would
  // register a properties-less "String" schema and fail check:openapi.
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: { type: 'array', items: { type: 'string' }, example: ['A', 'B'] },
      },
    },
  })
  async zones(
    @Param('warehouseId') warehouseId: string,
  ): Promise<{ success: true; data: string[] }> {
    return ok(await this.binService.listZones(warehouseId));
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

  @Delete('warehouses/:warehouseId/bins/:binId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a bin with zero references (else BIN_IN_USE)' })
  @ApiOkNoDataEnvelope()
  async removeBin(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.binService.remove(warehouseId, binId, operator);
    return ok({});
  }
}

@ApiTags('warehouse-platform-bindings')
@Controller()
export class WarehousePlatformBindingController {
  constructor(private readonly bindingService: WarehousePlatformBindingService) {}

  @Get('warehouses/:warehouseId/platform-bindings')
  @ApiOperation({ summary: '列出仓库已绑定的平台仓库（分页）' })
  @ApiOkPagedEnvelope(PlatformBindingResponseDto)
  async list(
    @Param('warehouseId') warehouseId: string,
    @Query() query: PlatformBindingListQueryDto,
  ): Promise<{ success: true; data: PlatformBindingResponseDto[]; meta: PageMeta }> {
    const { items, meta } = await this.bindingService.list({
      warehouseId,
      storeId: query.storeId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage(items, meta);
  }

  @Get('stores/:storeId/platform-bindings')
  @ApiOperation({ summary: '列出店铺关联的平台仓库绑定（跨仓库，分页）' })
  @ApiOkPagedEnvelope(PlatformBindingResponseDto)
  async listByStore(
    @Param('storeId') storeId: string,
    @Query() query: PlatformBindingListQueryDto,
  ): Promise<{ success: true; data: PlatformBindingResponseDto[]; meta: PageMeta }> {
    const { items, meta } = await this.bindingService.list({
      storeId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage(items, meta);
  }

  @Post('warehouses/:warehouseId/platform-bindings')
  @ApiOperation({ summary: '绑定平台仓库到内部仓库（校验类型↔履约模式、托管仓单绑定）' })
  @ApiOkEnvelope(PlatformBindingResponseDto)
  async create(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreatePlatformBindingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: PlatformBindingResponseDto }> {
    return ok(await this.bindingService.create(warehouseId, dto, operator));
  }

  @Delete('warehouses/:warehouseId/platform-bindings/:bindingId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解除平台仓库绑定' })
  @ApiOkNoDataEnvelope()
  async remove(
    @Param('warehouseId') warehouseId: string,
    @Param('bindingId') bindingId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true }> {
    await this.bindingService.remove(warehouseId, bindingId, operator);
    return ok({});
  }
}
