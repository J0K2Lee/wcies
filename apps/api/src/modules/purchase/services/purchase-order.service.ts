import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { PurchaseReceiptRepository } from '../repositories/purchase-receipt.repository';
import { PurchaseReceiptEntity } from '../entities/purchase-receipt.entity';
import { PageMeta } from '@wcies/shared';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { SkuService } from '../../product/services/sku.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { OrderService } from '../../order/services/order.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import { ProcurementState } from '../enums/purchase.constants';
import {
  PurchaseOrderInvalidStateError,
  PurchaseOrderItemAlreadyOrderedError,
  PurchaseOrderNotFoundError,
  SupplierNotFoundError,
} from '../errors/purchase-errors';
import {
  PurchaseOrderRepository,
  PurchaseOrderListFilters,
} from '../repositories/purchase-order.repository';
import { SupplierService } from './supplier.service';
import { PurchaseReceiptService } from './purchase-receipt.service';
import {
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
  PurchaseOrderItemInputDto,
  PurchaseOrderListItemDto,
  PurchaseOrderListQueryDto,
  ReceivingOptionDto,
  UpdatePurchaseOrderRequestDto,
} from '../dto/purchase-order.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';
import { DomainError } from '../../../common/errors/domain.error';
import {
  PurchaseBatchDeleteItemResultDto,
  PurchaseBatchDeleteResultDto,
} from '../dto/purchase-batch-delete.dto';

const ENTITY_TYPE = 'PURCHASE_ORDER';

/**
 * Purchase order registration (Sprint 7 task §10): answers "already
 * bought?" so the same order line is never purchased twice and nothing is
 * forgotten. A PO is INTENT - it never touches stock (decision 0013).
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: PurchaseOrderRepository,
    private readonly supplierService: SupplierService,
    private readonly skuService: SkuService,
    private readonly orderService: OrderService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
    private readonly receiptRepository: PurchaseReceiptRepository,
    private readonly warehouseService: WarehouseService,
    private readonly receiptService: PurchaseReceiptService,
  ) {}

  // --------------------------------------------------------------------------
  // Create / update / cancel
  // --------------------------------------------------------------------------

  async create(
    dto: CreatePurchaseOrderRequestDto,
    operator: OperatorContext,
  ): Promise<PurchaseOrderDetailDto> {
    await this.assertHeaderRefs(dto.supplierId);
    await this.assertItemsValid(dto.items);

    if (
      dto.receipt &&
      (await this.warehouseService.getEntityById(dto.receipt.warehouseId)) === null
    ) {
      throw new WarehouseNotFoundError(dto.receipt.warehouseId);
    }

    // 默认收货库位（决策 0021）：与 generateFromPo 同源——逐 SKU 取现存货位，
    // 无货则暂存位（不存在时自动创建）。必须在事务外解析：暂存位自动创建会写
    // 库位与操作日志，不能挂在采购单事务的 manager 上。
    const receiptBins = new Map<string, string | null>();
    if (dto.receipt) {
      const resolved = await this.receiptService.resolveDefaultReceiptBins(
        dto.receipt.warehouseId,
        dto.receipt.defaultBinId,
        dto.items.map((item) => item.skuId),
        operator,
      );
      for (const [skuId, binId] of resolved) {
        receiptBins.set(skuId, binId);
      }
    }

    const { created, receipt } = await this.dataSource.transaction(async (manager) => {
      // Anti-duplicate guard INSIDE the creation flow (purchase.md §3.4):
      // a live PO item linked to the same order line refuses this create.
      for (const item of dto.items) {
        if (item.orderItemId === undefined) {
          continue;
        }
        const existing = await this.repository.findActiveItemByOrderItemId(item.orderItemId);
        if (existing !== null) {
          throw new PurchaseOrderItemAlreadyOrderedError(
            existing.order.poNo,
            new Date(existing.order.orderedAt),
          );
        }
      }
      const poNo = await this.businessCode.nextPurchaseOrderNo();
      const created = await this.repository.insertWithItems(
        manager,
        {
          poNo,
          supplierId: dto.supplierId ?? null,
          sourceNote: dto.sourceNote?.trim() || null,
          status: 'ORDERED',
          orderedAt: dto.orderedAt == null ? new Date() : new Date(dto.orderedAt),
          expectedAt: dto.expectedAt ?? null,
          remark: dto.remark ?? null,
          createdBy: operator.userId,
          // 收货仓库意向回显（ERP 建议#4）：与收货草稿同源同值。
          receivingWarehouseId: dto.receipt?.warehouseId ?? null,
        },
        dto.items.map((item) => ({
          skuId: item.skuId,
          orderItemId: item.orderItemId ?? null,
          quantity: formatQty(parseQty(item.quantity)),
          unitCost: item.unitCost ?? null,
          remark: item.remark ?? null,
        })),
      );
      const receipt = dto.receipt
        ? await this.createReceiptDraft(manager, created, dto.receipt, receiptBins, operator)
        : null;
      return { created, receipt };
    });

    if (receipt !== null) {
      await this.operationLog.record({
        entityType: 'PURCHASE_RECEIPT',
        entityId: receipt.id,
        entityCode: receipt.receiptNo,
        action: 'CREATE',
        changes: {
          receiptNo: { from: null, to: receipt.receiptNo },
          generatedFrom: { from: null, to: created.poNo },
          warehouseId: { from: null, to: receipt.warehouseId },
          itemCount: { from: null, to: dto.items.length },
        },
        operator,
      });
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: created.poNo,
      action: 'CREATE',
      changes: {
        poNo: { from: null, to: created.poNo },
        supplierId: { from: null, to: created.supplierId },
        sourceNote: { from: null, to: created.sourceNote },
        itemCount: { from: null, to: dto.items.length },
      },
      operator,
    });
    return this.getDetail(created.id);
  }

  /** Only ORDERED may change - receipts freeze the quantities (§3.3). */
  async update(
    id: string,
    dto: UpdatePurchaseOrderRequestDto,
    operator: OperatorContext,
  ): Promise<PurchaseOrderDetailDto> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== 'ORDERED') {
      throw new PurchaseOrderInvalidStateError(
        `采购单状态 ${existing.status} 不允许修改（仅 ORDERED 可改）`,
        { poNo: existing.poNo, status: existing.status },
      );
    }
    await this.assertHeaderRefs(dto.supplierId ?? existing.supplierId ?? undefined);
    if (dto.items !== undefined) {
      await this.assertItemsValid(dto.items);
    }

    const before = this.snapshot(existing);
    await this.dataSource.transaction(async (manager) => {
      const patch: Partial<PurchaseOrderEntity> = {};
      if (dto.supplierId !== undefined) patch.supplierId = dto.supplierId;
      if (dto.sourceNote !== undefined) patch.sourceNote = dto.sourceNote?.trim() || null;
      if (dto.expectedAt !== undefined) patch.expectedAt = dto.expectedAt ?? null;
      if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
      if (Object.keys(patch).length > 0) {
        await this.repository.updateHeader(manager, id, patch);
      }
      if (dto.items !== undefined) {
        // Re-run the duplicate guard against OTHER POs (own items are being
        // replaced, so they must not collide with themselves).
        for (const item of dto.items) {
          if (item.orderItemId === undefined) {
            continue;
          }
          const collision = await this.repository.findActiveItemByOrderItemId(item.orderItemId, id);
          if (collision !== null) {
            throw new PurchaseOrderItemAlreadyOrderedError(
              collision.order.poNo,
              new Date(collision.order.orderedAt),
            );
          }
        }
        await this.repository.replaceItems(
          manager,
          id,
          dto.items.map((item) => ({
            skuId: item.skuId,
            orderItemId: item.orderItemId ?? null,
            quantity: formatQty(parseQty(item.quantity)),
            unitCost: item.unitCost ?? null,
            remark: item.remark ?? null,
          })),
        );
      }
    });

    const updated = await this.findOrThrow(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.poNo,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated)),
      operator,
    });
    return this.getDetail(id);
  }

  /** Cancel-before-receipt only: any received quantity freezes the PO. */
  async cancel(
    id: string,
    operator: OperatorContext,
    reason?: string,
  ): Promise<PurchaseOrderDetailDto> {
    const existing = await this.findOrThrow(id);
    if (existing.status === 'CANCELLED') {
      return this.getDetail(id);
    }
    if (existing.status !== 'ORDERED') {
      throw new PurchaseOrderInvalidStateError(`采购单已发生收货（${existing.status}），不能取消`, {
        poNo: existing.poNo,
        status: existing.status,
      });
    }
    const cancelledDrafts = await this.dataSource.transaction(async (manager) => {
      // Confirm locks receipt before updating PO. Keep that order to avoid
      // deadlocks, then recheck PO facts after any concurrent confirm finishes.
      const drafts = await this.receiptRepository.findDraftsByPurchaseOrderId(manager, id);
      const locked = await this.repository.lockById(manager, id);
      if (locked === null) throw new PurchaseOrderNotFoundError(id);
      const items = await this.repository.findItemsInTx(manager, id);
      if (
        locked.status !== 'ORDERED' ||
        items.some((item) => parseQty(item.receivedQuantity) > 0n)
      ) {
        throw new PurchaseOrderInvalidStateError('采购单已发生收货或状态已改变，不能取消', {
          poNo: locked.poNo,
          status: locked.status,
        });
      }
      for (const draft of drafts) {
        await this.receiptRepository.updateHeader(manager, draft.id, { status: 'CANCELLED' });
      }
      await this.repository.updateHeader(manager, id, { status: 'CANCELLED' });
      return drafts;
    });
    for (const draft of cancelledDrafts) {
      await this.operationLog.record({
        entityType: 'PURCHASE_RECEIPT',
        entityId: draft.id,
        entityCode: draft.receiptNo,
        action: 'CANCEL',
        changes: {
          status: { from: 'DRAFT', to: 'CANCELLED' },
          cancelledWithPurchaseOrder: { from: null, to: existing.poNo },
        },
        operator,
      });
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.poNo,
      action: 'CANCEL',
      changes: {
        status: { from: existing.status, to: 'CANCELLED' },
        cancelledReceiptCount: { from: null, to: cancelledDrafts.length },
        ...(reason ? { reason: { from: null, to: reason } } : {}),
      },
      operator,
    });
    return this.getDetail(id);
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async list(
    query: PurchaseOrderListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: PurchaseOrderListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const filters: PurchaseOrderListFilters = {
      keyword: query.keyword?.trim() || undefined,
      status: query.status,
      statuses: query.statuses,
      supplierId: query.supplierId,
      orderItemId: query.orderItemId,
      orderedFrom: query.orderedFrom,
      orderedTo: query.orderedTo,
    };
    const { rows, total } = await this.repository.list(filters, pageSize, offsetOf(page, pageSize));
    return {
      items: rows.map((row) => ({
        id: row.order.id,
        poNo: row.order.poNo,
        supplierId: row.order.supplierId,
        supplierName: row.supplierName,
        sourceNote: row.order.sourceNote,
        status: row.order.status,
        orderedAt: row.order.orderedAt,
        expectedAt: row.order.expectedAt,
        remark: row.order.remark,
        receivingWarehouseId: row.order.receivingWarehouseId,
        itemCount: row.itemCount,
        totalQuantity: row.totalQuantity,
        firstItemSkuCode: row.firstItemSkuCode,
        firstItemName: row.firstItemName,
        firstItemQuantity: row.firstItemQuantity,
        createdAt: row.order.createdAt,
        updatedAt: row.order.updatedAt,
      })),
      meta: { page, pageSize, total },
    };
  }

  /**
   * 批量删除采购单（用户指示 2026-10-17）：物理删除，但只允许从未产生库存
   * 事实的单据——无 `RECEIVED` 收货单且所有明细 `received_quantity = 0`
   * （其 DRAFT/CANCELLED 收货单随采购单一起删除）。
   *
   * 已入库的采购单拒绝删除并给出可读原因（库存事实以收货单为凭证，
   * AGENTS §14/§39；应走「取消」或后续退货流程）。逐笔独立：单笔失败只记录
   * 结果、不拖垮整批；删除前写操作日志保留审计痕迹。
   */
  async deleteBatch(
    ids: string[],
    operator: OperatorContext,
  ): Promise<PurchaseBatchDeleteResultDto> {
    const results: PurchaseBatchDeleteItemResultDto[] = [];
    for (const id of new Set(ids)) {
      const order = await this.repository.findById(id);
      try {
        if (order === null) {
          throw new PurchaseOrderNotFoundError(id);
        }
        await this.dataSource.transaction(async (manager) => {
          const locked = await this.repository.lockById(manager, id);
          if (locked === null) {
            throw new PurchaseOrderNotFoundError(id);
          }
          if (await this.repository.hasReceivingFacts(manager, id)) {
            throw new PurchaseOrderInvalidStateError(
              `采购单已发生收货（${locked.status}），库存事实不可撤销，不能删除；如需终止请走取消流程`,
              { poNo: locked.poNo, status: locked.status },
            );
          }
          await this.repository.deleteWithUnreceivedReceipts(manager, id);
        });
        await this.operationLog.record({
          entityType: ENTITY_TYPE,
          entityId: id,
          entityCode: order.poNo,
          action: 'DELETE',
          changes: {
            poNo: { from: order.poNo, to: null },
            status: { from: order.status, to: null },
            batchDelete: { from: null, to: true },
          },
          operator,
        });
        results.push({ id, code: order.poNo, ok: true, errorCode: null, message: null });
      } catch (error: unknown) {
        results.push({
          id,
          code: order?.poNo ?? null,
          ok: false,
          errorCode: error instanceof DomainError ? error.code : 'PURCHASE_ORDER_DELETE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  async getDetail(id: string): Promise<PurchaseOrderDetailDto> {
    const order = await this.findOrThrow(id);
    const items = await this.repository.findItemsWithRefs(order.id);
    // 收货仓库名称解析（ERP 建议#4 回显）：仅详情单查一次，列表不 join。
    const receivingWarehouse =
      order.receivingWarehouseId === null
        ? null
        : await this.warehouseService.getEntityById(order.receivingWarehouseId);
    return {
      id: order.id,
      poNo: order.poNo,
      supplierId: order.supplierId,
      supplierName: null,
      sourceNote: order.sourceNote,
      status: order.status,
      orderedAt: order.orderedAt,
      expectedAt: order.expectedAt,
      remark: order.remark,
      receivingWarehouseId: order.receivingWarehouseId,
      receivingWarehouseName: receivingWarehouse?.name ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: items.map((row) => ({
        id: row.item.id,
        skuId: row.item.skuId,
        skuCode: row.skuCode,
        skuName: row.skuName,
        orderItemId: row.item.orderItemId,
        orderNo: row.orderNo,
        quantity: row.item.quantity,
        unitCost: row.item.unitCost,
        receivedQuantity: row.item.receivedQuantity,
        remark: row.item.remark,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Order-module port (purchase.md §3.5): derived procurement state
  // --------------------------------------------------------------------------

  async getProcurementStatesByOrderItemIds(
    orderItemIds: readonly string[],
  ): Promise<Record<string, ProcurementState>> {
    const states = await this.repository.getProcurementStatesByOrderItemIds(orderItemIds);
    const result: Record<string, ProcurementState> = {};
    for (const id of orderItemIds) {
      result[id] = states[id] ?? 'NOT_ORDERED';
    }
    return result;
  }

  async listActiveOrderItemIds(): Promise<string[]> {
    return this.repository.listActiveOrderItemIds();
  }

  // --------------------------------------------------------------------------
  // Finance-module facts (Sprint 10, finance.md §6): payable amounts per PO.
  // Purchase owns the line-cost facts; the paid side lives in finance.
  // --------------------------------------------------------------------------

  /**
   * Payable facts for every PO (cancelled included so finance can reject
   * payments against them with a precise message): payable = SUM(quantity ×
   * unit_cost) over priced lines (unpriced lines contribute 0 and raise the
   * flag - an unknown cost is never fabricated, finance.md §6). Callers
   * filter by status for the payables list view.
   */
  async listPayableFacts(): Promise<
    Array<{
      id: string;
      poNo: string;
      supplierId: string | null;
      status: string;
      orderedAt: Date;
      payableAmount: string;
      hasUnpricedLines: boolean;
    }>
  > {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        po_no: string;
        supplier_id: string | null;
        status: string;
        ordered_at: string;
        payable: string | null;
        unpriced: string;
      }>
    >(
      `SELECT po.id, po.po_no, po.supplier_id, po.status, po.ordered_at,
              COALESCE(SUM(i.quantity * i.unit_cost)
                FILTER (WHERE i.unit_cost IS NOT NULL), 0) AS payable,
              COUNT(i.id) FILTER (WHERE i.unit_cost IS NULL) AS unpriced
       FROM purchase_orders po
       LEFT JOIN purchase_order_items i ON i.po_id = po.id
       GROUP BY po.id
       ORDER BY po.ordered_at DESC`,
    );
    return rows.map((row) => ({
      id: row.id,
      poNo: row.po_no,
      supplierId: row.supplier_id,
      status: row.status,
      orderedAt: new Date(row.ordered_at),
      payableAmount: row.payable ?? '0',
      hasUnpricedLines: Number(row.unpriced) > 0,
    }));
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async createReceiptDraft(
    manager: EntityManager,
    po: PurchaseOrderEntity,
    option: ReceivingOptionDto,
    binsBySku: Map<string, string | null>,
    operator: OperatorContext,
  ): Promise<PurchaseReceiptEntity> {
    // Read newly inserted lines through this manager, never another connection.
    const items = await this.repository.findItemsInTx(manager, po.id);
    const receiptNo = await this.businessCode.nextPurchaseReceiptNo();
    return this.receiptRepository.insertWithItems(
      manager,
      {
        receiptNo,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        sourceNote: po.sourceNote,
        warehouseId: option.warehouseId,
        status: 'DRAFT',
        remark: `从采购单 ${po.poNo} 创建时自动生成`,
        createdBy: operator.userId,
      },
      items.map((item) => ({
        purchaseOrderItemId: item.id,
        skuId: item.skuId,
        quantity: formatQty(parseQty(item.quantity) - parseQty(item.receivedQuantity)),
        unitCost: item.unitCost,
        binId: binsBySku.get(item.skuId) ?? null,
        serialNumbers: null,
        remark: null,
      })),
    );
  }

  private async assertHeaderRefs(supplierId?: string): Promise<void> {
    if (supplierId === undefined) {
      return;
    }
    if ((await this.supplierService.getEntityById(supplierId)) === null) {
      throw new SupplierNotFoundError(supplierId);
    }
  }

  private async assertItemsValid(items: PurchaseOrderItemInputDto[]): Promise<void> {
    for (const item of items) {
      if ((await this.skuService.getEntityById(item.skuId)) === null) {
        throw new SkuNotFoundError(item.skuId);
      }
      if (item.orderItemId !== undefined) {
        // Existence + shape check through the order module's public API
        // (never the order repositories, AGENTS.md §9).
        await this.orderService.getItemFulfillment(item.orderItemId);
      }
    }
  }

  private async findOrThrow(id: string): Promise<PurchaseOrderEntity> {
    const order = await this.repository.findById(id);
    if (order === null) {
      throw new PurchaseOrderNotFoundError(id);
    }
    return order;
  }

  private snapshot(order: PurchaseOrderEntity): Record<string, unknown> {
    return {
      supplierId: order.supplierId,
      sourceNote: order.sourceNote,
      expectedAt: order.expectedAt,
      remark: order.remark,
      status: order.status,
    };
  }
}
