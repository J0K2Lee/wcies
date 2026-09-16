import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { formatQty, parseQty, qtyFromDb } from '../../../common/utils/quantity';
import { InventoryBalanceEntity } from '../entities/inventory-balance.entity';
import {
  InventoryCondition,
  InventoryEventType,
  InventoryReferenceType,
} from '../enums/inventory.constants';
import {
  IdempotencyConflictError,
  InsufficientMovableStockError,
  InsufficientStockError,
  InventoryQuantityInvalidError,
  InventorySerialInvalidError,
} from '../errors/inventory.errors';
import {
  InventoryBalanceRepository,
  isUniqueViolation,
} from '../repositories/inventory-balance.repository';
import { InventoryTransactionRepository } from '../repositories/inventory-transaction.repository';
import { InventorySerialRepository } from '../repositories/inventory-serial.repository';
import {
  assertBalanceInvariants,
  nextVersionOf,
  resolveDimension,
  DimensionDeps,
  ResolvedDimension,
} from './inventory-dimension';
import { SkuNotFoundError } from '../../product/errors/sku-errors';

export interface AddStockInput {
  skuId: string;
  warehouseId: string;
  /** Optional only when the warehouse has no bins yet (virtual DEFAULT bin, task §6). */
  binId?: string | null;
  condition: InventoryCondition;
  quantity: string;
  referenceType: InventoryReferenceType;
  referenceId: string;
  remark?: string | null;
  idempotencyKey: string;
  operator: OperatorContext;
  /**
   * Serial numbers of the received units (Sprint 3 task §44). REQUIRED for
   * serial-tracked SKUs (count must equal the quantity, integer units only);
   * FORBIDDEN otherwise.
   */
  serialNumbers?: string[];
}

export interface BalanceSnapshot {
  balanceId: string;
  skuId: string;
  warehouseId: string;
  binId: string;
  condition: InventoryCondition;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
}

export interface StockChangeResult {
  eventNo: string;
  transactionNos: string[];
  balance: BalanceSnapshot;
  /** True when the idempotency key replayed an earlier execution (task §22). */
  idempotentReplay: boolean;
}

/**
 * Stock additions (task §20-§22): initializeStock for first-time go-live
 * imports, receiveStock as the future purchase-receipt primitive. Both go
 * through the same locked-balance path - nothing ever writes balances
 * directly (AGENTS.md §10).
 */
/** Shape shared between the in-tx patch and the post-commit result. */
export interface BalanceQuantities {
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
  version: string;
}

/** Pre-transaction validation outcome shared by both receive paths. */
interface ValidatedAddStock {
  qty: bigint;
  dim: ResolvedDimension;
  serialNumbers: string[];
}

@Injectable()
export class InventoryService {
  private readonly deps: DimensionDeps;

  constructor(
    private readonly dataSource: DataSource,
    private readonly balanceRepo: InventoryBalanceRepository,
    private readonly ledgerRepo: InventoryTransactionRepository,
    private readonly serialRepo: InventorySerialRepository,
    skuService: SkuService,
    warehouseService: WarehouseService,
    binService: WarehouseBinService,
    private readonly operationLog: OperationLogService,
  ) {
    this.deps = { skuService, warehouseService, binService };
  }

  async initializeStock(input: AddStockInput): Promise<StockChangeResult> {
    return this.addStock(input, 'INITIAL_STOCK');
  }

  async receiveStock(input: AddStockInput): Promise<StockChangeResult> {
    return this.addStock(input, 'RECEIVE');
  }

  /**
   * Transaction-aware receive (Sprint 7 task T4.2, decision 0013 par5):
   * runs the SAME locked-balance path on the CALLER's QueryRunner so the
   * purchase-receipt business command (N receive lines + PO accumulators +
   * status patches) commits or rolls back as ONE database transaction -
   * exactly the pickStockPartialInTx pattern from Sprint 4. Inventory still
   * owns every stock rule; the caller only owns the transaction boundary,
   * and records the operation log after ITS commit.
   */
  async receiveStockInTx(
    runner: QueryRunner,
    input: AddStockInput,
  ): Promise<StockChangeResult & { wrote: boolean }> {
    const prevalidated = await this.validateAddStock(input);
    return this.addStockInTx(runner, input, 'RECEIVE', prevalidated);
  }

  /**
   * Transfer IN leg (Sprint 10, transfer.md §5): the same locked-balance
   * addition path as receiveStockInTx, but booked as TRANSFER_IN with the
   * caller's transaction. Idempotency: `TRANSFER_IN:<transferLineId>`.
   */
  async transferInInTx(
    runner: QueryRunner,
    input: Omit<AddStockInput, 'referenceType' | 'referenceId'> & {
      referenceId: string;
    },
  ): Promise<StockChangeResult & { wrote: boolean }> {
    const prevalidated = await this.validateAddStock({
      ...input,
      referenceType: 'TRANSFER',
      referenceId: input.referenceId,
    });
    return this.addStockInTx(
      runner,
      { ...input, referenceType: 'TRANSFER' },
      'TRANSFER_IN',
      prevalidated,
    );
  }

  /**
   * Transfer OUT leg (Sprint 10, transfer.md §4/§5): decrements the SOURCE
   * bin's SELLABLE On Hand on the caller's runner. Guarded by the SELLABLE
   * availability rule - stock reserved or picked by orders can never be
   * transferred away (AGENTS.md §11/§16). SN-tracked SKUs are rejected:
   * which serials move is a unit-level decision this flow cannot make.
   * Idempotency: `TRANSFER_OUT:<transferLineId>` replays like every write.
   */
  async transferOutInTx(
    runner: QueryRunner,
    input: {
      skuId: string;
      warehouseId: string;
      binId?: string | null;
      quantity: string;
      referenceId: string;
      remark?: string | null;
      idempotencyKey: string;
      operator: OperatorContext;
    },
  ): Promise<StockChangeResult & { wrote: boolean }> {
    const qty = parseQty(input.quantity);
    if (qty <= 0n) {
      throw new InventoryQuantityInvalidError('调拨数量必须为正数', {
        idempotencyKey: input.idempotencyKey,
        quantity: input.quantity,
      });
    }
    const dim = await resolveDimension(this.deps, input, input.operator);
    const sku = await this.deps.skuService.getEntityById(input.skuId);
    if (sku === null) {
      throw new SkuNotFoundError(input.skuId);
    }
    if (sku.serialTracking) {
      throw new InventorySerialInvalidError(
        'SN 管理商品暂不支持调拨（需指定具体序列号，transfer.md §5）',
        { skuId: input.skuId },
      );
    }

    // Replay a committed duplicate without touching anything.
    const raced = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, input.idempotencyKey);
    if (raced !== null) {
      return {
        ...(await this.replayStockChangeInTx(runner, input.idempotencyKey, dim)),
        wrote: false,
      };
    }

    const balance = await this.balanceRepo.lockByDim(runner, {
      skuId: dim.skuId,
      warehouseId: dim.warehouseId,
      binId: dim.binId,
      condition: 'SELLABLE',
    });
    if (balance === null) {
      throw new InsufficientStockError({
        skuId: input.skuId,
        warehouseId: input.warehouseId,
        requestedQty: formatQty(qty),
        availableQty: '0.000',
      });
    }
    const available =
      parseQty(balance.onHandQty) - parseQty(balance.reservedQty) - parseQty(balance.pickedQty);
    if (available < qty) {
      throw new InsufficientMovableStockError({
        skuId: input.skuId,
        binId: dim.binId,
        requestedQty: formatQty(qty),
        movableQty: formatQty(available),
      });
    }

    const patch = {
      onHandQty: formatQty(parseQty(balance.onHandQty) - qty),
      reservedQty: balance.reservedQty,
      pickedQty: balance.pickedQty,
      version: nextVersionOf(balance),
    };
    assertBalanceInvariants(patch);
    await this.balanceRepo.saveQuantities(runner, balance.id, patch);

    const event = await this.ledgerRepo.insertEventWithLines(
      runner,
      {
        eventType: 'TRANSFER_OUT',
        referenceType: 'TRANSFER',
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        operatorId: input.operator.userId,
        remark: input.remark ?? null,
      },
      [
        {
          skuId: dim.skuId,
          warehouseId: dim.warehouseId,
          binId: dim.binId,
          transactionType: 'TRANSFER_OUT',
          quantityBefore: balance.onHandQty,
          quantityChange: formatQty(-qty),
          quantityAfter: patch.onHandQty,
        },
      ],
    );

    return {
      eventNo: event.eventNo,
      transactionNos: [event.eventNo + '-1'],
      balance: this.snapshot(balance.id, dim, 'SELLABLE', patch),
      idempotentReplay: false,
      wrote: true,
    };
  }

  private async addStock(
    input: AddStockInput,
    eventType: InventoryEventType,
  ): Promise<StockChangeResult> {
    const prevalidated = await this.validateAddStock(input);

    // Fast replay check before opening a transaction (task par22).
    const existingEvent = await this.ledgerRepo.findEventByIdempotencyKey(input.idempotencyKey);
    if (existingEvent !== null) {
      return this.replayStockChange(existingEvent.idempotencyKey, prevalidated.dim);
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    // Everything below runs on the runner's own connection; the operation
    // log and result building happen AFTER release (pool discipline).
    let outcome: StockChangeResult & { wrote: boolean; from: string };
    try {
      outcome = await this.addStockInTx(runner, input, eventType, prevalidated);
      await runner.commitTransaction();
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      if (isUniqueViolationOn(error, 'uq_inventory_events_idem')) {
        // A concurrent duplicate of this idempotency key committed first.
        return this.replayStockChange(input.idempotencyKey, prevalidated.dim);
      }
      throw error;
    } finally {
      await runner.release();
    }

    if (!outcome.wrote) {
      return outcome;
    }
    await this.operationLog.record({
      entityType: 'INVENTORY_BALANCE',
      entityId: outcome.balance.balanceId,
      entityCode:
        prevalidated.dim.skuId + '/' + prevalidated.dim.warehouseId + '/' + prevalidated.dim.binId,
      action: eventType,
      changes: { onHandQty: { from: outcome.from, to: outcome.balance.onHandQty } },
      operator: input.operator,
    });
    return outcome;
  }

  /**
   * Shared core of every stock addition on the GIVEN runner: assumes
   * validateAddStock passed, performs the in-transaction idempotency check
   * and the locked balance write. A duplicate key resolves to the first
   * execution's replay shape WITHOUT rolling the caller's transaction back
   * (a replay is a no-op, not an error).
   */
  private async addStockInTx(
    runner: QueryRunner,
    input: AddStockInput,
    eventType: InventoryEventType,
    prevalidated: ValidatedAddStock,
  ): Promise<StockChangeResult & { wrote: boolean; from: string }> {
    const { qty, dim, serialNumbers } = prevalidated;

    // Idempotency check INSIDE the caller's transaction: a duplicate of this
    // key that committed earlier is detected without waiting for the unique
    // constraint to fire (task par22/par61).
    const raced = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, input.idempotencyKey);
    if (raced !== null) {
      return { ...(await this.replayStockChangeInTx(runner, input.idempotencyKey, dim)), from: '' };
    }

    const balance = await this.balanceRepo.lockOrCreate(runner, {
      skuId: dim.skuId,
      warehouseId: dim.warehouseId,
      binId: dim.binId,
      condition: input.condition,
    });
    const before = qtyFromDb(balance.onHandQty);
    const after = before + qty;
    const patch = {
      onHandQty: formatQty(after),
      reservedQty: balance.reservedQty,
      pickedQty: balance.pickedQty,
      version: nextVersionOf(balance),
    };
    assertBalanceInvariants(patch);
    await this.balanceRepo.saveQuantities(runner, balance.id, patch);

    const event = await this.ledgerRepo.insertEventWithLines(
      runner,
      {
        eventType,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        operatorId: input.operator.userId,
        remark: input.remark ?? null,
      },
      [
        {
          skuId: dim.skuId,
          warehouseId: dim.warehouseId,
          binId: dim.binId,
          transactionType: eventType,
          quantityBefore: balance.onHandQty,
          quantityChange: formatQty(qty),
          quantityAfter: patch.onHandQty,
        },
      ],
    );

    // Serial rows are written in the SAME transaction as the balance so
    // SN detail can never drift from the quantity fact (task par43).
    if (serialNumbers.length > 0) {
      try {
        await this.serialRepo.insertMany(
          runner,
          serialNumbers.map((serialNumber) => ({
            serialNumber,
            skuId: dim.skuId,
            warehouseId: dim.warehouseId,
            binId: dim.binId,
            status: 'IN_STOCK' as const,
          })),
        );
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new InventorySerialInvalidError('SN 已存在（与现有库存或本次列表重复）', {
            skuId: input.skuId,
          });
        }
        throw error;
      }
    }

    return {
      eventNo: event.eventNo,
      transactionNos: [event.eventNo + '-1'],
      balance: this.snapshot(balance.id, dim, input.condition, patch),
      idempotentReplay: false,
      wrote: true,
      from: balance.onHandQty,
    };
  }

  /** Validations that need no transaction: quantity, dimension, serials. */
  private async validateAddStock(input: AddStockInput): Promise<ValidatedAddStock> {
    const qty = parseQty(input.quantity);
    if (qty < 0n) {
      throw new InventoryQuantityInvalidError('入库/初始化数量不能为负', {
        idempotencyKey: input.idempotencyKey,
        quantity: input.quantity,
      });
    }
    const dim = await resolveDimension(this.deps, input, input.operator);

    // Serial validation BEFORE any write (Sprint 3 task par44): serial-tracked
    // SKUs must receive one serial per unit; others must not carry serials.
    const sku = await this.deps.skuService.getEntityById(input.skuId);
    if (sku === null) {
      throw new SkuNotFoundError(input.skuId);
    }
    const serialNumbers = [
      ...new Set((input.serialNumbers ?? []).map((sn) => sn.trim()).filter((sn) => sn !== '')),
    ];
    if (sku.serialTracking) {
      if (qty % 1000n !== 0n) {
        throw new InventorySerialInvalidError('SN 管理商品的入库数量必须为整数件', {
          skuId: input.skuId,
          quantity: input.quantity,
        });
      }
      if (input.serialNumbers === undefined || serialNumbers.length === 0) {
        throw new InventorySerialInvalidError('SN 管理商品入库必须提供 SN 列表', {
          skuId: input.skuId,
          quantity: input.quantity,
        });
      }
      if (BigInt(serialNumbers.length) * 1000n !== qty) {
        throw new InventorySerialInvalidError('SN 数量与入库数量不一致', {
          skuId: input.skuId,
          quantity: input.quantity,
          serialCount: serialNumbers.length,
        });
      }
    } else if (serialNumbers.length > 0) {
      throw new InventorySerialInvalidError('非 SN 管理商品不能提供 SN 列表', {
        skuId: input.skuId,
      });
    }
    return { qty, dim, serialNumbers };
  }

  /** Replay result assembled on the caller's connection (sees own writes). */
  private async replayStockChangeInTx(
    runner: QueryRunner,
    idempotencyKey: string,
    dim: { skuId: string; warehouseId: string; binId?: string | null },
  ): Promise<StockChangeResult & { wrote: false }> {
    const event = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, idempotencyKey);
    if (event === null) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const lines = await this.ledgerRepo.findTransactionsByEventIdTx(runner, event.id);
    if (lines.length === 0 || lines[0]!.skuId !== dim.skuId) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const current = await this.balanceRepo.lockByDim(runner, {
      skuId: dim.skuId,
      warehouseId: dim.warehouseId,
      binId: lines[0]!.binId,
      condition: 'SELLABLE',
    });
    return {
      eventNo: event.eventNo,
      transactionNos: lines.map((line) => line.transactionNo),
      balance: {
        balanceId: current?.id ?? '',
        skuId: dim.skuId,
        warehouseId: dim.warehouseId,
        binId: lines[0]!.binId,
        condition: current?.inventoryCondition ?? 'SELLABLE',
        onHandQty: current?.onHandQty ?? '0.000',
        reservedQty: current?.reservedQty ?? '0.000',
        pickedQty: current?.pickedQty ?? '0.000',
      },
      idempotentReplay: true,
      wrote: false,
    };
  }

  /** Loads the first execution's outcome for an idempotent repeat (task §22). */
  private async replayStockChange(
    idempotencyKey: string,
    dim: { skuId: string; warehouseId: string; binId: string },
  ): Promise<StockChangeResult> {
    const event = await this.ledgerRepo.findEventByIdempotencyKey(idempotencyKey);
    if (event === null) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const lines = await this.ledgerRepo.findTransactionsByEventId(event.id);
    if (lines.length === 0 || lines[0]!.skuId !== dim.skuId || lines[0]!.binId !== dim.binId) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const current = await this.findBalance(dim.skuId, dim.warehouseId, lines[0]!.binId);
    return {
      eventNo: event.eventNo,
      transactionNos: lines.map((line) => line.transactionNo),
      balance: {
        balanceId: current?.id ?? '',
        skuId: dim.skuId,
        warehouseId: dim.warehouseId,
        binId: lines[0]!.binId,
        condition: current?.inventoryCondition ?? 'SELLABLE',
        onHandQty: current?.onHandQty ?? '0.000',
        reservedQty: current?.reservedQty ?? '0.000',
        pickedQty: current?.pickedQty ?? '0.000',
      },
      idempotentReplay: true,
    };
  }

  private async findBalance(
    skuId: string,
    warehouseId: string,
    binId: string,
  ): Promise<InventoryBalanceEntity | null> {
    return this.dataSource.getRepository(InventoryBalanceEntity).findOneBy({
      skuId,
      warehouseId,
      binId,
    });
  }

  private snapshot(
    balanceId: string,
    dim: { skuId: string; warehouseId: string; binId: string },
    condition: InventoryCondition,
    patch: { onHandQty: string; reservedQty: string; pickedQty: string },
  ): BalanceSnapshot {
    return {
      balanceId,
      skuId: dim.skuId,
      warehouseId: dim.warehouseId,
      binId: dim.binId,
      condition,
      onHandQty: patch.onHandQty,
      reservedQty: patch.reservedQty,
      pickedQty: patch.pickedQty,
    };
  }
}

/** PG unique violation on a specific constraint (unwraps driverError). */
export function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const driver = candidate.driverError ?? candidate;
  return driver.code === '23505' && driver.constraint === constraint;
}

export { isUniqueViolation };
