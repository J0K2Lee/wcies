import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { formatQty, parseQty, qtyFromDb } from '../../../common/utils/quantity';
import { InventoryBalanceEntity } from '../entities/inventory-balance.entity';
import { InventoryCondition, InventoryReferenceType } from '../enums/inventory.constants';
import {
  IdempotencyConflictError,
  InsufficientMovableStockError,
  InventoryBalanceNotFoundError,
  InventoryQuantityInvalidError,
  MoveBinInvalidError,
} from '../errors/inventory.errors';
import { InventoryBalanceRepository } from '../repositories/inventory-balance.repository';
import { InventoryTransactionRepository } from '../repositories/inventory-transaction.repository';
import { InventoryStockListenerRegistry } from './inventory-stock-listener-registry';
import {
  assertBalanceInvariants,
  nextVersionOf,
  physicalAvailableOf,
  DimensionDeps,
} from './inventory-dimension';
import { StockChangeResult, isUniqueViolationOn } from './inventory.service';

export interface MoveBinInput {
  skuId: string;
  warehouseId: string;
  fromBinId: string;
  toBinId: string;
  condition: InventoryCondition;
  quantity: string;
  referenceType: InventoryReferenceType;
  referenceId: string;
  remark?: string | null;
  idempotencyKey: string;
  operator: OperatorContext;
}

export interface MoveBinResult extends StockChangeResult {
  fromBalance: { balanceId: string; binId: string; onHandQty: string };
  toBalance: { balanceId: string; binId: string; onHandQty: string };
}

/**
 * In-warehouse bin movement (task §36-§37, inventory.md §55): same warehouse,
 * same SKU, On Hand moves from A to B under ONE event with two ledger lines.
 * Occupied stock (Reserved/Picked) is not movable by a plain move.
 */
@Injectable()
export class InventoryMovementService {
  private static readonly IDEMPOTENCY_CONSTRAINT = 'uq_inventory_events_idem';
  private readonly deps: DimensionDeps;

  constructor(
    private readonly dataSource: DataSource,
    private readonly balanceRepo: InventoryBalanceRepository,
    private readonly ledgerRepo: InventoryTransactionRepository,
    private readonly stockListeners: InventoryStockListenerRegistry,
    skuService: SkuService,
    warehouseService: WarehouseService,
    binService: WarehouseBinService,
  ) {
    this.deps = { skuService, warehouseService, binService };
  }

  async moveBin(input: MoveBinInput): Promise<MoveBinResult> {
    const qty = parseQty(input.quantity);
    if (qty <= 0n) {
      throw new InventoryQuantityInvalidError('移位数量必须大于 0');
    }
    if (input.fromBinId === input.toBinId) {
      throw new MoveBinInvalidError('源库位与目标库位相同');
    }
    for (const binId of [input.fromBinId, input.toBinId]) {
      const bin = await this.deps.binService.getEntityById(binId);
      if (bin === null) {
        throw new MoveBinInvalidError(`库位不存在: ${binId}`, { binId });
      }
      if (bin.warehouseId !== input.warehouseId) {
        // Cross-warehouse movement is a future Transfer, not Move Bin (task §37).
        throw new MoveBinInvalidError('库位不属于该仓库（跨仓请使用调拨）', {
          binId,
          warehouseId: input.warehouseId,
        });
      }
    }
    const sku = await this.deps.skuService.getEntityById(input.skuId);
    if (sku === null) {
      throw new MoveBinInvalidError(`SKU 不存在: ${input.skuId}`, { skuId: input.skuId });
    }

    const existingEvent = await this.ledgerRepo.findEventByIdempotencyKey(input.idempotencyKey);
    if (existingEvent !== null) {
      return this.replayMove(input.idempotencyKey);
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let raceReplay: boolean | undefined;
    try {
      // Deterministic lock order: bin_code of the two bins decides who locks first.
      const [firstBinId, secondBinId] = await this.binLockOrder(input.fromBinId, input.toBinId);
      const first = await this.lockOrReject(
        runner,
        input,
        firstBinId,
        firstBinId === input.toBinId,
      );
      const second = await this.lockOrReject(
        runner,
        input,
        secondBinId,
        secondBinId === input.toBinId,
      );

      const source = firstBinId === input.fromBinId ? first : second;
      const target = firstBinId === input.fromBinId ? second : first;

      const movable = physicalAvailableOf(source);
      if (movable < qty) {
        throw new InsufficientMovableStockError({
          skuId: input.skuId,
          binId: input.fromBinId,
          requestedQty: formatQty(qty),
          movableQty: formatQty(movable),
        });
      }

      const sourceBefore = qtyFromDb(source.onHandQty);
      const targetBefore = qtyFromDb(target.onHandQty);
      const sourcePatch = {
        onHandQty: formatQty(sourceBefore - qty),
        reservedQty: source.reservedQty,
        pickedQty: source.pickedQty,
        version: nextVersionOf(source),
      };
      const targetPatch = {
        onHandQty: formatQty(targetBefore + qty),
        reservedQty: target.reservedQty,
        pickedQty: target.pickedQty,
        version: nextVersionOf(target),
      };
      assertBalanceInvariants(sourcePatch);
      assertBalanceInvariants(targetPatch);
      await this.balanceRepo.saveQuantities(runner, source.id, sourcePatch);
      await this.balanceRepo.saveQuantities(runner, target.id, targetPatch);

      const event = await this.ledgerRepo.insertEventWithLines(
        runner,
        {
          eventType: 'MOVE_BIN',
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          idempotencyKey: input.idempotencyKey,
          operatorId: input.operator.userId,
          remark: input.remark ?? null,
        },
        [
          {
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            binId: input.fromBinId,
            transactionType: 'MOVE_BIN',
            quantityBefore: source.onHandQty,
            quantityChange: formatQty(-qty),
            quantityAfter: sourcePatch.onHandQty,
          },
          {
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            binId: input.toBinId,
            transactionType: 'MOVE_BIN',
            quantityBefore: target.onHandQty,
            quantityChange: formatQty(qty),
            quantityAfter: targetPatch.onHandQty,
          },
        ],
      );

      await runner.commitTransaction();

      // 库内移位也通知监听器（用户指示 2026-10-15）：收货入暂存库位后用户
      // 移位上架是「货已就位」的心智时点——配置类失败（如店铺后补绑定仓库）
      // 修复后的任何移位都让缺货行获得一次自愈的自动占用（预留幂等，仍不
      // 足则静默跳过）。幂等重放路径不重复通知。
      this.stockListeners.emitStockIncreased({
        skuId: input.skuId,
        warehouseId: input.warehouseId,
        eventType: 'MOVE_BIN',
      });

      return {
        eventNo: event.eventNo,
        transactionNos: [`${event.eventNo}-1`, `${event.eventNo}-2`],
        balance: {
          balanceId: source.id,
          skuId: input.skuId,
          warehouseId: input.warehouseId,
          binId: input.fromBinId,
          condition: input.condition,
          onHandQty: sourcePatch.onHandQty,
          reservedQty: sourcePatch.reservedQty,
          pickedQty: sourcePatch.pickedQty,
        },
        fromBalance: {
          balanceId: source.id,
          binId: input.fromBinId,
          onHandQty: sourcePatch.onHandQty,
        },
        toBalance: {
          balanceId: target.id,
          binId: input.toBinId,
          onHandQty: targetPatch.onHandQty,
        },
        idempotentReplay: false,
      };
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      if (isUniqueViolationOn(error, InventoryMovementService.IDEMPOTENCY_CONSTRAINT)) {
        raceReplay = true;
      } else {
        throw error;
      }
    } finally {
      await runner.release();
    }
    // Pool discipline: replay lookups run only after the runner is released.
    if (raceReplay) {
      return this.replayMove(input.idempotencyKey);
    }
    throw new Error('moveBin: no result produced');
  }

  /** Locks one side of the move; the target side may be created (task §37). */
  private async lockOrReject(
    runner: QueryRunner,
    input: MoveBinInput,
    binId: string,
    allowCreate: boolean,
  ): Promise<InventoryBalanceEntity> {
    const dim = {
      skuId: input.skuId,
      warehouseId: input.warehouseId,
      binId,
      condition: input.condition,
    };
    if (allowCreate) {
      return this.balanceRepo.lockOrCreate(runner, dim);
    }
    const locked = await this.balanceRepo.lockByDim(runner, dim);
    if (locked === null) {
      throw new InventoryBalanceNotFoundError({
        skuId: input.skuId,
        warehouseId: input.warehouseId,
        binId,
      });
    }
    return locked;
  }

  private async binLockOrder(a: string, b: string): Promise<[string, string]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id, bin_code FROM warehouse_bins WHERE id IN ($1, $2) ORDER BY bin_code ASC, id ASC`,
      [a, b],
    );
    const ordered = rows.map((row) => row.id);
    return ordered.length === 2 ? [ordered[0]!, ordered[1]!] : [a, b];
  }

  private async replayMove(idempotencyKey: string): Promise<MoveBinResult> {
    const event = await this.ledgerRepo.findEventByIdempotencyKey(idempotencyKey);
    if (event === null) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const lines = await this.ledgerRepo.findTransactionsByEventId(event.id);
    if (lines.length !== 2) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const balances = await Promise.all(
      lines.map(async (line) =>
        this.dataSource.getRepository(InventoryBalanceEntity).findOneBy({
          skuId: line.skuId,
          warehouseId: line.warehouseId,
          binId: line.binId,
        }),
      ),
    );
    return {
      eventNo: event.eventNo,
      transactionNos: lines.map((line) => line.transactionNo),
      balance: {
        balanceId: balances[0]?.id ?? '',
        skuId: lines[0]!.skuId,
        warehouseId: lines[0]!.warehouseId,
        binId: lines[0]!.binId,
        condition: balances[0]?.inventoryCondition ?? 'SELLABLE',
        onHandQty: balances[0]?.onHandQty ?? '0.000',
        reservedQty: balances[0]?.reservedQty ?? '0.000',
        pickedQty: balances[0]?.pickedQty ?? '0.000',
      },
      fromBalance: {
        balanceId: balances[0]?.id ?? '',
        binId: lines[0]!.binId,
        onHandQty: balances[0]?.onHandQty ?? '0.000',
      },
      toBalance: {
        balanceId: balances[1]?.id ?? '',
        binId: lines[1]!.binId,
        onHandQty: balances[1]?.onHandQty ?? '0.000',
      },
      idempotentReplay: true,
    };
  }
}
