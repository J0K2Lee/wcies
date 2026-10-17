import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { InventoryService } from '../../inventory/services/inventory.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { TransferOrderEntity } from '../entities/transfer-order.entity';
import {
  TransferOrderInvalidError,
  TransferOrderInvalidStateError,
  TransferOrderNotFoundError,
} from '../errors/transfer.errors';
import {
  TransferListFilters,
  TransferOrderRepository,
} from '../repositories/transfer-order.repository';
import { TransferOrderStatus, transferInKey, transferOutKey } from '../enums/transfer.constants';

const ENTITY_TYPE = 'TRANSFER_ORDER';

export interface TransferLineInput {
  skuId: string;
  quantity: string;
  fromBinId?: string | null;
  toBinId?: string | null;
  remark?: string | null;
}

export interface CreateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  remark?: string | null;
  lines: TransferLineInput[];
}

/**
 * Warehouse-to-warehouse transfers (transfer.md). Confirmation moves EVERY
 * line through the inventory core inside ONE transaction: any failure rolls
 * the whole order back - no half-moved state can exist (transfer.md §1/§3).
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: TransferOrderRepository,
    private readonly inventoryService: InventoryService,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  async create(input: CreateTransferInput, operator: OperatorContext) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new TransferOrderInvalidError('源仓库与目标仓库不能相同');
    }
    await this.assertWarehouse(input.fromWarehouseId);
    await this.assertWarehouse(input.toWarehouseId);
    if (input.lines.length === 0) {
      throw new TransferOrderInvalidError('调拨单至少需要一行明细');
    }
    for (const line of input.lines) {
      await this.assertLine(line);
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const transferNo = await this.businessCode.nextTransferNo(manager);
      return this.repository.insertWithLines(
        manager,
        {
          transferNo,
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          status: 'DRAFT',
          remark: input.remark ?? null,
          createdBy: operator.userId,
        },
        input.lines.map((line) => ({
          skuId: line.skuId,
          quantity: formatQty(parseQty(line.quantity)),
          fromBinId: line.fromBinId ?? null,
          toBinId: line.toBinId ?? null,
          remark: line.remark ?? null,
        })),
      );
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: created.transferNo,
      action: 'CREATE',
      changes: { status: { from: null, to: 'DRAFT' } },
      operator,
    });
    return created;
  }

  /** DRAFT-only line append (transfer.md §3). */
  async addLine(
    id: string,
    line: TransferLineInput,
    operator: OperatorContext,
  ): Promise<TransferOrderEntity> {
    const transfer = await this.getTransferOrThrow(id);
    this.assertDraft(transfer);
    await this.assertLine(line);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO transfer_order_lines
           (id, transfer_id, sku_id, quantity, from_bin_id, to_bin_id, remark, created_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::numeric, $4::uuid, $5::uuid, $6, now())`,
        [
          transfer.id,
          line.skuId,
          formatQty(parseQty(line.quantity)),
          line.fromBinId ?? null,
          line.toBinId ?? null,
          line.remark ?? null,
        ],
      );
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: transfer.id,
      entityCode: transfer.transferNo,
      action: 'UPDATE',
      changes: { lines: { from: null, to: `+1 (${line.skuId})` } },
      operator,
    });
    return (await this.repository.findById(transfer.id)) as TransferOrderEntity;
  }

  /** DRAFT-only line removal (transfer.md §3). */
  async removeLine(
    id: string,
    lineId: string,
    operator: OperatorContext,
  ): Promise<TransferOrderEntity> {
    const transfer = await this.getTransferOrThrow(id);
    this.assertDraft(transfer);
    const result = await this.dataSource.transaction(
      async (manager): Promise<unknown[]> =>
        await manager.query(
          `DELETE FROM transfer_order_lines
           WHERE id = $1::uuid AND transfer_id = $2::uuid`,
          [lineId, transfer.id],
        ),
    );
    if (!Array.isArray(result) || result.length === 0) {
      throw new TransferOrderInvalidError('调拨单明细行不存在', { lineId });
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: transfer.id,
      entityCode: transfer.transferNo,
      action: 'UPDATE',
      changes: { lines: { from: lineId, to: null } },
      operator,
    });
    return (await this.repository.findById(transfer.id)) as TransferOrderEntity;
  }

  /**
   * DRAFT -> CONFIRMED (transfer.md §3/§4): both legs of every line run on
   * ONE QueryRunner - TRANSFER_OUT validates sellable availability on the
   * source, TRANSFER_IN lands the goods in the destination; the ledger
   * idempotency keys make a retry after a crash safe.
   */
  async confirm(id: string, operator: OperatorContext): Promise<TransferOrderEntity> {
    const transfer = await this.getTransferOrThrow(id);
    this.assertDraft(transfer);
    const lines = await this.repository.listLines(transfer.id);
    if (lines.length === 0) {
      throw new TransferOrderInvalidError('调拨单没有明细，不能确认');
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    // 调入事件在**提交后**广播（2026-10-17：事务内广播时新建余额行对监听器不可见）。
    const transferredInSkus = new Set<string>();
    try {
      await this.repository.updateStatus(runner.manager, transfer.id, 'CONFIRMED');
      for (const line of lines) {
        const out = await this.inventoryService.transferOutInTx(runner, {
          skuId: line.skuId,
          warehouseId: transfer.fromWarehouseId,
          binId: line.fromBinId,
          quantity: line.quantity,
          referenceId: line.id,
          remark: `transfer=${transfer.transferNo} OUT`,
          idempotencyKey: transferOutKey(line.id),
          operator,
        });
        const inc = await this.inventoryService.transferInInTx(runner, {
          skuId: line.skuId,
          warehouseId: transfer.toWarehouseId,
          binId: line.toBinId,
          condition: 'SELLABLE',
          quantity: line.quantity,
          referenceId: line.id,
          remark: `transfer=${transfer.transferNo} IN`,
          idempotencyKey: transferInKey(line.id),
          operator,
        });
        if (inc.wrote) {
          transferredInSkus.add(line.skuId);
        }
        await this.repository.markLineLegs(runner.manager, line.id, {
          outEventNo: out.eventNo,
          inEventNo: inc.eventNo,
        });
      }
      await runner.commitTransaction();
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    for (const skuId of transferredInSkus) {
      this.inventoryService.emitStockIncreased({
        skuId,
        warehouseId: transfer.toWarehouseId,
        eventType: 'TRANSFER_IN',
      });
    }

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: transfer.id,
      entityCode: transfer.transferNo,
      action: 'CONFIRM',
      changes: {
        status: { from: transfer.status, to: 'CONFIRMED' },
        linesCount: { from: null, to: lines.length },
      },
      operator,
    });
    return (await this.repository.findById(transfer.id)) as TransferOrderEntity;
  }

  /** DRAFT -> CANCELLED (transfer.md §3): never touched stock. */
  async cancel(id: string, operator: OperatorContext): Promise<TransferOrderEntity> {
    const transfer = await this.getTransferOrThrow(id);
    this.assertDraft(transfer);
    await this.dataSource.transaction(async (manager) => {
      await this.repository.updateStatus(manager, transfer.id, 'CANCELLED');
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: transfer.id,
      entityCode: transfer.transferNo,
      action: 'CANCEL',
      changes: { status: { from: transfer.status, to: 'CANCELLED' } },
      operator,
    });
    return (await this.repository.findById(transfer.id)) as TransferOrderEntity;
  }

  async list(
    filters: TransferListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: Array<Record<string, unknown>>; meta: PageMeta }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    const items = rows.map((row) => ({
      ...row.transfer,
      fromWarehouseName: row.fromWarehouseName,
      toWarehouseName: row.toWarehouseName,
      linesCount: row.linesCount,
    }));
    return { items, meta: { page: page.page, pageSize: page.pageSize, total } };
  }

  async getDetail(id: string) {
    const transfer = await this.getTransferOrThrow(id);
    const [lines, fromWarehouse, toWarehouse] = await Promise.all([
      this.repository.listLinesWithRefs(transfer.id),
      this.warehouseService.getEntityById(transfer.fromWarehouseId),
      this.warehouseService.getEntityById(transfer.toWarehouseId),
    ]);
    return {
      ...transfer,
      fromWarehouseName: fromWarehouse?.name ?? '',
      toWarehouseName: toWarehouse?.name ?? '',
      lines: lines.map((row) => ({
        ...row.line,
        skuCode: row.skuCode,
        skuName: row.skuName,
        fromBinCode: row.fromBinCode,
        toBinCode: row.toBinCode,
      })),
    };
  }

  private async assertWarehouse(warehouseId: string): Promise<void> {
    const warehouse = await this.warehouseService.getEntityById(warehouseId);
    if (warehouse === null) {
      throw new TransferOrderInvalidError('仓库不存在', { warehouseId });
    }
  }

  private async assertLine(line: TransferLineInput): Promise<void> {
    if (parseQty(line.quantity) <= 0n) {
      throw new TransferOrderInvalidError('调拨数量必须为正数', { quantity: line.quantity });
    }
    const sku = await this.skuService.getEntityById(line.skuId);
    if (sku === null) {
      throw new SkuNotFoundError(line.skuId);
    }
    if (sku.serialTracking) {
      throw new TransferOrderInvalidError('SN 管理商品暂不支持调拨（transfer.md §5）', {
        skuId: line.skuId,
      });
    }
  }

  private assertDraft(transfer: TransferOrderEntity): void {
    if (transfer.status !== 'DRAFT') {
      throw new TransferOrderInvalidStateError(
        `调拨单 ${transfer.transferNo} 当前状态 ${transfer.status}，仅 DRAFT 允许该操作（transfer.md §3）`,
        { transferNo: transfer.transferNo, status: transfer.status },
      );
    }
  }

  private async getTransferOrThrow(id: string): Promise<TransferOrderEntity> {
    const transfer = await this.repository.findById(id);
    if (transfer === null) {
      throw new TransferOrderNotFoundError(id);
    }
    return transfer;
  }
}

export type { TransferOrderStatus };
