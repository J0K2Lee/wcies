import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { ListingResolverService } from '../../listing/services/listing-resolver.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { PlatformReturnRepository } from '../repositories/platform-return.repository';
import { ReturnBatchRepository } from '../repositories/return-batch.repository';
import { ReturnBatchEntity } from '../entities/return-batch.entity';
import { returnReceiptKey } from '../enums/return.constants';
import {
  ReturnBatchNotFoundError,
  ReturnBatchInvalidStateError,
  ReturnItemInvalidConditionError,
  ReturnBinNotFoundError,
} from '../errors/return.errors';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { ReturnBatchItemView, ReturnBatchView } from '../dto/return.dto';

/**
 * Return-batch work service (dual-axis T5, returns.md §3): create → receive
 * → inspect. Inspection is the ONLY stock write-back (receiveStockInTx,
 * reference RETURN_RECEIPT); pre-inspection goods sit in the physical returns
 * area with ZERO ledger rows - "the platform says returned" and "goods in
 * transit" are not stock facts (AGENTS.md §14/§17).
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly batchRepo: ReturnBatchRepository,
    private readonly platformReturnRepo: PlatformReturnRepository,
    private readonly inventoryService: InventoryService,
    private readonly exceptionService: ExceptionService,
    private readonly binService: WarehouseBinService,
    private readonly warehouseService: WarehouseService,
    private readonly resolver: ListingResolverService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async listBatches(
    filters: { status?: string; warehouseId?: string },
    page: { page: number; pageSize: number },
  ): Promise<{ items: ReturnBatchView[]; meta: PageMeta }> {
    const { rows, total } = await this.batchRepo.list({
      ...filters,
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.batch.id,
        batchNo: row.batch.batchNo,
        warehouseId: row.batch.warehouseId,
        status: row.batch.status,
        sourceNote: row.batch.sourceNote,
        itemCount: row.itemCount,
        createdAt: row.batch.createdAt,
      })),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getBatch(id: string): Promise<ReturnBatchView & { items: ReturnBatchItemView[] }> {
    const batch = await this.getBatchOrThrow(id);
    const items = await this.batchRepo.findItemsByBatchId(id);
    const platformReturns = new Map(
      (
        await Promise.all(
          [
            ...new Set(
              items.map((item) => item.platformReturnId).filter((v): v is string => v !== null),
            ),
          ].map((returnId) => this.platformReturnRepo.findById(returnId)),
        )
      )
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map((row) => [row.id, row]),
    );
    return {
      id: batch.id,
      batchNo: batch.batchNo,
      warehouseId: batch.warehouseId,
      status: batch.status,
      sourceNote: batch.sourceNote,
      itemCount: items.length,
      createdAt: batch.createdAt,
      items: items.map((item) => ({
        id: item.id,
        batchId: item.batchId,
        platformReturnId: item.platformReturnId,
        platformReturnNo: item.platformReturnId
          ? (platformReturns.get(item.platformReturnId)?.platformReturnId ?? null)
          : null,
        skuId: item.skuId,
        quantity: item.quantity,
        condition: item.condition,
        binId: item.binId,
        remark: item.remark,
        createdAt: item.createdAt,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Create (DRAFT) / receive / cancel
  // --------------------------------------------------------------------------

  /**
   * Creates a DRAFT batch. Lines come either from explicit items (skuId, or
   * a platform return id whose platform SKU is resolved store-scoped like
   * order ingestion) or both. A platform return already linked to another
   * line is rejected up front (reconciliation anchor, returns.md §3.4).
   */
  async createBatch(
    input: {
      warehouseId: string;
      sourceNote?: string;
      remark?: string;
      items: Array<{
        skuId?: string;
        platformReturnId?: string;
        quantity: string;
        remark?: string;
      }>;
    },
    operator: OperatorContext,
  ): Promise<ReturnBatchView & { items: ReturnBatchItemView[] }> {
    const warehouse = await this.warehouseService.getEntityById(input.warehouseId);
    if (warehouse === null) {
      throw new ReturnBatchInvalidStateError('收货仓库不存在', {
        warehouseId: input.warehouseId,
      });
    }
    if (input.items.length === 0) {
      throw new ReturnBatchInvalidStateError('退货批次至少需要一行明细', {});
    }

    const resolvedItems: Array<{
      platformReturnId: string | null;
      skuId: string;
      quantity: string;
      remark: string | null;
    }> = [];
    for (const item of input.items) {
      let skuId = item.skuId ?? null;
      let platformReturnId: string | null = null;
      if (item.platformReturnId !== undefined) {
        const platformReturn = await this.platformReturnRepo.findById(item.platformReturnId);
        if (platformReturn === null) {
          throw new ReturnBatchInvalidStateError('关联的平台退货记录不存在', {
            platformReturnId: item.platformReturnId,
          });
        }
        platformReturnId = platformReturn.id;
        if (skuId === null) {
          skuId = await this.resolveSkuOfPlatformReturn(platformReturn);
        }
      }
      if (skuId === null) {
        throw new ReturnBatchInvalidStateError('退货行缺少 SKU（人工行必须指定 skuId）', {
          platformReturnId: item.platformReturnId ?? null,
        });
      }
      const quantity = formatQty(parseQty(item.quantity));
      resolvedItems.push({
        platformReturnId,
        skuId,
        quantity,
        remark: item.remark?.slice(0, 500) ?? null,
      });
    }

    const batchNo = await this.businessCode.nextReturnBatchNo();
    const created = await this.dataSource
      .transaction(async (runner) => {
        const batch = await this.batchRepo.insertBatch(
          runner,
          {
            batchNo,
            warehouseId: input.warehouseId,
            status: 'DRAFT',
            sourceNote: input.sourceNote?.slice(0, 500) ?? null,
            remark: input.remark ?? null,
            createdBy: operator.userId,
          },
          resolvedItems,
        );
        return batch;
      })
      .catch((error: unknown) => {
        // Concurrent double-link of the same platform return: the partial
        // unique index is the last line of defense (returns.md §3.4).
        if (isUniqueViolationOn(error, 'uq_return_batch_items_platform_return')) {
          throw new ReturnBatchInvalidStateError(
            '存在平台退货记录已被另一退货批次行关联（对账锚点单次消费）',
            {},
          );
        }
        throw error;
      });
    await this.operationLog.record({
      entityType: 'RETURN_BATCH',
      entityId: created.id,
      entityCode: created.batchNo,
      action: 'CREATE',
      changes: { lines: { from: null, to: resolvedItems.length } },
      operator,
    });
    return this.getBatch(created.id);
  }

  /** Physical goods arrived and were counted - locks the line set. */
  async receiveBatch(id: string, operator: OperatorContext): Promise<ReturnBatchView> {
    const batch = await this.getBatchOrThrow(id);
    if (batch.status !== 'DRAFT') {
      throw new ReturnBatchInvalidStateError(
        `退货批次状态 ${batch.status} 不能确认收货（仅 DRAFT）`,
        { batchNo: batch.batchNo, status: batch.status },
      );
    }
    const items = await this.batchRepo.findItemsByBatchId(id);
    if (items.length === 0) {
      throw new ReturnBatchInvalidStateError('空批次不能确认收货', { batchId: id });
    }
    await this.dataSource.transaction(async (runner) => {
      await this.batchRepo.updateStatus(runner, id, 'RECEIVED');
    });
    await this.operationLog.record({
      entityType: 'RETURN_BATCH',
      entityId: id,
      entityCode: batch.batchNo,
      action: 'RECEIVE',
      changes: {
        status: { from: 'DRAFT', to: 'RECEIVED' },
        lines: { from: null, to: items.length },
      },
      operator,
    });
    return this.getBatch(id);
  }

  /** Draft-only cancel: nothing was ever booked (returns.md §3.2). */
  async cancelBatch(id: string, operator: OperatorContext): Promise<ReturnBatchView> {
    const batch = await this.getBatchOrThrow(id);
    if (batch.status !== 'DRAFT') {
      throw new ReturnBatchInvalidStateError(`退货批次状态 ${batch.status} 不能取消（仅 DRAFT）`, {
        batchNo: batch.batchNo,
        status: batch.status,
      });
    }
    await this.dataSource.transaction(async (runner) => {
      await this.batchRepo.updateStatus(runner, id, 'CANCELLED');
    });
    await this.operationLog.record({
      entityType: 'RETURN_BATCH',
      entityId: id,
      entityCode: batch.batchNo,
      action: 'CANCEL',
      changes: { status: { from: 'DRAFT', to: 'CANCELLED' } },
      operator,
    });
    return this.getBatch(id);
  }

  // --------------------------------------------------------------------------
  // Inspect: the only stock write-back path
  // --------------------------------------------------------------------------

  /**
   * One-shot inspection verdict for one line (returns.md §3.3):
   * - SELLABLE / DEFECTIVE: receiveStockInTx (condition decided here) with
   *   reference RETURN_RECEIPT and the RETURN_RECEIPT:<itemId> idempotency
   *   key; empty binId falls back to the warehouse STAGING bin (same rule as
   *   interception return-to-stock);
   * - LOST: no stock action;
   * - DEFECTIVE / LOST on a line linked to a platform return record raise
   *   RETURN_DIFFERENCE (claim/appeal follow-up).
   * All line verdicts terminal => batch COMPLETED automatically.
   */
  async inspectItem(
    input: { itemId: string; condition: 'SELLABLE' | 'DEFECTIVE' | 'LOST'; binId?: string },
    operator: OperatorContext,
  ): Promise<ReturnBatchItemView> {
    const item = await this.batchRepo.findItemById(input.itemId);
    if (item === null) {
      throw new ReturnBatchNotFoundError(input.itemId);
    }
    const batch = await this.getBatchOrThrow(item.batchId);
    if (item.condition !== 'PENDING') {
      // Re-inspecting an already-judged line is ALWAYS a re-verdict error,
      // even after the batch auto-completed (returns.md §3.3: one-shot).
      throw new ReturnItemInvalidConditionError(
        `退货行检验结论已定为 ${item.condition}，不可改判（判错走库存调整流程，returns.md §3.3）`,
        { itemId: item.id, condition: item.condition },
      );
    }
    if (batch.status !== 'RECEIVED') {
      throw new ReturnBatchInvalidStateError(
        `退货批次状态 ${batch.status} 不能检验（需 RECEIVED）`,
        { batchNo: batch.batchNo, status: batch.status },
      );
    }

    // Resolve the target bin for stock-writing verdicts.
    let targetBinId: string | null = null;
    if (input.condition !== 'LOST') {
      if (input.binId !== undefined && input.binId !== null && input.binId !== '') {
        const bin = await this.binService.getEntityById(input.binId);
        if (bin === null || bin.warehouseId !== batch.warehouseId) {
          throw new ReturnBinNotFoundError({
            binId: input.binId,
            warehouseId: batch.warehouseId,
          });
        }
        targetBinId = bin.id;
      } else {
        // STAGING fallback: a warehouse without a staging bin must not block
        // the physical return (same decision as interception, orders.md §9.5).
        const staging = await this.binService.ensureStagingBin(batch.warehouseId, operator);
        targetBinId = staging.id;
      }
    }

    if (input.condition === 'SELLABLE' || input.condition === 'DEFECTIVE') {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let wroteStock = false;
      try {
        const outcome = await this.inventoryService.receiveStockInTx(runner, {
          skuId: item.skuId,
          warehouseId: batch.warehouseId,
          binId: targetBinId,
          condition: input.condition,
          quantity: item.quantity,
          referenceType: 'RETURN_RECEIPT',
          referenceId: item.id,
          idempotencyKey: returnReceiptKey(item.id),
          remark: `return batch=${batch.batchNo}`,
          operator,
        });
        if (outcome.wrote) {
          wroteStock = true;
          await this.batchRepo.updateItem(runner.manager, item.id, {
            condition: input.condition,
            binId: targetBinId,
          });
        }
        await runner.commitTransaction();
      } catch (error: unknown) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
      // 提交后广播（2026-10-17）：事务内广播时新建余额行对监听器不可见。
      if (wroteStock) {
        this.inventoryService.emitStockIncreased({
          skuId: item.skuId,
          warehouseId: batch.warehouseId,
          eventType: 'RECEIVE',
        });
      }
    } else {
      // LOST: verdict only, zero stock action.
      await this.dataSource.transaction(async (runner) => {
        await this.batchRepo.updateItem(runner, item.id, { condition: 'LOST', binId: null });
      });
    }

    // Difference exception: the platform says these goods came back, but
    // they are defective or missing - human claim/appeal work.
    if (item.platformReturnId !== null && input.condition !== 'SELLABLE') {
      const platformReturn = await this.platformReturnRepo.findById(item.platformReturnId);
      if (platformReturn !== null) {
        await this.exceptionService.create({
          exceptionType: 'RETURN_DIFFERENCE',
          severity: 'MEDIUM',
          referenceType: 'RETURN_BATCH_ITEM',
          referenceId: item.id,
          storeId: platformReturn.storeId,
          message: `退货批次 ${batch.batchNo} 行检验结论为 ${input.condition}，与平台退货记录 ${platformReturn.platformReturnId} 不符——需人工索赔/申诉处理`,
          details: {
            batchNo: batch.batchNo,
            platformReturnNo: platformReturn.platformReturnId,
            condition: input.condition,
            quantity: item.quantity,
          },
        });
      }
    }

    // Batch completes itself once every line carries a terminal verdict.
    const items = await this.batchRepo.findItemsByBatchId(batch.id);
    if (items.every((row) => row.condition !== 'PENDING')) {
      await this.dataSource.transaction(async (runner) => {
        await this.batchRepo.updateStatus(runner, batch.id, 'COMPLETED');
      });
    }

    await this.operationLog.record({
      entityType: 'RETURN_BATCH',
      entityId: batch.id,
      entityCode: batch.batchNo,
      action: 'INSPECT_ITEM',
      changes: {
        itemId: { from: null, to: item.id },
        condition: { from: 'PENDING', to: input.condition },
        binId: { from: null, to: targetBinId },
      },
      operator,
    });
    const fresh = await this.batchRepo.findItemById(item.id);
    return {
      id: fresh!.id,
      batchId: fresh!.batchId,
      platformReturnId: fresh!.platformReturnId,
      platformReturnNo: null,
      skuId: fresh!.skuId,
      quantity: fresh!.quantity,
      condition: fresh!.condition,
      binId: fresh!.binId,
      remark: fresh!.remark,
      createdAt: fresh!.createdAt,
    };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async getBatchOrThrow(id: string): Promise<ReturnBatchEntity> {
    const batch = await this.batchRepo.findById(id);
    if (batch === null) {
      throw new ReturnBatchNotFoundError(id);
    }
    return batch;
  }

  /** Store-scoped platform-SKU resolution (same rule as order lines, §24/§26). */
  private async resolveSkuOfPlatformReturn(platformReturn: {
    storeId: string;
    platformSkuId: string | null;
    offerId: string | null;
  }): Promise<string | null> {
    if (platformReturn.platformSkuId === null && platformReturn.offerId === null) {
      return null;
    }
    try {
      const resolved = await this.resolver.resolveInternalSku({
        storeId: platformReturn.storeId,
        platformSkuId: platformReturn.platformSkuId ?? undefined,
        sellerSku: undefined,
      });
      return resolved.internalSkuId;
    } catch {
      return null;
    }
  }
}

function isUniqueViolationOn(error: unknown, constraint: string): boolean {
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
