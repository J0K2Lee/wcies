import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { SkuService } from '../../product/services/sku.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { InventoryService } from '../../inventory/services/inventory.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import { PurchaseReceiptEntity } from '../entities/purchase-receipt.entity';
import {
  PurchaseReceiptConfirmResultDto,
  PurchaseReceiptDetailDto,
  PurchaseReceiptItemInputDto,
  PurchaseReceiptListItemDto,
  PurchaseReceiptListQueryDto,
  CreatePurchaseReceiptRequestDto,
  UpdatePurchaseReceiptRequestDto,
  GenerateReceiptFromPoBatchItemResultDto,
  GenerateReceiptsFromPosRequestDto,
  GenerateReceiptsFromPosResultDto,
} from '../dto/purchase-receipt.dto';
import {
  PurchaseBatchDeleteItemResultDto,
  PurchaseBatchDeleteResultDto,
} from '../dto/purchase-batch-delete.dto';
import {
  PurchaseBatchConfirmItemResultDto,
  PurchaseBatchConfirmResultDto,
} from '../dto/purchase-batch-confirm.dto';
import {
  PurchaseReceiptRepository,
  PurchaseReceiptListFilters,
} from '../repositories/purchase-receipt.repository';
import { PurchaseOrderRepository } from '../repositories/purchase-order.repository';
import {
  PurchaseOrderInvalidStateError,
  PurchaseOrderWarehouseMissingError,
  PurchaseOrderNotFoundError,
  PurchaseReceiptDuplicateDraftError,
  PurchaseReceiptEmptyError,
  PurchaseReceiptExceedsOrderedError,
  PurchaseReceiptInvalidStateError,
  PurchaseReceiptNotFoundError,
  PurchaseReceiptWarehouseMismatchError,
  SupplierNotFoundError,
} from '../errors/purchase-errors';
import { SupplierService } from './supplier.service';
import { offsetOf } from '../../../common/dto/pagination.dto';
import { DomainError } from '../../../common/errors/domain.error';

const ENTITY_TYPE = 'PURCHASE_RECEIPT';

/**
 * Purchase receipts (Sprint 7 task §11): the REAL receiving action that
 * turns purchased goods into stock facts. Confirmation books every line
 * through InventoryService.receiveStockInTx inside ONE transaction - this
 * module never writes inventory_balances itself (AGENTS.md §10).
 */
@Injectable()
export class PurchaseReceiptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: PurchaseReceiptRepository,
    private readonly poRepository: PurchaseOrderRepository,
    private readonly supplierService: SupplierService,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly warehouseBinService: WarehouseBinService,
    private readonly inventoryService: InventoryService,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  // --------------------------------------------------------------------------
  // Create / update / cancel (DRAFT stage)
  // --------------------------------------------------------------------------

  async create(
    dto: CreatePurchaseReceiptRequestDto,
    operator: OperatorContext,
  ): Promise<PurchaseReceiptDetailDto> {
    const header = await this.resolveHeaderRefs(dto);
    await this.assertItemsValid(dto.items);

    // 未指定库位的行按 §4.1.1 预填默认库位（决策 0021）：与从采购单生成同源。
    // 事务外解析（自动建暂存位会写库位与日志，不能挂在本事务的 manager 上）。
    const defaultBins = await this.resolveDefaultReceiptBins(
      dto.warehouseId,
      undefined,
      dto.items.filter((item) => item.binId === undefined).map((item) => item.skuId),
      operator,
    );

    const created = await this.dataSource.transaction(async (manager) => {
      const receiptNo = await this.businessCode.nextPurchaseReceiptNo();
      return this.repository.insertWithItems(
        manager,
        {
          receiptNo,
          purchaseOrderId: header.purchaseOrderId,
          supplierId: header.supplierId,
          sourceNote: dto.sourceNote?.trim() || null,
          warehouseId: dto.warehouseId,
          status: 'DRAFT',
          remark: dto.remark ?? null,
          createdBy: operator.userId,
        },
        dto.items.map((item) =>
          item.binId === undefined
            ? { ...this.toItemRow(item), binId: defaultBins.get(item.skuId) ?? null }
            : this.toItemRow(item),
        ),
      );
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: created.receiptNo,
      action: 'CREATE',
      changes: {
        receiptNo: { from: null, to: created.receiptNo },
        warehouseId: { from: null, to: created.warehouseId },
        itemCount: { from: null, to: dto.items.length },
      },
      operator,
    });
    return this.getDetail(created.id);
  }

  /** One-click prefill from a purchase order (task §T4.4). */
  async generateFromPo(
    poId: string,
    dto: { warehouseId?: string; defaultBinId?: string },
    operator: OperatorContext,
  ): Promise<PurchaseReceiptDetailDto> {
    const po = await this.poRepository.findById(poId);
    if (po === null) {
      throw new PurchaseOrderNotFoundError(poId);
    }
    if (po.status === 'CANCELLED') {
      throw new PurchaseOrderInvalidStateError('采购单已取消，不能生成收货单', {
        poNo: po.poNo,
        status: po.status,
      });
    }
    // 防重复草稿（决策 0021）：同一 PO 已有未取消的收货单时拒绝再生成。
    // 两张按同一未收数量预填的草稿先后确认会把 received_quantity 累加超量；
    // 引导操作者去编辑确认已有那张，而不是新开一张。
    const existing = await this.repository.findActiveByPurchaseOrderId(poId);
    const existingDraft = existing.find((row) => row.status === 'DRAFT');
    if (existingDraft !== undefined) {
      throw new PurchaseReceiptDuplicateDraftError(po.poNo, existingDraft.receiptNo);
    }
    // 收货仓 = 采购单目标仓（2026-10-21 决策 0023）。采购单在创建时就必须写明
    // 送到哪个仓，收货单不允许落到别的仓——否则「SKU×仓缺口」的补货闭环会被
    // 绕过去（货到了 A 仓，缺货却发生在 B 仓）。
    const poWarehouseId = po.receivingWarehouseId;
    if (poWarehouseId === null) {
      throw new PurchaseOrderWarehouseMissingError(po.poNo);
    }
    if (dto.warehouseId !== undefined && dto.warehouseId !== poWarehouseId) {
      throw new PurchaseReceiptWarehouseMismatchError({
        poNo: po.poNo,
        expectedWarehouseId: poWarehouseId,
        actualWarehouseId: dto.warehouseId,
      });
    }
    const warehouseId = poWarehouseId;
    await this.assertWarehouseExists(warehouseId);

    const items = (await this.poRepository.findItemsWithRefs(poId))
      .map((row) => ({
        item: row.item,
        // 2026-11-03：剩余 = 订购 − 已收 − 短装结案（结案部分不会再发货）。
        remaining:
          parseQty(row.item.quantity) -
          parseQty(row.item.receivedQuantity) -
          parseQty(row.item.closedQuantity ?? '0'),
      }))
      .filter(({ remaining }) => remaining > 0n);
    if (items.length === 0) {
      throw new PurchaseOrderInvalidStateError('采购单全部明细已收货，没有可收数量', {
        poNo: po.poNo,
        status: po.status,
      });
    }

    // 默认收货库位（决策 0021）：逐行取该 SKU 在本仓的现存货位；没有则用暂存位
    // （ST 区不存在时自动创建一次，全部无货 SKU 共用）。显式传入的 defaultBinId
    // 覆盖全部行（保留原契约）。都只是预填，操作者可在草稿里逐行改。
    const binForSku = await this.resolveDefaultReceiptBins(
      warehouseId,
      dto.defaultBinId,
      items.map(({ item }) => item.skuId),
      operator,
    );

    const created = await this.dataSource.transaction(async (manager) => {
      const receiptNo = await this.businessCode.nextPurchaseReceiptNo();
      return this.repository.insertWithItems(
        manager,
        {
          receiptNo,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          sourceNote: po.sourceNote,
          warehouseId,
          status: 'DRAFT',
          remark: `从采购单 ${po.poNo} 生成`,
          createdBy: operator.userId,
        },
        items.map(({ item, remaining }) => ({
          purchaseOrderItemId: item.id,
          skuId: item.skuId,
          quantity: formatQty(remaining),
          unitCost: item.unitCost,
          binId: binForSku.get(item.skuId) ?? null,
          serialNumbers: null,
          remark: null,
        })),
      );
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: created.receiptNo,
      action: 'CREATE',
      changes: {
        receiptNo: { from: null, to: created.receiptNo },
        generatedFrom: { from: null, to: po.poNo },
      },
      operator,
    });
    return this.getDetail(created.id);
  }

  /**
   * 批量生成收货单草稿（采购单页多选, 2026-10-13）：逐单复用 generateFromPo
   * （草稿不碰库存，确认收货才入库），单笔失败只记录结果、不拖垮整批
   * （AGENTS §36）。仓库固定为各采购单的目标仓（2026-10-21）。
   */
  async generateFromPosBatch(
    dto: GenerateReceiptsFromPosRequestDto,
    operator: OperatorContext,
  ): Promise<GenerateReceiptsFromPosResultDto> {
    const results: GenerateReceiptFromPoBatchItemResultDto[] = [];
    for (const item of dto.items) {
      const po = await this.poRepository.findById(item.poId);
      try {
        const receipt = await this.generateFromPo(
          item.poId,
          { warehouseId: item.warehouseId },
          operator,
        );
        results.push({
          poId: item.poId,
          poNo: po?.poNo ?? null,
          ok: true,
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo,
          code: null,
          message: null,
        });
      } catch (error: unknown) {
        results.push({
          poId: item.poId,
          poNo: po?.poNo ?? null,
          ok: false,
          receiptId: null,
          receiptNo: null,
          code: error instanceof DomainError ? error.code : 'PURCHASE_RECEIPT_GENERATE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  /** DRAFT-only edits; RECEIVED quantities are frozen (§4.2). */
  async update(
    id: string,
    dto: UpdatePurchaseReceiptRequestDto,
    operator: OperatorContext,
  ): Promise<PurchaseReceiptDetailDto> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== 'DRAFT') {
      throw new PurchaseReceiptInvalidStateError(
        `收货单状态 ${existing.status} 不允许修改（库存已入账，修正走库存调整）`,
        { receiptNo: existing.receiptNo, status: existing.status },
      );
    }
    if (dto.supplierId !== undefined && dto.supplierId !== null) {
      if ((await this.supplierService.getEntityById(dto.supplierId)) === null) {
        throw new SupplierNotFoundError(dto.supplierId);
      }
    }
    if (dto.items !== undefined) {
      await this.assertItemsValid(dto.items);
    }

    await this.dataSource.transaction(async (manager) => {
      const patch: Partial<PurchaseReceiptEntity> = {};
      if (dto.supplierId !== undefined) patch.supplierId = dto.supplierId;
      if (dto.sourceNote !== undefined) patch.sourceNote = dto.sourceNote?.trim() || null;
      if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
      if (Object.keys(patch).length > 0) {
        await this.repository.updateHeader(manager, id, patch);
      }
      if (dto.items !== undefined) {
        await this.repository.replaceItems(
          manager,
          id,
          dto.items.map((item) => this.toItemRow(item)),
        );
      }
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.receiptNo,
      action: 'UPDATE',
      changes: { items: { from: null, to: dto.items?.length ?? null } },
      operator,
    });
    return this.getDetail(id);
  }

  async cancel(id: string, operator: OperatorContext): Promise<PurchaseReceiptDetailDto> {
    const existing = await this.findOrThrow(id);
    if (existing.status === 'CANCELLED') {
      return this.getDetail(id);
    }
    if (existing.status !== 'DRAFT') {
      throw new PurchaseReceiptInvalidStateError(
        `收货单已确认（${existing.status}），库存事实不可撤销`,
        { receiptNo: existing.receiptNo, status: existing.status },
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await this.repository.updateHeader(manager, id, { status: 'CANCELLED' });
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.receiptNo,
      action: 'CANCEL',
      changes: { status: { from: existing.status, to: 'CANCELLED' } },
      operator,
    });
    return this.getDetail(id);
  }

  /**
   * 批量删除收货单（用户指示 2026-10-17）：物理删除，但只允许删除从未入库的
   * 单据（`DRAFT` / `CANCELLED`）。已确认的 `RECEIVED` 拒绝——它已产生库存
   * 流水，删除会让账实失去凭证（AGENTS §14/§39）。
   *
   * 逐笔独立失败隔离；删除前写操作日志。
   */
  async deleteBatch(
    ids: string[],
    operator: OperatorContext,
  ): Promise<PurchaseBatchDeleteResultDto> {
    const results: PurchaseBatchDeleteItemResultDto[] = [];
    for (const id of new Set(ids)) {
      const receipt = await this.repository.findById(id);
      try {
        if (receipt === null) {
          throw new PurchaseReceiptNotFoundError(id);
        }
        await this.dataSource.transaction(async (manager) => {
          const lockedStatus = await this.repository.lockStatusInTx(manager, id);
          if (lockedStatus === null) {
            throw new PurchaseReceiptNotFoundError(id);
          }
          if (lockedStatus === 'RECEIVED') {
            throw new PurchaseReceiptInvalidStateError(
              `收货单已确认入库（${receipt.receiptNo}），库存事实不可撤销，不能删除`,
              { receiptNo: receipt.receiptNo, status: lockedStatus },
            );
          }
          const deleted = await this.repository.deleteIfUnreceived(manager, id);
          if (!deleted) {
            throw new PurchaseReceiptInvalidStateError('收货单状态不允许删除', {
              receiptNo: receipt.receiptNo,
              status: lockedStatus,
            });
          }
        });
        await this.operationLog.record({
          entityType: ENTITY_TYPE,
          entityId: id,
          entityCode: receipt.receiptNo,
          action: 'DELETE',
          changes: {
            receiptNo: { from: receipt.receiptNo, to: null },
            status: { from: receipt.status, to: null },
            batchDelete: { from: null, to: true },
          },
          operator,
        });
        results.push({ id, code: receipt.receiptNo, ok: true, errorCode: null, message: null });
      } catch (error: unknown) {
        results.push({
          id,
          code: receipt?.receiptNo ?? null,
          ok: false,
          errorCode: error instanceof DomainError ? error.code : 'PURCHASE_RECEIPT_DELETE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  /**
   * 批量收货（用户需求 2026-10-20）：逐笔复用 `confirm()`，不另写库存逻辑。
   *
   * 每张单仍是**独立事务**（整单入账或整单回滚），超收校验、采购单已收数量
   * 累加、移动平均成本、提交后库存事件广播全部沿用单笔规则。单笔失败只记录
   * 结果、不拖垮整批（与批量删除/批量外部履约同约定，AGENTS §36）；已确认的
   * 单据由 `confirm()` 幂等重放并标记 `idempotentReplay`，绝不重复入账。
   */
  async confirmBatch(
    ids: string[],
    operator: OperatorContext,
  ): Promise<PurchaseBatchConfirmResultDto> {
    const results: PurchaseBatchConfirmItemResultDto[] = [];
    for (const id of new Set(ids)) {
      const receipt = await this.repository.findById(id);
      try {
        const outcome = await this.confirm(id, operator);
        results.push({
          id,
          code: outcome.receiptNo ?? receipt?.receiptNo ?? null,
          ok: true,
          errorCode: null,
          message: null,
          idempotentReplay: outcome.idempotentReplay === true,
        });
      } catch (error: unknown) {
        results.push({
          id,
          code: receipt?.receiptNo ?? null,
          ok: false,
          errorCode: error instanceof DomainError ? error.code : 'PURCHASE_RECEIPT_CONFIRM_FAILED',
          message: error instanceof Error ? error.message : String(error),
          idempotentReplay: false,
        });
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  // --------------------------------------------------------------------------
  // Confirm - the core receiving action (task §T4.2)
  // --------------------------------------------------------------------------

  /**
   * ONE database transaction: every line books through
   * InventoryService.receiveStockInTx (reference PURCHASE_RECEIPT,
   * idempotency key PURCHASE_RECEIPT:<receiptId>:<itemId>), PO items
   * accrue received_quantity, source PO status recomputes, and the
   * moving-average cost updates for lines carrying unit_cost. Any failure
   * rolls the whole receipt back - no half-booked documents exist.
   */
  async confirm(
    receiptId: string,
    operator: OperatorContext,
  ): Promise<PurchaseReceiptConfirmResultDto> {
    const receipt = await this.findOrThrow(receiptId);
    if (receipt.status === 'RECEIVED') {
      // Idempotent repeat: already booked, never re-enter stock (§4.3).
      return { ...(await this.getDetail(receiptId)), idempotentReplay: true };
    }
    if (receipt.status !== 'DRAFT') {
      throw new PurchaseReceiptInvalidStateError(`收货单状态 ${receipt.status} 不能确认`, {
        receiptNo: receipt.receiptNo,
        status: receipt.status,
      });
    }
    await this.assertWarehouseExists(receipt.warehouseId);
    const items = await this.repository.findItemsWithRefs(receiptId);
    if (items.length === 0) {
      throw new PurchaseReceiptEmptyError(receiptId);
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const touchedPoIds = new Set<string>();
    // 库存增加事件在**提交后**广播（2026-10-17 修复：事务内广播时，新建的余额行
    // 对监听器的独立连接不可见，会误判库存不足 → 收货后不自动分配）。
    const increasedSkus = new Set<string>();
    try {
      // Status re-check under the row lock: a concurrent confirm of the same
      // receipt serializes here instead of double-booking.
      const locked = await this.repository.lockById(runner, receiptId);
      if (locked === null) {
        throw new PurchaseReceiptNotFoundError(receiptId);
      }
      if (locked.status !== 'DRAFT') {
        throw new PurchaseReceiptInvalidStateError(
          `收货单状态 ${locked.status} 不能确认（并发确认已被另一请求完成）`,
          { receiptNo: locked.receiptNo, status: locked.status },
        );
      }

      for (const { item } of items) {
        // 超收防御（决策 0021）：本次数量不得超过来源采购明细的未收数量。
        // 生成侧防重已挡住常规重复，这里兜住历史/并发草稿，给出明确错误而不是
        // 撞 DB CHECK 后回落成 500。读取在锁内，与 accrued 累加同一事务视图。
        if (item.purchaseOrderItemId !== null) {
          const poItem = await this.repository.findPoItemRemainingInTx(
            runner,
            item.purchaseOrderItemId,
          );
          if (poItem !== null) {
            // 2026-11-03：超收守卫同样扣除已结案数量。
            const remaining =
              parseQty(poItem.quantity) -
              parseQty(poItem.receivedQuantity) -
              parseQty(poItem.closedQuantity ?? '0');
            if (parseQty(item.quantity) > remaining) {
              throw new PurchaseReceiptExceedsOrderedError({
                skuCode: poItem.skuCode,
                orderedQty: poItem.quantity,
                receivedQty: poItem.receivedQuantity,
                attemptedQty: item.quantity,
              });
            }
          }
        }
        const outcome = await this.inventoryService.receiveStockInTx(runner, {
          skuId: item.skuId,
          warehouseId: receipt.warehouseId,
          binId: item.binId,
          condition: 'SELLABLE',
          quantity: item.quantity,
          serialNumbers: item.serialNumbers ?? undefined,
          referenceType: 'PURCHASE_RECEIPT',
          referenceId: receipt.id,
          idempotencyKey: `PURCHASE_RECEIPT:${receipt.id}:${item.id}`,
          remark: `receipt=${receipt.receiptNo}`,
          operator,
        });

        if (outcome.wrote) {
          increasedSkus.add(item.skuId);
          if (item.purchaseOrderItemId !== null) {
            await this.repository.accruePoItemReceived(
              runner,
              item.purchaseOrderItemId,
              item.quantity,
            );
            const poItem = (await runner.query(
              `SELECT po_id FROM purchase_order_items WHERE id = $1`,
              [item.purchaseOrderItemId],
            )) as unknown as { po_id: string }[];
            if (poItem[0] !== undefined) {
              touchedPoIds.add(poItem[0].po_id);
            }
          }
          if (item.unitCost !== null) {
            // Moving average (decision 0013 §6): weighted against the SKU's
            // total on-hand INCLUDING this line (same transaction view).
            const totalOnHand = await this.inventoryQuery.getTotalOnHandInTx(runner, item.skuId);
            await this.skuService.applyMovingAverageCostInTx(runner.manager, {
              skuId: item.skuId,
              receivedQty: item.quantity,
              unitCost: item.unitCost,
              totalOnHand,
            });
            // 最近采购价（2026-11-09 用户口径）：收货确认时用本次单价覆盖，
            // 是快照不是加权；草稿/未收货不写。
            await this.skuService.setLatestPurchasePriceInTx(
              runner.manager,
              item.skuId,
              item.unitCost,
            );
          }
        }
      }

      await this.repository.updateHeader(runner.manager, receiptId, {
        status: 'RECEIVED',
        receivedAt: new Date(),
      });

      // Source POs roll forward: ORDERED -> PARTIALLY_RECEIVED -> RECEIVED.
      for (const poId of touchedPoIds) {
        const nextStatus = await this.poRepository.recomputeStatus(runner.manager, poId);
        await this.poRepository.updateHeader(runner.manager, poId, {
          status: nextStatus as PurchaseOrderEntity['status'],
        });
      }

      await runner.commitTransaction();
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    // 提交后再广播：此时余额行已可见，缺货订单行才能被自动分配。
    for (const skuId of increasedSkus) {
      this.inventoryService.emitStockIncreased({
        skuId,
        warehouseId: receipt.warehouseId,
        eventType: 'RECEIVE',
      });
    }

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: receipt.id,
      entityCode: receipt.receiptNo,
      action: 'CONFIRM',
      changes: {
        status: { from: 'DRAFT', to: 'RECEIVED' },
        itemCount: { from: null, to: items.length },
      },
      operator,
    });
    return { ...(await this.getDetail(receiptId)), idempotentReplay: false };
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async list(
    query: PurchaseReceiptListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: PurchaseReceiptListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const filters: PurchaseReceiptListFilters = {
      keyword: query.keyword?.trim() || undefined,
      status: query.status,
      warehouseId: query.warehouseId,
      purchaseOrderId: query.purchaseOrderId,
    };
    const { rows, total } = await this.repository.list(filters, pageSize, offsetOf(page, pageSize));
    return {
      items: rows.map((row) => ({
        id: row.receipt.id,
        receiptNo: row.receipt.receiptNo,
        purchaseOrderId: row.receipt.purchaseOrderId,
        purchaseOrderNo: row.purchaseOrderNo,
        supplierId: row.receipt.supplierId,
        supplierName: row.supplierName,
        sourceNote: row.receipt.sourceNote,
        warehouseId: row.receipt.warehouseId,
        warehouseCode: row.warehouseCode,
        status: row.receipt.status,
        receivedAt: row.receipt.receivedAt,
        itemCount: row.itemCount,
        totalQuantity: row.totalQuantity,
        firstItemSkuCode: row.firstItemSkuCode,
        firstItemName: row.firstItemName,
        firstItemQuantity: row.firstItemQuantity,
        createdAt: row.receipt.createdAt,
        updatedAt: row.receipt.updatedAt,
      })),
      meta: { page, pageSize, total },
    };
  }

  async getDetail(id: string): Promise<PurchaseReceiptDetailDto> {
    const receipt = await this.findOrThrow(id);
    const items = await this.repository.findItemsWithRefs(receipt.id);
    const poNo =
      receipt.purchaseOrderId === null
        ? null
        : ((await this.poRepository.findById(receipt.purchaseOrderId))?.poNo ?? null);
    return {
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      purchaseOrderId: receipt.purchaseOrderId,
      purchaseOrderNo: poNo,
      supplierId: receipt.supplierId,
      supplierName: null,
      sourceNote: receipt.sourceNote,
      warehouseId: receipt.warehouseId,
      warehouseCode: null,
      status: receipt.status,
      receivedAt: receipt.receivedAt,
      remark: receipt.remark,
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
      items: items.map((row) => ({
        id: row.item.id,
        skuId: row.item.skuId,
        skuCode: row.skuCode,
        skuName: row.skuName,
        purchaseOrderItemId: row.item.purchaseOrderItemId,
        quantity: row.item.quantity,
        unitCost: row.item.unitCost,
        binId: row.item.binId,
        binCode: row.binCode,
        serialNumbers: row.item.serialNumbers,
        remark: row.item.remark,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private toItemRow(item: PurchaseReceiptItemInputDto) {
    return {
      purchaseOrderItemId: item.purchaseOrderItemId ?? null,
      skuId: item.skuId,
      quantity: formatQty(parseQty(item.quantity)),
      unitCost: item.unitCost ?? null,
      binId: item.binId ?? null,
      serialNumbers: item.serialNumbers ?? null,
      remark: item.remark ?? null,
    };
  }

  private async resolveHeaderRefs(
    dto: CreatePurchaseReceiptRequestDto,
  ): Promise<{ purchaseOrderId: string | null; supplierId: string | null }> {
    await this.assertWarehouseExists(dto.warehouseId);
    let purchaseOrderId = dto.purchaseOrderId ?? null;
    if (purchaseOrderId !== null) {
      const po = await this.poRepository.findById(purchaseOrderId);
      if (po === null) {
        throw new PurchaseOrderNotFoundError(purchaseOrderId);
      }
      if (po.status === 'CANCELLED') {
        throw new PurchaseOrderInvalidStateError('采购单已取消，不能收货', {
          poNo: po.poNo,
          status: po.status,
        });
      }
    }
    // PO items imply their PO: keep the header link consistent automatically.
    if (purchaseOrderId === null) {
      for (const item of dto.items) {
        if (item.purchaseOrderItemId === undefined) {
          continue;
        }
        const row = (await this.dataSource.query(
          `SELECT po_id FROM purchase_order_items WHERE id = $1`,
          [item.purchaseOrderItemId],
        )) as unknown as { po_id: string }[];
        const first = row[0];
        if (first === undefined) {
          throw new PurchaseOrderNotFoundError(item.purchaseOrderItemId);
        }
        purchaseOrderId = first.po_id;
        break;
      }
    }
    let supplierId = dto.supplierId ?? null;
    if (dto.supplierId !== undefined) {
      if ((await this.supplierService.getEntityById(dto.supplierId)) === null) {
        throw new SupplierNotFoundError(dto.supplierId);
      }
    }
    if (supplierId === null && purchaseOrderId !== null) {
      supplierId = (await this.poRepository.findById(purchaseOrderId))?.supplierId ?? null;
    }
    return { purchaseOrderId, supplierId };
  }

  private async assertWarehouseExists(warehouseId: string): Promise<void> {
    if ((await this.warehouseService.getEntityById(warehouseId)) === null) {
      throw new WarehouseNotFoundError(warehouseId);
    }
  }

  /**
   * Per-SKU default receiving bin (决策 0021): each SKU goes to the bin it
   * currently sits in (largest SELLABLE on-hand); a SKU with no stock in the
   * warehouse falls back to the `ST` staging bin, auto-creating it once if
   * none exists. An explicit `defaultBinId` overrides every line (legacy
   * contract). Prefill only - the operator may change any line in the draft.
   *
   * Public so the PO-create-with-draft path shares the exact same defaults.
   */
  async resolveDefaultReceiptBins(
    warehouseId: string,
    explicitBinId: string | undefined,
    skuIds: string[],
    operator: OperatorContext,
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (skuIds.length === 0) {
      return map;
    }
    if (explicitBinId !== undefined && explicitBinId !== null) {
      for (const skuId of skuIds) {
        map.set(skuId, explicitBinId);
      }
      return map;
    }
    // Resolve the staging fallback lazily/at most once: warehouses holding no
    // bins at all keep binId null (inventory creates the virtual DEFAULT bin
    // on receive, so a staging bin there would be noise).
    let stagingBinId: string | null | undefined;
    const hasBins = (await this.warehouseBinService.countByWarehouse(warehouseId)) > 0;
    for (const skuId of skuIds) {
      const currentBinId = await this.inventoryQuery.findCurrentBinId(skuId, warehouseId);
      if (currentBinId !== null) {
        map.set(skuId, currentBinId);
        continue;
      }
      if (!hasBins) {
        map.set(skuId, null);
        continue;
      }
      if (stagingBinId === undefined) {
        stagingBinId = (
          await this.warehouseBinService.ensureReceiptStagingBin(warehouseId, operator)
        ).id;
      }
      map.set(skuId, stagingBinId);
    }
    return map;
  }

  private async assertItemsValid(items: PurchaseReceiptItemInputDto[]): Promise<void> {
    for (const item of items) {
      if ((await this.skuService.getEntityById(item.skuId)) === null) {
        throw new SkuNotFoundError(item.skuId);
      }
    }
  }

  private async findOrThrow(id: string): Promise<PurchaseReceiptEntity> {
    const receipt = await this.repository.findById(id);
    if (receipt === null) {
      throw new PurchaseReceiptNotFoundError(id);
    }
    return receipt;
  }
}
