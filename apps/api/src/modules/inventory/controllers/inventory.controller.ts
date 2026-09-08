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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageMeta } from '@wcies/shared';
import { ok, okPage } from '../../../common/dto/api-response';
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

// Envelope shapes for truthful OpenAPI output types (Sprint 0 §11).
class InventoryListEnvelopeDto {
  success!: true;
  data!: InventoryRowDto[];
  meta!: PageMeta;
}
class SkuInventoryEnvelopeDto {
  success!: true;
  data!: SkuInventoryDetailDto;
}
class StockChangeEnvelopeDto {
  success!: true;
  data!: StockChangeResultDto;
}
class MoveBinEnvelopeDto {
  success!: true;
  data!: MoveBinResultDto;
}
class TransactionListEnvelopeDto {
  success!: true;
  data!: TransactionDto[];
  meta!: PageMeta;
}
class ReservationListEnvelopeDto {
  success!: true;
  data!: ReservationListItemDto[];
  meta!: PageMeta;
}
class ReservationEnvelopeDto {
  success!: true;
  data!: ReservationDto;
}
class SafetyStockListEnvelopeDto {
  success!: true;
  data!: SafetyStockDto[];
  meta!: PageMeta;
}
class SafetyStockEnvelopeDto {
  success!: true;
  data!: SafetyStockDto;
}

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
  @ApiOkResponse({ type: InventoryListEnvelopeDto })
  async list(@Query() query: InventoryListQueryDto): Promise<InventoryListEnvelopeDto> {
    const { items, meta } = await this.queryService.listBalances(
      {
        keyword: query.keyword?.trim() || undefined,
        skuId: query.skuId,
        warehouseId: query.warehouseId,
        binId: query.binId,
        condition: query.condition,
        status: query.status,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(items, meta);
  }

  @Get('inventory/skus/:skuId')
  @ApiOperation({ summary: 'SKU inventory drilldown: totals -> warehouses -> bins' })
  @ApiOkResponse({ type: SkuInventoryEnvelopeDto })
  async getSkuInventory(@Param('skuId') skuId: string): Promise<SkuInventoryEnvelopeDto> {
    return ok(await this.queryService.getSkuInventory(skuId));
  }

  @Get('inventory/transactions')
  @ApiOperation({ summary: 'Inventory transaction ledger (audit)' })
  @ApiOkResponse({ type: TransactionListEnvelopeDto })
  async listTransactions(
    @Query() query: TransactionListQueryDto,
  ): Promise<TransactionListEnvelopeDto> {
    const { items, meta } = await this.queryService.listTransactions(
      {
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
  @ApiOkResponse({ type: StockChangeEnvelopeDto })
  async initialize(
    @Body() dto: InitializeStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StockChangeEnvelopeDto> {
    return ok(
      await this.inventoryService.initializeStock({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        binId: dto.binId ?? null,
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

  @Post('inventory/receive')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Receive stock (future purchase-receipt primitive)' })
  @ApiOkResponse({ type: StockChangeEnvelopeDto })
  async receive(
    @Body() dto: ReceiveStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StockChangeEnvelopeDto> {
    return ok(
      await this.inventoryService.receiveStock({
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        binId: dto.binId ?? null,
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

  @Post('inventory/adjust')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Manual stock adjustment (+N / -N with reason)' })
  @ApiOkResponse({ type: StockChangeEnvelopeDto })
  async adjust(
    @Body() dto: AdjustStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<StockChangeEnvelopeDto> {
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
  @ApiOkResponse({ type: MoveBinEnvelopeDto })
  async moveBin(
    @Body() dto: MoveBinRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MoveBinEnvelopeDto> {
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
  @ApiOkResponse({ type: ReservationEnvelopeDto })
  async create(
    @Body() dto: ReserveStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReservationEnvelopeDto> {
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

  @Get('inventory/reservations')
  @ApiOperation({ summary: 'List reservations' })
  @ApiOkResponse({ type: ReservationListEnvelopeDto })
  async list(@Query() query: ReservationListQueryDto): Promise<ReservationListEnvelopeDto> {
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
  @ApiOkResponse({ type: ReservationEnvelopeDto })
  async getById(@Param('id') id: string): Promise<ReservationEnvelopeDto> {
    return ok(await this.queryService.getReservation(id));
  }

  @Post('inventory/reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release an ACTIVE reservation (Reserved -N)' })
  @ApiOkResponse({ type: ReservationEnvelopeDto })
  async release(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReservationEnvelopeDto> {
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
  @ApiOkResponse({ type: ReservationEnvelopeDto })
  async pick(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReservationEnvelopeDto> {
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
  @ApiOkResponse({ type: ReservationEnvelopeDto })
  async unpick(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReservationEnvelopeDto> {
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
  @ApiOkResponse({ type: ReservationEnvelopeDto })
  async ship(
    @Param('id') id: string,
    @Body() dto: ReservationLifecycleRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReservationEnvelopeDto> {
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
  @ApiOkResponse({ type: SafetyStockListEnvelopeDto })
  async list(@Query() query: SafetyStockListQueryDto): Promise<SafetyStockListEnvelopeDto> {
    const { items, meta } = await this.safetyStockService.list(
      { skuId: query.skuId, warehouseId: query.warehouseId },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(items, meta);
  }

  @Put('inventory/safety-stocks/:skuId/:warehouseId')
  @ApiOperation({ summary: 'Set/update safety stock of a SKU in a warehouse (policy only)' })
  @ApiOkResponse({ type: SafetyStockEnvelopeDto })
  async upsert(
    @Param('skuId') skuId: string,
    @Param('warehouseId') warehouseId: string,
    @Body() dto: UpsertSafetyStockRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SafetyStockEnvelopeDto> {
    return ok(await this.safetyStockService.upsert(skuId, warehouseId, dto.safetyQty, operator));
  }
}
