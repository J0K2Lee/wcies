import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
  InventoryQuantityInvalidError,
} from '../errors/inventory.errors';
import {
  InventoryBalanceRepository,
  isUniqueViolation,
} from '../repositories/inventory-balance.repository';
import { InventoryTransactionRepository } from '../repositories/inventory-transaction.repository';
import {
  assertBalanceInvariants,
  nextVersionOf,
  resolveDimension,
  DimensionDeps,
} from './inventory-dimension';

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

@Injectable()
export class InventoryService {
  private readonly deps: DimensionDeps;

  constructor(
    private readonly dataSource: DataSource,
    private readonly balanceRepo: InventoryBalanceRepository,
    private readonly ledgerRepo: InventoryTransactionRepository,
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

  private async addStock(
    input: AddStockInput,
    eventType: InventoryEventType,
  ): Promise<StockChangeResult> {
    const qty = parseQty(input.quantity);
    if (qty < 0n) {
      throw new InventoryQuantityInvalidError('入库/初始化数量不能为负', {
        idempotencyKey: input.idempotencyKey,
        quantity: input.quantity,
      });
    }
    const dim = await resolveDimension(this.deps, input, input.operator);

    const existingEvent = await this.ledgerRepo.findEventByIdempotencyKey(input.idempotencyKey);
    if (existingEvent !== null) {
      return this.replayStockChange(existingEvent.idempotencyKey, dim);
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    // Everything below runs on the runner's own connection; the operation
    // log and result building happen AFTER release (pool discipline).
    let done:
      { eventNo: string; balanceId: string; from: string; patch: BalanceQuantities } | undefined;
    let replayKey: string | undefined;
    try {
      const balance = await this.balanceRepo.lockOrCreate(runner, {
        skuId: dim.skuId,
        warehouseId: dim.warehouseId,
        binId: dim.binId,
        condition: input.condition,
      });
      // Idempotency re-check AFTER the row lock: a concurrent duplicate of
      // this key that committed first is detected without waiting for the
      // unique constraint to fire (task §22/§61).
      const raced = await this.ledgerRepo.findEventByIdempotencyKeyTx(runner, input.idempotencyKey);
      if (raced !== null) {
        await runner.rollbackTransaction();
        replayKey = input.idempotencyKey;
      } else {
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

        await runner.commitTransaction();
        done = {
          eventNo: event.eventNo,
          balanceId: balance.id,
          from: balance.onHandQty,
          patch,
        };
      }
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      if (isUniqueViolationOn(error, 'uq_inventory_events_idem')) {
        // A concurrent duplicate of this idempotency key committed first.
        return this.replayStockChange(input.idempotencyKey, dim);
      }
      throw error;
    } finally {
      await runner.release();
    }

    if (replayKey !== undefined) {
      return this.replayStockChange(replayKey, dim);
    }
    if (done === undefined) {
      throw new Error('addStock: no result produced');
    }

    await this.operationLog.record({
      entityType: 'INVENTORY_BALANCE',
      entityId: done.balanceId,
      entityCode: `${dim.skuId}/${dim.warehouseId}/${dim.binId}`,
      action: eventType,
      changes: { onHandQty: { from: done.from, to: done.patch.onHandQty } },
      operator: input.operator,
    });
    return {
      eventNo: done.eventNo,
      transactionNos: [`${done.eventNo}-1`],
      balance: this.snapshot(done.balanceId, dim, input.condition, done.patch),
      idempotentReplay: false,
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
