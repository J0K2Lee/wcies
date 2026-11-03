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
import { SkuImageService } from '../../product/services/sku-image.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import {
  PurchaseOrderInvalidStateError,
  PurchaseOrderNotFoundError,
  PurchaseSkuGapCoveredError,
  SupplierNotFoundError,
} from '../errors/purchase-errors';
import {
  PurchaseOrderRepository,
  PurchaseOrderListFilters,
} from '../repositories/purchase-order.repository';
import { SupplierService } from './supplier.service';
import { PurchaseReceiptService } from './purchase-receipt.service';
import {
  OrderItemProcurementCoverage,
  ProcurementCoverageService,
} from './procurement-coverage.service';
import {
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
  PurchaseOrderItemInputDto,
  PurchaseOrderListItemDto,
  CloseRemainingRequestDto,
  CloseRemainingResultDto,
  PurchaseOrderListQueryDto,
  UpdatePurchaseOrderRequestDto,
} from '../dto/purchase-order.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';
import { DomainError } from '../../../common/errors/domain.error';
import {
  PurchaseBatchDeleteItemResultDto,
  PurchaseBatchDeleteResultDto,
} from '../dto/purchase-batch-delete.dto';
import { PurchaseReceiptDuplicateDraftError } from '../errors/purchase-errors';

const ENTITY_TYPE = 'PURCHASE_ORDER';

/**
 * 某行「还没收、还没结案」的数量 = quantity − received − closed（2026-11-03）。
 * 草稿预填、超收守卫、在途、补货缺口都用这同一个口径。
 */
function remainingOf(item: {
  quantity: string;
  receivedQuantity: string;
  closedQuantity?: string | null;
}): bigint {
  return (
    parseQty(item.quantity) - parseQty(item.receivedQuantity) - parseQty(item.closedQuantity ?? '0')
  );
}

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
    private readonly skuImageService: SkuImageService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
    private readonly receiptRepository: PurchaseReceiptRepository,
    private readonly warehouseService: WarehouseService,
    private readonly receiptService: PurchaseReceiptService,
    private readonly coverageService: ProcurementCoverageService,
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

    // 目标仓（2026-10-21）：采购单必填收货仓库；收货/库位/覆盖都以它为准。
    if ((await this.warehouseService.getEntityById(dto.receivingWarehouseId)) === null) {
      throw new WarehouseNotFoundError(dto.receivingWarehouseId);
    }

    // 默认收货库位（决策 0021）：与 generateFromPo 同源——逐 SKU 取现存货位，
    // 无货则暂存位（不存在时自动创建）。必须在事务外解析：暂存位自动创建会写
    // 库位与操作日志，不能挂在采购单事务的 manager 上。
    const receiptBins = new Map<string, string | null>();
    if (dto.receipt) {
      const resolved = await this.receiptService.resolveDefaultReceiptBins(
        dto.receivingWarehouseId,
        dto.receipt.defaultBinId,
        dto.items.map((item) => item.skuId),
        operator,
      );
      for (const [skuId, binId] of resolved) {
        receiptBins.set(skuId, binId);
      }
    }

    const { created, receipt } = await this.dataSource.transaction(async (manager) => {
      // 补货采购（订单页发起）：按 SKU×仓 缺口守卫，而不是按订单行链接。
      // 同一 (sku, warehouse) 的并发创建用 advisory lock 串行化，锁内重算缺口，
      // 避免两人同时各买一份（2026-10-21）。
      if ((dto.purpose ?? 'STOCK') === 'REPLENISH') {
        for (const item of dto.items) {
          await this.assertReplenishGap(manager, item, dto.receivingWarehouseId);
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
          receivingWarehouseId: dto.receivingWarehouseId,
        },
        dto.items.map((item) => ({
          skuId: item.skuId,
          orderItemId: null,
          quantity: formatQty(parseQty(item.quantity)),
          unitCost: item.unitCost ?? null,
          remark: item.remark ?? null,
        })),
      );
      const receipt = dto.receipt
        ? await this.createReceiptDraft(
            manager,
            created,
            dto.receivingWarehouseId,
            receiptBins,
            operator,
          )
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
    if (dto.receivingWarehouseId !== undefined) {
      if ((await this.warehouseService.getEntityById(dto.receivingWarehouseId)) === null) {
        throw new WarehouseNotFoundError(dto.receivingWarehouseId);
      }
      // 已发生收货的采购单不允许改目标仓（库存事实已经落在原仓）。
      const receipts = await this.receiptRepository.findActiveByPurchaseOrderId(id);
      if (receipts.some((row) => row.status !== 'CANCELLED')) {
        throw new PurchaseOrderInvalidStateError('采购单已发生收货，不能修改目标仓', {
          poNo: existing.poNo,
          receivingWarehouseId: existing.receivingWarehouseId,
        });
      }
    }

    const before = this.snapshot(existing);
    await this.dataSource.transaction(async (manager) => {
      const patch: Partial<PurchaseOrderEntity> = {};
      if (dto.supplierId !== undefined) patch.supplierId = dto.supplierId;
      if (dto.sourceNote !== undefined) patch.sourceNote = dto.sourceNote?.trim() || null;
      if (dto.expectedAt !== undefined) patch.expectedAt = dto.expectedAt ?? null;
      if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
      if (dto.receivingWarehouseId !== undefined) {
        patch.receivingWarehouseId = dto.receivingWarehouseId;
      }
      if (Object.keys(patch).length > 0) {
        await this.repository.updateHeader(manager, id, patch);
      }
      if (dto.items !== undefined) {
        // 2026-10-21：采购不再挂订单行，旧的「同一订单行重复登记」守卫已移除；
        // 补采购的准入由 SKU×仓 缺口在创建时判定。
        await this.repository.replaceItems(
          manager,
          id,
          dto.items.map((item) => ({
            skuId: item.skuId,
            orderItemId: null,
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
        closedQuantity: row.closedQuantity,
        createdAt: row.order.createdAt,
        updatedAt: row.order.updatedAt,
      })),
      meta: { page, pageSize, total },
    };
  }

  /**
   * 短装结案（2026-11-03，用户批准）：把「供应商不再发货」的剩余数量关掉。
   *
   * 为什么必须有：部分收货本身已支持，但少发且不再补时没有任何出口——采购单
   * 永久停在 PARTIALLY_RECEIVED，剩余数量永久计入在途，缺口被虚覆盖，
   * 补货采购被 `PURCHASE_SKU_GAP_COVERED` 拒绝，订单缺货永远补不上。
   *
   * 硬性边界：
   * - **不是收货**：只写 `closed_quantity`，不写 `received_quantity`、不产生
   *   库存流水、不动移动加权成本（AGENTS §10/§14）；
   * - 允许**部分关闭**（关 1 件、留 1 件继续等货）；
   * - 必须填原因，写操作日志与行上 `close_reason`（§39 可追溯）；
   * - 该采购单还有未取消的草稿时不结案（草稿可能就是这批货，先处理草稿，
   *   否则草稿确认时会因超收被拒，体验更差）；
   * - 并发兜底在 SQL：`closed + qty <= quantity - received`，超额返回空集。
   */
  async closeRemaining(
    poId: string,
    request: CloseRemainingRequestDto,
    operator: OperatorContext,
  ): Promise<CloseRemainingResultDto> {
    const reason = request.reason.trim();
    if (reason === '') {
      throw new PurchaseOrderInvalidStateError('请填写结案原因（供应商不再发货/少发/缺货）', {
        poId,
      });
    }

    return this.dataSource.transaction(async (manager) => {
      // 锁采购单头，串行化并发结案/收货/取消。
      const locked = await manager.query<Array<{ status: string; po_no: string }>>(
        `SELECT status, po_no FROM purchase_orders WHERE id = $1 FOR UPDATE`,
        [poId],
      );
      const header = locked[0];
      if (header === undefined) {
        throw new PurchaseOrderNotFoundError(poId);
      }
      if (header.status === 'CANCELLED') {
        throw new PurchaseOrderInvalidStateError('采购单已取消，不能结案未收数量', { poId });
      }

      // 有未取消草稿时先处理草稿：否则草稿确认会撞超收守卫。
      const activeReceipts = await this.receiptRepository.findActiveByPurchaseOrderId(poId);
      const draft = activeReceipts.find((receipt) => receipt.status === 'DRAFT');
      if (draft !== undefined) {
        throw new PurchaseReceiptDuplicateDraftError(header.po_no, draft.receiptNo);
      }

      const rows = await manager.query<
        Array<{
          id: string;
          sku_code: string;
          quantity: string;
          received_quantity: string;
          closed_quantity: string;
        }>
      >(
        `SELECT i.id, sk.sku_code, i.quantity, i.received_quantity, i.closed_quantity
           FROM purchase_order_items i
           JOIN skus sk ON sk.id = i.sku_id
          WHERE i.po_id = $1
          ORDER BY i.created_at, i.id
          FOR UPDATE OF i`,
        [poId],
      );

      const byId = new Map(rows.map((row) => [row.id, row]));
      const requested =
        request.items ?? rows.map((row) => ({ itemId: row.id, quantity: undefined }));
      for (const entry of requested) {
        if (!byId.has(entry.itemId)) {
          throw new PurchaseOrderInvalidStateError('明细不属于该采购单', { itemId: entry.itemId });
        }
      }

      const closed: CloseRemainingResultDto['items'] = [];
      let totalClosed = 0n;
      for (const entry of requested) {
        const row = byId.get(entry.itemId);
        if (row === undefined) {
          continue;
        }
        const before = remainingOf({
          quantity: row.quantity,
          receivedQuantity: row.received_quantity,
          closedQuantity: row.closed_quantity,
        });
        if (before <= 0n) {
          continue; // 已收完/已结案：静默跳过（整单结案的常见形态）
        }
        const target = entry.quantity === undefined ? before : parseQty(entry.quantity);
        if (target <= 0n) {
          throw new PurchaseOrderInvalidStateError('结案数量必须为正数', { itemId: row.id });
        }
        if (target > before) {
          throw new PurchaseOrderInvalidStateError(
            `结案数量超过未收数量（未收 ${formatQty(before)}，本次 ${formatQty(target)}）`,
            { itemId: row.id, remaining: formatQty(before) },
          );
        }
        const affected = await this.repository.closeRemaining(
          manager,
          row.id,
          formatQty(target),
          reason.slice(0, 500),
          operator.userId,
        );
        if (affected === 0) {
          throw new PurchaseOrderInvalidStateError(
            '结案失败：该行数量已被并发修改（收货或另一次结案），请刷新后重试',
            { itemId: row.id },
          );
        }
        totalClosed += target;
        closed.push({
          itemId: row.id,
          skuCode: row.sku_code,
          closedQuantity: formatQty(target),
          remainingQuantity: formatQty(before - target),
        });
      }

      if (closed.length === 0) {
        throw new PurchaseOrderInvalidStateError('没有可结案的未收数量（全部已收或已结案）', {
          poId,
        });
      }

      const nextStatus = await this.repository.recomputeStatus(manager, poId);
      await this.repository.updateHeader(manager, poId, {
        status: nextStatus as PurchaseOrderEntity['status'],
      });

      await this.operationLog.record({
        entityType: ENTITY_TYPE,
        entityId: poId,
        entityCode: header.po_no,
        action: 'CLOSE_REMAINING',
        changes: {
          closedQuantity: { from: null, to: formatQty(totalClosed) },
          status: { from: header.status, to: nextStatus },
        },
        operator,
      });

      return {
        poNo: header.po_no,
        status: nextStatus,
        totalClosed: formatQty(totalClosed),
        items: closed,
      };
    });
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
    // 展开明细的 SKU 图片（2026-10-24 用户需求）：一次批量取主图 + 一次签名。
    const images = await this.skuImageService.primaryUrlsBySkuIds(
      items.map((row) => row.item.skuId),
    );
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
        closedQuantity: row.item.closedQuantity,
        closedAt: null,
        closeReason: null,
        remark: row.item.remark,
        imageUrl: images.get(row.item.skuId) ?? null,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Order-module port (2026-10-21): SKU×仓 采购覆盖（不再按订单行链接）
  // --------------------------------------------------------------------------

  async getCoverageByOrderItemIds(
    orderItemIds: readonly string[],
  ): Promise<Record<string, OrderItemProcurementCoverage>> {
    return this.coverageService.getCoverageByOrderItemIds(orderItemIds);
  }

  async listCoveredItemIds(): Promise<string[]> {
    return this.coverageService.listCoveredItemIds();
  }

  async listShortItemIds(): Promise<string[]> {
    return this.coverageService.listShortItemIds();
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
    warehouseId: string,
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
        // 用创建入参而不是 po.receivingWarehouseId：实体字段已允许历史 NULL，
        // 这里必须是本次新建单明确选择的仓。
        warehouseId,
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
    }
  }

  /**
   * 补货采购（REPLENISH）的准入：按 SKU×仓 缺口判断，不看订单行链接。
   * 锁内重算，防止并发各买一份；数量不得超过缺口。
   */
  private async assertReplenishGap(
    manager: EntityManager,
    item: PurchaseOrderItemInputDto,
    warehouseId: string,
  ): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `po-gap:${item.skuId}:${warehouseId}`,
    ]);
    const gap = await this.coverageService.getWarehouseGap(item.skuId, warehouseId, manager);
    if (parseQty(gap.gapQty) <= 0n) {
      throw new PurchaseSkuGapCoveredError({
        skuId: item.skuId,
        warehouseId,
        demandQty: gap.demandQty,
        inTransitQty: gap.inTransitQty,
      });
    }
    if (parseQty(item.quantity) > parseQty(gap.gapQty)) {
      throw new PurchaseOrderInvalidStateError(
        `补货数量 ${item.quantity} 超过当前缺口 ${gap.gapQty}（需求 ${gap.demandQty} − 在途 ${gap.inTransitQty}）`,
        { skuId: item.skuId, warehouseId, gapQty: gap.gapQty },
      );
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
      receivingWarehouseId: order.receivingWarehouseId,
    };
  }
}
