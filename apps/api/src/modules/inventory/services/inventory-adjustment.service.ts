import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { formatQty, parseQty, qtyFromDb } from '../../../common/utils/quantity';
import { InventoryBalanceEntity } from '../entities/inventory-balance.entity';
import { InventoryCondition } from '../enums/inventory.constants';
import {
  AdjustmentInvalidError,
  IdempotencyConflictError,
  InventoryQuantityInvalidError,
} from '../errors/inventory.errors';
import { InventoryBalanceRepository } from '../repositories/inventory-balance.repository';
import { InventoryTransactionRepository } from '../repositories/inventory-transaction.repository';
import {
  assertBalanceInvariants,
  nextVersionOf,
  resolveDimension,
  DimensionDeps,
} from './inventory-dimension';
import { StockChangeResult, BalanceQuantities } from './inventory.service';
import { isUniqueViolationOn } from './inventory.service';

export interface AdjustStockInput {
  skuId: string;
  warehouseId: string;
  binId: string;
  condition: InventoryCondition;
  /** Signed delta, e.g. "+2" / "-1"; zero is rejected. */
  quantityDelta: string;
  reason: string;
  remark?: string | null;
  idempotencyKey: string;
  operator: OperatorContext;
}

/**
 * Manual adjustment (task §38-§39, inventory.md §42-§43): admin-only On Hand
 * correction with reason + remark. It NEVER touches reserved/picked - broken
 * occupancy states must be fixed through their business records
 * (inventory.md §43).
 */
@Injectable()
export class InventoryAdjustmentService {
  private static readonly IDEMPOTENCY_CONSTRAINT = 'uq_inventory_events_idem';
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

  async adjustStock(input: AdjustStockInput): Promise<StockChangeResult> {
    const delta = parseQty(input.quantityDelta);
    if (delta === 0n) {
      throw new InventoryQuantityInvalidError('调整数量不能为 0');
    }
    const dim = await resolveDimension(this.deps, input, input.operator);

    const existingEvent = await this.ledgerRepo.findEventByIdempotencyKey(input.idempotencyKey);
    if (existingEvent !== null) {
      return this.replayAdjustment(input.idempotencyKey, dim.binId);
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let done:
      { eventNo: string; balanceId: string; from: string; patch: BalanceQuantities } | undefined;
    try {
      const balance = await this.balanceRepo.lockByDim(runner, {
        skuId: dim.skuId,
        warehouseId: dim.warehouseId,
        binId: dim.binId,
        condition: input.condition,
      });
      if (balance === null) {
        // Adjustment corrects an existing record; new stock uses initialize/receive.
        throw new AdjustmentInvalidError('库存记录不存在，无法调整（未初始化）', {
          skuId: dim.skuId,
          warehouseId: dim.warehouseId,
          binId: dim.binId,
        });
      }

      const before = qtyFromDb(balance.onHandQty);
      const after = before + delta;
      const reserved = qtyFromDb(balance.reservedQty);
      const picked = qtyFromDb(balance.pickedQty);
      if (after < 0n) {
        throw new AdjustmentInvalidError('调整后库存为负，已拒绝', {
          onHandQty: balance.onHandQty,
          quantityDelta: input.quantityDelta,
        });
      }
      if (reserved + picked > after) {
        throw new AdjustmentInvalidError('调整后库存低于 Reserved/Picked 占用，已拒绝', {
          onHandQty: balance.onHandQty,
          reservedQty: balance.reservedQty,
          pickedQty: balance.pickedQty,
          quantityDelta: input.quantityDelta,
        });
      }

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
          eventType: 'MANUAL_ADJUSTMENT',
          referenceType: 'MANUAL',
          referenceId: dim.skuId, // adjustment targets the balance's SKU as its business source
          idempotencyKey: input.idempotencyKey,
          operatorId: input.operator.userId,
          remark: `reason=${input.reason}${input.remark !== null && input.remark !== undefined && input.remark !== '' ? `; ${input.remark}` : ''}`,
        },
        [
          {
            skuId: dim.skuId,
            warehouseId: dim.warehouseId,
            binId: dim.binId,
            transactionType: 'MANUAL_ADJUSTMENT',
            quantityBefore: balance.onHandQty,
            quantityChange: formatQty(delta),
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
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      if (isUniqueViolationOn(error, InventoryAdjustmentService.IDEMPOTENCY_CONSTRAINT)) {
        return this.replayAdjustment(input.idempotencyKey, dim.binId);
      }
      throw error;
    } finally {
      await runner.release();
    }

    // Post-commit work only (pool discipline): audit log then result.
    await this.operationLog.record({
      entityType: 'INVENTORY_BALANCE',
      entityId: done.balanceId,
      entityCode: `${dim.skuId}/${dim.warehouseId}/${dim.binId}`,
      action: 'MANUAL_ADJUSTMENT',
      changes: {
        onHandQty: { from: done.from, to: done.patch.onHandQty },
        reason: { from: null, to: input.reason },
      },
      operator: input.operator,
    });
    return {
      eventNo: done.eventNo,
      transactionNos: [`${done.eventNo}-1`],
      balance: {
        balanceId: done.balanceId,
        skuId: dim.skuId,
        warehouseId: dim.warehouseId,
        binId: dim.binId,
        condition: input.condition,
        onHandQty: done.patch.onHandQty,
        reservedQty: done.patch.reservedQty,
        pickedQty: done.patch.pickedQty,
      },
      idempotentReplay: false,
    };
  }

  private async replayAdjustment(
    idempotencyKey: string,
    binId: string,
  ): Promise<StockChangeResult> {
    const event = await this.ledgerRepo.findEventByIdempotencyKey(idempotencyKey);
    if (event === null) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const lines = await this.ledgerRepo.findTransactionsByEventId(event.id);
    const first = lines[0];
    if (first === undefined || first.binId !== binId) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const balance = await this.dataSource.getRepository(InventoryBalanceEntity).findOneBy({
      skuId: first.skuId,
      warehouseId: first.warehouseId,
      binId: first.binId,
    });
    return {
      eventNo: event.eventNo,
      transactionNos: lines.map((line) => line.transactionNo),
      balance: {
        balanceId: balance?.id ?? '',
        skuId: first.skuId,
        warehouseId: first.warehouseId,
        binId: first.binId,
        condition: balance?.inventoryCondition ?? 'SELLABLE',
        onHandQty: balance?.onHandQty ?? '0.000',
        reservedQty: balance?.reservedQty ?? '0.000',
        pickedQty: balance?.pickedQty ?? '0.000',
      },
      idempotentReplay: true,
    };
  }
}
