import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { InventoryService } from '../services/inventory.service';
import { InventoryAdjustmentService } from '../services/inventory-adjustment.service';
import { InventoryMovementService } from '../services/inventory-movement.service';
import { InventoryQueryService } from '../services/inventory-query.service';
import { ReservationService } from '../services/reservation.service';
import { InventorySafetyStockService } from '../services/inventory-safety-stock.service';
import {
  AdjustStockRequestDto,
  InitializeStockRequestDto,
  InventoryListQueryDto,
  InventoryRowDto,
  MoveBinRequestDto,
  MoveBinResultDto,
  ReceiveStockRequestDto,
  ReservationDto,
  ReservationLifecycleRequestDto,
  ReservationListItemDto,
  ReservationListQueryDto,
  ReserveStockRequestDto,
  SafetyStockDto,
  SafetyStockListQueryDto,
  SkuInventoryDetailDto,
  StockChangeResultDto,
  TransactionDto,
  TransactionListQueryDto,
  UpsertSafetyStockRequestDto,
} from '../dto/inventory.dto';
import { ReplenishmentSuggestionDto } from '../dto/replenishment.dto';

/**
 * Inventory core HTTP API (task §41-§45): read models are authenticated;
 * initialize / receive / adjust are admin-only (task §38/§45). Reservation
 * lifecycle actions are authenticated warehouse operations.
 */
@ApiTags('inventory')
@Controller()
export class InventoryController {
  constructor(
    private readonly queryService: InventoryQueryService,
    private readonly inventoryService: InventoryService,
    private readonly adjustmentService: InventoryAdjustmentService,
    private readonly movementService: InventoryMovementService,
  ) {}

  @Get('inventory')
  @ApiOperation({ summary: 'List inventory balances with derived availability' })
  @ApiOkPagedEnvelope(InventoryRowDto)
  async list(
    @Query() query: InventoryListQueryDto,
  ): Promise<{ success: true; data: InventoryRowDto[]; meta: PageMeta }> {
    const { items, meta } = await this.queryService.listBalances(
      {
        keyword: query.keyword?.trim() || undefined,
        skuId: query.skuId,
        warehouseId: query.warehouseId,
        binId: query.binId,
        condition: query.condition,
        status: query.status,
        includeEmpty: query.includeEmpty === 'true',
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(items, meta);
  }

  @Get('inventory/skus/:skuId')
  @ApiOperation({ summary: 'SKU inventory drilldown: totals -> warehouses -> bins' })
  @ApiOkEnvelope(SkuInventoryDetailDto)
  async getSkuInventory(
    @Param('skuId') skuId: string,
  ): Promise<{ success: true; data: SkuInventoryDetailDto }> {
    return ok(await this.queryService.getSkuInventory(skuId));
  }

  @Get('inventory/transactions')
  @ApiOperation({ summary: 'Inventory transaction ledger (audit)' })
  @ApiOkPagedEnvelope(TransactionDto)
  async listTransactions(
    @Query() query: TransactionListQueryDto,
  ): Promise<{ success: true; data: TransactionDto[]; meta: PageMeta }> {
    const { items, meta } = await this.queryService.listTransactions(
      {
        keyword: query.keyword?.trim() || undefined,
        skuId: query.skuId,
        warehouseId: query.warehouseId,
        binId: query.binId,
        transactionType: query.transactionType,
        referenceType: query.referenceType,
        referenceId: query.referenceId,
        createdFrom: query.createdFrom,
        createdTo: query.createdTo,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(items, meta);
  }

  @Post('inventory/initialize')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Initialize stock (first go-live import only)' })
  @ApiOkEnvelope(StockChangeResultDto)
  async initialize(
    @Body() dto: InitializeStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StockChangeResultDto }> {
    return ok(
      await this.inventoryService.initializeStock({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        binId: dto.binId ?? null,
        condition: dto.condition ?? 'SELLABLE',
        quantity: dto.quantity,
        serialNumbers: dto.serialNumbers,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        remark: dto.remark ?? null,
        idempotencyKey: dto.idempotencyKey,
        operator,
      }),
    );
  }

  @Post('inventory/receive')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Receive stock (future purchase-receipt primitive)' })
  @ApiOkEnvelope(StockChangeResultDto)
  async receive(
    @Body() dto: ReceiveStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StockChangeResultDto }> {
    return ok(
      await this.inventoryService.receiveStock({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        binId: dto.binId ?? null,
        condition: dto.condition ?? 'SELLABLE',
        quantity: dto.quantity,
        serialNumbers: dto.serialNumbers,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        remark: dto.remark ?? null,
        idempotencyKey: dto.idempotencyKey,
        operator,
      }),
    );
  }

  @Post('inventory/adjust')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Manual stock adjustment (+N / -N with reason)' })
  @ApiOkEnvelope(StockChangeResultDto)
  async adjust(
    @Body() dto: AdjustStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: StockChangeResultDto }> {
    return ok(
      await this.adjustmentService.adjustStock({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        binId: dto.binId,
        condition: dto.condition ?? 'SELLABLE',
        quantityDelta: dto.quantityDelta,
        reason: dto.reason,
        remark: dto.remark ?? null,
        idempotencyKey: dto.idempotencyKey,
        operator,
      }),
    );
  }

  @Post('inventory/move-bin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move stock between bins of one warehouse (single event, two lines)' })
  @ApiOkEnvelope(MoveBinResultDto)
  async moveBin(
    @Body() dto: MoveBinRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: MoveBinResultDto }> {
    return ok(
      await this.movementService.moveBin({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        fromBinId: dto.fromBinId,
        toBinId: dto.toBinId,
        condition: dto.condition ?? 'SELLABLE',
        quantity: dto.quantity,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        remark: dto.remark ?? null,
        idempotencyKey: dto.idempotencyKey,
        operator,
      }),
    );
  }
}

@ApiTags('inventory-reservations')
@Controller()
export class InventoryReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly queryService: InventoryQueryService,
  ) {}

  @Post('inventory/reservations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reserve stock (multi-bin allocation, idempotent)' })
  @ApiOkEnvelope(ReservationDto)
  async create(
    @Body() dto: ReserveStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ReservationDto }> {
    return ok(
      await this.reservationService.reserveStock({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        idempotencyKey: dto.idempotencyKey,
        remark: dto.remark ?? null,
        operator,
      }),
    );
  }

  @Get('inventory/replenishment-suggestions')
  @ApiOperation({
    summary: '补货建议（派生建议：销速/安全库存/在途采购 → 建议采购量）',
  })
  @ApiOkPagedEnvelope(ReplenishmentSuggestionDto)
  async replenishmentSuggestions(
    @Query()
    query: {
      windowDays?: string;
      coverDays?: string;
      onlyAlert?: string;
      keyword?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const result = await this.queryService.listReplenishmentSuggestions({
      windowDays: clampDays(query.windowDays, 30, 1, 365),
      coverDays: clampDays(query.coverDays, 14, 0, 365),
      onlyAlert: query.onlyAlert === 'true',
      keyword: query.keyword,
      page: clampInt(query.page, 1, 1, 100000),
      pageSize: clampInt(query.pageSize, 50, 1, 100),
    });
    return okPage(result.items, result.meta);
  }

  @Get('inventory/reservations')
  @ApiOperation({ summary: 'List reservations' })
  @ApiOkPagedEnvelope(ReservationListItemDto)
  async list(
    @Query() query: ReservationListQueryDto,
  ): Promise<{ success: true; data: ReservationListItemDto[]; meta: PageMeta }> {
    const { items, meta } = await this.queryService.listReservations(
      {
        skuId: query.skuId,
        warehouseId: query.warehouseId,
        status: query.status,
        referenceType: query.referenceType,
        referenceId: query.referenceId,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(items, meta);
  }

  @Get('inventory/reservations/:id')
  @ApiOperation({ summary: 'Reservation detail with per-bin lines' })
  @ApiOkEnvelope(ReservationDto)
  async getById(@Param('id') id: string): Promise<{ success: true; data: ReservationDto }> {
    return ok(await this.queryService.getReservation(id));
  }

  @Post('inventory/reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release an ACTIVE reservation (Reserved -N)' })
  @ApiOkEnvelope(ReservationDto)
  async release(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ReservationDto }> {
    return ok(
      await this.reservationService.releaseReservation(id, {
        operator,
        idempotencyKey: dto.idempotencyKey,
        remark: dto.remark ?? null,
      }),
    );
  }

  @Post('inventory/reservations/:id/pick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pick a full ACTIVE reservation (Reserved -N, Picked +N)' })
  @ApiOkEnvelope(ReservationDto)
  async pick(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ReservationDto }> {
    return ok(
      await this.reservationService.pickStock(id, {
        operator,
        idempotencyKey: dto.idempotencyKey,
        remark: dto.remark ?? null,
      }),
    );
  }

  @Post('inventory/reservations/:id/unpick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Undo a pick (PICKED -> ACTIVE; pick-correction only)' })
  @ApiOkEnvelope(ReservationDto)
  async unpick(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ReservationDto }> {
    return ok(
      await this.reservationService.unpickStock(id, {
        operator,
        idempotencyKey: dto.idempotencyKey,
        remark: dto.remark ?? null,
      }),
    );
  }

  @Post('inventory/reservations/:id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ship a PICKED reservation (Picked -N, On Hand -N)' })
  @ApiOkEnvelope(ReservationDto)
  async ship(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: ReservationDto }> {
    return ok(
      await this.reservationService.shipStock(id, {
        operator,
        idempotencyKey: dto.idempotencyKey,
        remark: dto.remark ?? null,
      }),
    );
  }
}

@ApiTags('inventory-safety-stocks')
@Controller()
export class InventorySafetyStockController {
  constructor(private readonly safetyStockService: InventorySafetyStockService) {}

  @Get('inventory/safety-stocks')
  @ApiOperation({ summary: 'List safety stock policies' })
  @ApiOkPagedEnvelope(SafetyStockDto)
  async list(
    @Query() query: SafetyStockListQueryDto,
  ): Promise<{ success: true; data: SafetyStockDto[]; meta: PageMeta }> {
    const { items, meta } = await this.safetyStockService.list(
      { skuId: query.skuId, warehouseId: query.warehouseId },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(items, meta);
  }

  @Put('inventory/safety-stocks/:skuId/:warehouseId')
  @ApiOperation({ summary: 'Set/update safety stock of a SKU in a warehouse (policy only)' })
  @ApiOkEnvelope(SafetyStockDto)
  async upsert(
    @Param('skuId') skuId: string,
    @Param('warehouseId') warehouseId: string,
    @Body() dto: UpsertSafetyStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: SafetyStockDto }> {
    return ok(await this.safetyStockService.upsert(skuId, warehouseId, dto.safetyQty, operator));
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function clampDays(raw: string | undefined, fallback: number, min: number, max: number): number {
  return clampInt(raw, fallback, min, max);
}
