import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { PickingCancelOutcome } from '../../order/ports/order-picking-state.port';
import { PickingOrderCancelledError } from '../errors/picking.errors';
import { orderReleaseKey } from '../../order/enums/order.constants';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { OrderService } from '../../order/services/order.service';
import { OrderInvalidStateError } from '../../order/errors/order.errors';
import { DomainError } from '../../../common/errors/domain.error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { formatQty, parseQty, qtyFromDb } from '../../../common/utils/quantity';
import { PickingTaskEntity } from '../entities/picking-task.entity';
import { PickingTaskItemEntity } from '../entities/picking-task-item.entity';
import {
  PickingTaskRepository,
  PickingTaskListFilters,
} from '../repositories/picking-task.repository';
import { PickingTaskItemRepository } from '../repositories/picking-task-item.repository';
import { OrderPickingStatePort } from '../../order/ports/order-picking-state.port';
import {
  PickingBarcodeNotFoundError,
  PickingBinNotFoundError,
  PickingIncompleteError,
  PickingItemNotCancellableError,
  PickingNoEligibleItemsError,
  PickingQuantityExceededError,
  PickingSerialInvalidError,
  PickingSerialRequiredError,
  PickingSkuMismatchError,
  PickingTaskNotFoundError,
  PickingTaskStateInvalidError,
} from '../errors/picking.errors';
import {
  PickingItemDto,
  PickingScanResultDto,
  PickingTaskDetailDto,
  PickingTaskListItemDto,
} from '../dto/picking.dto';

/**
 * Picking workflow (Sprint 3 task §28-§51; Sprint 4 P0 task §3-§5).
 *
 * Scan atomicity (Sprint 4 P0): each scan runs ONE database transaction that
 * locks the PickingTaskItem, performs the guarded picked_qty increment, moves
 * the stock through ReservationService.pickStockPartialInTx (the
 * transaction-aware Inventory public API) and flips the OrderItem to PICKED -
 * all rows commit or roll back TOGETHER. The Sprint 3 "increment first,
 * compensate on failure" pattern is gone: an inventory failure now rolls the
 * increment back with everything else. Inventory still owns every stock rule;
 * this service only owns the transaction boundary (task §5).
 */
@Injectable()
export class PickingService implements OrderPickingStatePort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly taskRepo: PickingTaskRepository,
    private readonly itemRepo: PickingTaskItemRepository,
    private readonly orderService: OrderService,
    private readonly barcodeService: BarcodeService,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly binService: WarehouseBinService,
    private readonly reservationService: ReservationService,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly operationLog: OperationLogService,
    private readonly logger: AppLoggerService,
  ) {}

  // --------------------------------------------------------------------------
  // Task creation (task §32-§34)
  // --------------------------------------------------------------------------

  /** Creates picking tasks from a READY_TO_PICK order, split per warehouse. */
  async createPickingTask(
    orderId: string,
    operator: OperatorContext,
  ): Promise<PickingTaskListItemDto[]> {
    const candidates = await this.orderService.listReservedItemsForPicking(orderId);
    if (candidates.length === 0) {
      throw new PickingNoEligibleItemsError({ orderId });
    }
    const order = candidates[0]!.order;
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，不能创建拣货任务', { orderId });
    }

    // 1 task = 1 warehouse (task §33).
    const byWarehouse = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const warehouseId = candidate.item.warehouseId;
      if (warehouseId === null) {
        throw new PickingTaskStateInvalidError('订单行缺少仓库信息，无法生成拣货任务', {
          orderItemId: candidate.item.id,
        });
      }
      const bucket = byWarehouse.get(warehouseId) ?? [];
      bucket.push(candidate);
      byWarehouse.set(warehouseId, bucket);
    }

    const createdTasks: PickingTaskEntity[] = [];
    for (const [warehouseId, bucket] of byWarehouse) {
      const task = await this.dataSource
        .transaction(async (runner) => {
          const pickingNo = await this.taskRepo.nextPickingNo(runner);
          const created = await this.taskRepo.insert(runner, {
            pickingNo,
            warehouseId,
            createdBy: operator.userId,
            createdByName: operator.username,
          });
          await this.itemRepo.insert(
            runner,
            bucket.map(({ item }) => ({
              pickingTaskId: created.id,
              orderId: item.orderId,
              orderItemId: item.id,
              skuId: item.skuId as string,
              reservationId: item.reservationId as string,
              requiredQty: item.quantity,
            })),
          );
          return created;
        })
        .catch((error: unknown) => {
          // 并发建任务时同一订单行被另一请求抢走（部分唯一索引兜底）。
          if (isPickingItemUniqueViolation(error)) {
            throw new PickingTaskStateInvalidError('该订单行已在其他拣货任务中（可能并发生成）', {
              orderId: orderId,
            });
          }
          throw error;
        });
      createdTasks.push(task);
      await this.operationLog.record({
        entityType: 'PICKING_TASK',
        entityId: task.id,
        entityCode: task.pickingNo,
        action: 'CREATE',
        changes: {
          warehouseId: { from: null, to: warehouseId },
          items: { from: null, to: bucket.length },
        },
        operator,
      });
    }

    return Promise.all(createdTasks.map((task) => this.toListItem(task.id)));
  }

  /**
   * 批量创建拣货任务（2026-09-18 用户指示；2026-10-13 多选改造；
   * 2026-10-15 合并语义修正：批量 = 一个任务含多个订单，按仓拆分）。
   *
   * 两种入口共用一条路径：
   * - 自动模式（省略 orderIds）：候选 = erpStatus READY_TO_PICK（可按店铺过滤）；
   * - 多选模式（orderIds 显式给定）：只处理勾选的订单，不存在的单按失败记录。
   *
   * 合并规则：把所有可拣订单的 RESERVED 行汇总后 **按仓库分组**，每个仓
   * 建一个任务（1 task = 1 warehouse 不变，task §33），任务内行保留各自的
   * orderId/orderItemId（picking_task_items 本就按订单行引用，一任务多
   * 订单是数据模型既定能力）。合并拣货一次巡回取齐多单，不再一单一任务。
   *
   * 已有进行中任务（CREATED/IN_PROGRESS 且含未拣行）的订单跳过——重复点击
   * 不会产生重复拣货行。单笔失败（域错误：订单不可读 / 无可拣行 / 行缺
   * 仓库）记录后继续，不拖垮整批（AGENTS §49 精神）；系统错误照常抛出。
   */
  async autoCreateForReadyOrders(
    operator: OperatorContext,
    options: { storeId?: string; limit: number; orderIds?: string[] },
  ): Promise<{
    candidates: number;
    created: number;
    createdOrders: number;
    itemsTotal: number;
    skipped: number;
    failed: number;
    createdTaskNos: string[];
    failures: Array<{ orderNo: string; code: string; message: string }>;
  }> {
    const failures: Array<{ orderNo: string; code: string; message: string }> = [];
    let skipped = 0;
    let failed = 0;

    let orders: Array<{ id: string; orderNo: string }>;
    if (options.orderIds !== undefined && options.orderIds.length > 0) {
      // 多选模式：逐单解析（去重），取不到的按失败记录而不是让整批 500。
      const seen = new Set<string>();
      orders = [];
      for (const orderId of options.orderIds) {
        if (seen.has(orderId)) {
          continue;
        }
        seen.add(orderId);
        try {
          const order = await this.orderService.getOrderOrThrow(orderId);
          orders.push({ id: order.id, orderNo: order.orderNo });
        } catch (error: unknown) {
          if (error instanceof DomainError) {
            failed += 1;
            failures.push({ orderNo: orderId, code: error.code, message: error.message });
            continue;
          }
          throw error;
        }
      }
    } else {
      orders = await this.orderService.listReadyToPickOrders(options);
    }

    // 逐单收集可拣行：已有进行中任务的跳过；无 RESERVED 行 / 行缺仓库的
    // 订单按失败记录，不拖垮整批。
    type PickingCandidate = Awaited<
      ReturnType<OrderService['listReservedItemsForPicking']>
    >[number];
    const eligible: Array<{ orderNo: string; item: PickingCandidate['item'] }> = [];
    for (const order of orders) {
      if ((await this.countActivePickingItems(order.id)) > 0) {
        skipped += 1;
        continue;
      }
      try {
        const candidates = await this.orderService.listReservedItemsForPicking(order.id);
        if (candidates.length === 0) {
          throw new PickingNoEligibleItemsError({ orderId: order.id });
        }
        for (const candidate of candidates) {
          if (candidate.item.warehouseId === null) {
            throw new PickingTaskStateInvalidError('订单行缺少仓库信息，无法生成拣货任务', {
              orderItemId: candidate.item.id,
            });
          }
          eligible.push({ orderNo: order.orderNo, item: candidate.item });
        }
      } catch (error: unknown) {
        if (error instanceof DomainError) {
          failed += 1;
          failures.push({ orderNo: order.orderNo, code: error.code, message: error.message });
          continue;
        }
        throw error;
      }
    }

    // 按仓库分组：每仓一个合并任务，任务内行跨订单。先按订单行去重——
    // 同一次请求里同一行重复出现（重复候选/并发回读）会直接撞唯一索引。
    const uniqueEligible = [...new Map(eligible.map((entry) => [entry.item.id, entry])).values()];
    const byWarehouse = new Map<string, typeof uniqueEligible>();
    for (const entry of uniqueEligible) {
      const warehouseId = entry.item.warehouseId as string;
      const bucket = byWarehouse.get(warehouseId) ?? [];
      bucket.push(entry);
      byWarehouse.set(warehouseId, bucket);
    }

    const createdTaskNos: string[] = [];
    const createdOrders = new Set<string>();
    for (const [warehouseId, bucket] of byWarehouse) {
      const task = await this.dataSource
        .transaction(async (runner) => {
          const pickingNo = await this.taskRepo.nextPickingNo(runner);
          const created_ = await this.taskRepo.insert(runner, {
            pickingNo,
            warehouseId,
            createdBy: operator.userId,
            createdByName: operator.username,
          });
          await this.itemRepo.insert(
            runner,
            bucket.map(({ item }) => ({
              pickingTaskId: created_.id,
              orderId: item.orderId,
              orderItemId: item.id,
              skuId: item.skuId as string,
              reservationId: item.reservationId as string,
              requiredQty: item.quantity,
            })),
          );
          return created_;
        })
        .catch((error: unknown) => {
          // 同一订单行被并发任务占用（部分唯一索引兜底）：本仓这批按失败记录，
          // 不拖垮其它仓库的任务（AGENTS §49 单笔失败不阻塞整批）。
          if (isPickingItemUniqueViolation(error)) {
            failed += bucket.length;
            for (const entry of bucket) {
              failures.push({
                orderNo: entry.orderNo,
                code: 'PICKING_ITEM_IN_ACTIVE_TASK',
                message: '该订单行已在其他拣货任务中（可能并发生成），请刷新后重试',
              });
            }
            return null;
          }
          throw error;
        });
      if (task === null) {
        continue;
      }
      createdTaskNos.push(task.pickingNo);
      for (const entry of bucket) {
        createdOrders.add(entry.item.orderId);
      }
      await this.operationLog.record({
        entityType: 'PICKING_TASK',
        entityId: task.id,
        entityCode: task.pickingNo,
        action: 'CREATE',
        changes: {
          warehouseId: { from: null, to: warehouseId },
          items: { from: null, to: bucket.length },
          orders: { from: null, to: createdOrders.size },
        },
        operator,
      });
    }

    this.logger.info('batch picking creation finished', {
      module: 'picking',
      candidates: orders.length,
      tasks: createdTaskNos.length,
      orders: createdOrders.size,
      items: uniqueEligible.length,
      skipped,
      failed,
    });
    return {
      candidates: orders.length,
      created: createdTaskNos.length,
      createdOrders: createdOrders.size,
      itemsTotal: eligible.length,
      skipped,
      failed,
      createdTaskNos,
      failures,
    };
  }

  async start(taskId: string, operator: OperatorContext): Promise<PickingTaskDetailDto> {
    const task = await this.getTaskOrThrow(taskId);
    if (task.status !== 'CREATED') {
      throw new PickingTaskStateInvalidError(`任务状态 ${task.status} 不允许开始`, {
        taskId,
        status: task.status,
      });
    }
    await this.dataSource.transaction(async (runner) => {
      await this.taskRepo.updateStatus(runner, taskId, {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        assignedTo: operator.userId,
        assignedToName: operator.username,
      });
    });
    await this.operationLog.record({
      entityType: 'PICKING_TASK',
      entityId: taskId,
      entityCode: task.pickingNo,
      action: 'START',
      changes: { status: { from: task.status, to: 'IN_PROGRESS' } },
      operator,
    });
    return this.getDetail(taskId);
  }

  async complete(taskId: string, operator: OperatorContext): Promise<PickingTaskDetailDto> {
    const task = await this.getTaskOrThrow(taskId);
    if (task.status !== 'IN_PROGRESS') {
      throw new PickingTaskStateInvalidError(`任务状态 ${task.status} 不允许完成`, {
        taskId,
        status: task.status,
      });
    }
    const pending = await this.itemRepo.countPendingOfTask(taskId);
    if (pending > 0) {
      throw new PickingIncompleteError({ pickingTaskId: taskId, pendingItems: pending });
    }
    await this.markTaskCompleted(task, operator);
    return this.getDetail(taskId);
  }

  // --------------------------------------------------------------------------
  // Scan workflow (task §35-§41)
  // --------------------------------------------------------------------------

  async scan(
    taskId: string,
    input: { barcode: string; serialNumber?: string; binBarcode?: string; itemId?: string },
    operator: OperatorContext,
  ): Promise<PickingScanResultDto> {
    const task = await this.getTaskOrThrow(taskId);
    if (task.status !== 'IN_PROGRESS') {
      throw new PickingTaskStateInvalidError(`任务状态 ${task.status} 不允许扫码（请先开始任务）`, {
        taskId,
        status: task.status,
      });
    }

    // 1. Barcode -> SKU, resolved by the BACKEND (task §35).
    const barcode = input.barcode.trim();
    const barcodeRow = await this.barcodeService.findByBarcode(barcode);
    if (barcodeRow === null) {
      throw new PickingBarcodeNotFoundError(barcode);
    }
    const sku = await this.skuService.getEntityById(barcodeRow.skuId);
    if (sku === null) {
      throw new PickingBarcodeNotFoundError(barcode);
    }

    // 2. Target item: explicit or the earliest PENDING line of that SKU.
    const items = await this.itemRepo.findByTaskId(taskId);
    let target: PickingTaskItemEntity | undefined;
    if (input.itemId !== undefined) {
      target = items.find((item) => item.id === input.itemId);
      if (target === undefined || target.status !== 'PENDING' || target.skuId !== sku.id) {
        throw new PickingSkuMismatchError({
          expectedSkuId: target?.skuId,
          scannedSkuId: sku.id,
          scannedBarcode: barcode,
        });
      }
    } else {
      target = items.find((item) => item.status === 'PENDING' && item.skuId === sku.id);
    }
    if (target === undefined) {
      // The SKU belongs to this task but every line of it is complete ->
      // over-scan (task §40), not a foreign SKU.
      const completed = items.find((item) => item.status === 'PICKED' && item.skuId === sku.id);
      if (completed !== undefined) {
        throw new PickingQuantityExceededError({
          pickingTaskItemId: completed.id,
          requiredQty: completed.requiredQty,
          pickedQty: completed.pickedQty,
        });
      }
      throw new PickingSkuMismatchError({ scannedSkuId: sku.id, scannedBarcode: barcode });
    }

    // 2b. 订单已取消 → 立即停手（2026-11-03）：覆盖「取消已落库、撤行还没执行」
    // 的窗口期。正常路径下未拣行已被置 CANCELLED，扫不到；这里是兜底。
    if (await this.orderService.isOrderCancelled(target.orderId)) {
      throw new PickingOrderCancelledError({
        orderNo: null,
        pickingTaskItemId: target.id,
      });
    }

    // 3. Serial / bin pre-validation (early, read-only).
    if (sku.serialTracking) {
      const serialNumber = input.serialNumber?.trim();
      if (serialNumber === undefined || serialNumber === '') {
        throw new PickingSerialRequiredError({ pickingTaskItemId: target.id });
      }
      const serials = await this.inventoryQuery.listReservationSerials(target.reservationId);
      const match = serials.find((entry) => entry.serialNumber === serialNumber);
      if (match === undefined || match.status !== 'RESERVED') {
        throw new PickingSerialInvalidError('SN 不属于该拣货行或状态不允许拣货', {
          serialNumber,
          reservationId: target.reservationId,
        });
      }
    } else if (input.serialNumber !== undefined && input.serialNumber.trim() !== '') {
      throw new PickingSerialInvalidError('该 SKU 未启用 SN 管理，无需序列号', {
        skuId: sku.id,
      });
    }
    if (input.binBarcode !== undefined && input.binBarcode.trim() !== '') {
      const bin = await this.binService.findByWarehouseAndCode(
        task.warehouseId,
        input.binBarcode.trim(),
      );
      if (bin === null) {
        throw new PickingBinNotFoundError({
          warehouseId: task.warehouseId,
          binBarcode: input.binBarcode.trim(),
        });
      }
    }

    // 4-5. Claim one unit AND move the stock in ONE transaction (Sprint 4 P0):
    // lock item -> guarded increment -> inventory Reserved->Picked on the SAME
    // runner -> OrderItem PICKED when the line completes. Any failure rolls
    // the whole command back.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let lineCompleted!: boolean;
    try {
      const locked = await this.itemRepo.lockById(runner, target.id);
      if (locked === null) {
        throw new PickingTaskStateInvalidError('拣货行不存在或已变更', {
          pickingTaskItemId: target.id,
        });
      }
      if (locked.status !== 'PENDING') {
        throw new PickingQuantityExceededError({
          pickingTaskItemId: locked.id,
          requiredQty: locked.requiredQty,
          pickedQty: locked.pickedQty,
        });
      }
      const incremented = await this.itemRepo.incrementPickedQtyTx(runner, target.id);
      if (incremented === null) {
        throw new PickingQuantityExceededError({
          pickingTaskItemId: target.id,
          requiredQty: locked.requiredQty,
          pickedQty: locked.pickedQty,
        });
      }
      lineCompleted = parseQty(incremented) === parseQty(locked.requiredQty);

      await this.reservationService.pickStockPartialInTx(runner, target.reservationId, {
        quantity: '1',
        serialNumbers: sku.serialTracking ? [input.serialNumber?.trim() as string] : undefined,
        pickingTaskItemId: target.id,
        operator,
        idempotencyKey: `PTI${target.id}#${incremented}`,
        remark: `picking=${task.pickingNo}`,
      });

      if (lineCompleted) {
        await this.orderService.markItemPickedInTx(runner.manager, target.orderItemId);
      }
      await runner.commitTransaction();
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      this.logger.warn(
        `picking scan rolled back taskId=${taskId} item=${target.id}: ${String(error)}`,
        'PickingService',
      );
      throw error;
    } finally {
      await runner.release();
    }

    // 6. Post-commit bookkeeping (rollup statuses only - never stock).
    const freshItem = (await this.itemRepo.findById(target.id)) as PickingTaskItemEntity;
    if (lineCompleted) {
      await this.orderService.recomputeAfterPick(target.orderItemId, operator);
    }
    const pending = await this.itemRepo.countPendingOfTask(taskId);
    if (pending === 0) {
      await this.markTaskCompleted(task, operator);
    }
    const refreshedTask = await this.getTaskOrThrow(taskId);
    return {
      taskId,
      itemId: target.id,
      pickedQty: freshItem.pickedQty,
      requiredQty: freshItem.requiredQty,
      itemStatus: freshItem.status,
      taskStatus: refreshedTask.status,
      serialNumber: sku.serialTracking ? (input.serialNumber?.trim() ?? null) : null,
      message:
        freshItem.status === 'PICKED'
          ? `该行拣货完成（${formatQty(qtyFromDb(freshItem.requiredQty))} 件）`
          : `扫码成功，已拣 ${formatQty(qtyFromDb(freshItem.pickedQty))} / ${formatQty(qtyFromDb(freshItem.requiredQty))}`,
    };
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async list(
    filters: PickingTaskListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: PickingTaskListItemDto[]; meta: PageMeta }> {
    const { rows, total } = await this.taskRepo.listWithAggregates(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => this.toListItemDto(row)),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getDetail(taskId: string): Promise<PickingTaskDetailDto> {
    const task = await this.getTaskOrThrow(taskId);
    const [warehouse, items] = await Promise.all([
      this.warehouseService.getEntityById(task.warehouseId),
      this.itemRepo.findByTaskId(taskId),
    ]);
    const orderIds = [...new Set(items.map((item) => item.orderId))];
    const orderNos = new Map<string, string>();
    for (const orderId of orderIds) {
      const detail = await this.orderService.getOrderOrThrow(orderId);
      orderNos.set(orderId, detail.orderNo);
    }
    const itemDtos = await Promise.all(items.map((item) => this.toItemDto(item, orderNos)));
    return {
      id: task.id,
      pickingNo: task.pickingNo,
      warehouseId: task.warehouseId,
      warehouseCode: warehouse?.warehouseCode ?? '',
      warehouseName: warehouse?.name ?? '',
      status: task.status,
      ordersCount: orderIds.length,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      items: itemDtos,
    };
  }

  // --------------------------------------------------------------------------
  // OrderPickingStatePort (used by the order status machine / cancel)
  // --------------------------------------------------------------------------

  async countActivePickingItems(orderId: string): Promise<number> {
    return this.itemRepo.countActivePickingItems(orderId);
  }

  async hasPickedProgress(orderId: string): Promise<boolean> {
    return this.itemRepo.hasPickedProgress(orderId);
  }

  /**
   * 订单取消：按行撤出拣货任务（2026-11-03，用户确认口径）。
   *
   * 关键语义：
   * - **已拣的全部进拦截**（行保持 PICKED 或返回给订单域生成拦截）；
   * - **剩余不再拣**：未拣行/部分拣行的未拣部分置 CANCELLED，并从预约释放；
   * - 合并任务只动该订单的行，同任务其他订单继续；任务删空才收口。
   *
   * 为什么需要 RELEASE_REMAINDER：部分拣的行 reserved 只剩未拣部分，整笔
   * RELEASE 会把它减成负数。整笔释放只用于 picked_qty = 0 的行。
   */
  async cancelOrderItemsForOrder(
    orderId: string,
    operator: OperatorContext,
    reason: string,
  ): Promise<PickingCancelOutcome> {
    const rows = await this.itemRepo.findOpenRowsOfOrderInActiveTasks(orderId);
    const outcome: PickingCancelOutcome = {
      cancelledRows: 0,
      cancelledQty: '0.000',
      pickedRows: [],
      handledOrderItemIds: [],
      cancelledTaskIds: [],
      completedTaskIds: [],
    };
    if (rows.length === 0) {
      return outcome;
    }

    let cancelledTotal = 0n;
    const touchedTaskIds = new Set<string>();
    for (const row of rows) {
      const required = parseQty(row.requiredQty);
      const picked = parseQty(row.pickedQty);
      const remaining = required - picked;
      if (remaining <= 0n) {
        continue;
      }
      // 先释放库存（订单来源预约必须显式 orderDomain），再撤行：
      // 行的 cancelled_qty 与库存释放必须一致，任一步失败都停在行仍可拣的状态。
      if (picked <= 0n) {
        await this.reservationService.releaseReservation(row.reservationId, {
          operator,
          idempotencyKey: orderReleaseKey(row.orderItemId),
          remark: `cancel order=${orderId}${reason ? `; ${reason}` : ''}`,
          orderDomain: true,
        });
      } else {
        await this.reservationService.releaseRemainder(row.reservationId, {
          operator,
          idempotencyKey: `ORDER_CANCEL_REMAINDER:${row.orderItemId}`,
          remark: `cancel order=${orderId}（已拣 ${formatQty(picked)} 件进拦截）${
            reason ? `; ${reason}` : ''
          }`,
          orderDomain: true,
        });
        outcome.pickedRows.push({
          orderItemId: row.orderItemId,
          reservationId: row.reservationId,
          pickedQty: formatQty(picked),
        });
      }
      const affected = await this.itemRepo.markCancelled(
        row.id,
        formatQty(remaining),
        reason.slice(0, 500),
      );
      if (affected === 0) {
        continue; // 并发已被处理（幂等）
      }
      outcome.cancelledRows += 1;
      cancelledTotal += remaining;
      outcome.handledOrderItemIds.push(row.orderItemId);
      touchedTaskIds.add(row.pickingTaskId);
    }
    outcome.cancelledQty = formatQty(cancelledTotal);

    // 任务收口：没有待拣行了 → 有已拣行算完成，否则整任务取消。
    const closed = await this.closeTasksWithoutPending(touchedTaskIds, operator, reason);
    outcome.completedTaskIds.push(...closed.completedTaskIds);
    outcome.cancelledTaskIds.push(...closed.cancelledTaskIds);

    return outcome;
  }

  /**
   * 取消单个拣货行（2026-11-03 用户口径：**以拣货行为单位取消，未拣的行可取消**）。
   *
   * 与「取消订单」的区别：订单不取消、不改平台状态，只是这一行不拣了——
   * 释放该行占用、订单行回到待分配（可重新分配/重新生成任务），拣货行置
   * `CANCELLED` 并记录撤出数量。已拣过（含部分拣）的行拒绝：实物已离开货架，
   * 只能拣完（发货）或由订单取消走拦截。
   */
  async cancelItem(
    taskId: string,
    itemId: string,
    operator: OperatorContext,
    reason?: string,
  ): Promise<PickingTaskDetailDto> {
    const task = await this.getTaskOrThrow(taskId);
    if (task.status !== 'CREATED' && task.status !== 'IN_PROGRESS') {
      throw new PickingTaskStateInvalidError(`任务状态 ${task.status} 不允许取消拣货行`, {
        taskId,
        status: task.status,
      });
    }
    const items = await this.itemRepo.findByTaskId(taskId);
    const item = items.find((row) => row.id === itemId);
    if (item === undefined) {
      throw new PickingTaskStateInvalidError('该拣货行不属于此任务', { taskId, itemId });
    }
    if (item.status === 'CANCELLED') {
      return this.getDetail(taskId); // 幂等：重复取消直接返回当前状态
    }
    const picked = parseQty(item.pickedQty);
    if (item.status !== 'PENDING' || picked > 0n) {
      throw new PickingItemNotCancellableError({
        pickingTaskItemId: item.id,
        status: item.status,
        pickedQty: formatQty(picked),
        requiredQty: formatQty(qtyFromDb(item.requiredQty)),
      });
    }

    const cancelReason =
      reason === undefined || reason.trim() === '' ? '拣货行取消' : reason.trim();
    // 顺序：先释放占用（订单域入口，ORDER 来源预约只允许订单链路释放），
    // 再让订单行回到待分配，最后撤行——任一步失败都停在「行仍可拣」的状态。
    await this.reservationService.releaseReservation(item.reservationId, {
      operator,
      idempotencyKey: orderReleaseKey(item.orderItemId),
      remark: `picking item cancel task=${task.pickingNo}; ${cancelReason}`,
      orderDomain: true,
    });
    const released = await this.orderService.releaseItemAfterPickingCancel(
      item.orderItemId,
      operator,
      `task=${task.pickingNo}; ${cancelReason}`,
      // 先不重算：订单状态看「是否还有活动拣货行」，撤行+任务收口之后才算得准。
      { recompute: false },
    );
    const requiredQty = formatQty(qtyFromDb(item.requiredQty));
    const affected = await this.itemRepo.markCancelled(
      item.id,
      requiredQty,
      cancelReason.slice(0, 500),
    );
    if (affected === 0) {
      // 并发下已被别的入口撤出：订单/库存侧已处理完，直接返回最新状态。
      return this.getDetail(taskId);
    }
    await this.closeTasksWithoutPending([task.id], operator, cancelReason);
    await this.orderService.recomputeAfterPickingItemCancel(
      released.orderId,
      operator,
      `task=${task.pickingNo}; ${cancelReason}`,
    );
    await this.operationLog.record({
      entityType: 'PICKING_TASK',
      entityId: task.id,
      entityCode: task.pickingNo,
      action: 'CANCEL_ITEM',
      changes: {
        pickingTaskItemId: { from: null, to: item.id },
        orderItemId: { from: null, to: item.orderItemId },
        cancelledQty: { from: null, to: requiredQty },
        reason: { from: null, to: cancelReason },
      },
      operator,
    });
    return this.getDetail(taskId);
  }

  /** @deprecated 2026-11-03 起统一走 cancelOrderItemsForOrder（按行分流）。 */
  async cancelZeroProgressTasksForOrder(
    orderId: string,
    operator: OperatorContext,
  ): Promise<string[]> {
    const outcome = await this.cancelOrderItemsForOrder(orderId, operator, '订单取消');
    return [...outcome.cancelledTaskIds];
  }

  async listTasksForOrder(orderId: string): Promise<
    Array<{
      id: string;
      pickingNo: string;
      warehouseId: string;
      status: string;
      totalItems: number;
      pickedItems: number;
      createdAt: Date;
    }>
  > {
    const { rows } = await this.taskRepo.listWithAggregates({ orderId }, 100, 0);
    return rows.map((row) => ({
      id: row.task.id,
      pickingNo: row.task.pickingNo,
      warehouseId: row.task.warehouseId,
      status: row.task.status,
      totalItems: row.itemsTotal,
      pickedItems: row.itemsPicked,
      createdAt: row.task.createdAt,
    }));
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * 任务收口（2026-11-03 抽公共）：任务已无 PENDING 行时——有拣过的行
   * （picked_qty > 0）→ COMPLETED；一件都没拣 → CANCELLED。还有待拣行则不动。
   */
  private async closeTasksWithoutPending(
    taskIds: Iterable<string>,
    operator: OperatorContext,
    reason: string,
  ): Promise<{ cancelledTaskIds: string[]; completedTaskIds: string[] }> {
    const cancelledTaskIds: string[] = [];
    const completedTaskIds: string[] = [];
    for (const taskId of taskIds) {
      const pending = await this.itemRepo.countPendingOfTask(taskId);
      if (pending > 0) {
        continue; // 同任务其他订单/其他行继续拣
      }
      const task = await this.taskRepo.findById(taskId);
      if (task === null || task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        continue;
      }
      const picked = await this.itemRepo.countPickedOfTask(taskId);
      if (picked > 0) {
        await this.markTaskCompleted(task, operator);
        completedTaskIds.push(taskId);
      } else {
        await this.dataSource.transaction(async (runner) => {
          await this.taskRepo.updateStatus(runner, taskId, { status: 'CANCELLED' });
        });
        cancelledTaskIds.push(taskId);
        await this.operationLog.record({
          entityType: 'PICKING_TASK',
          entityId: taskId,
          entityCode: task.pickingNo,
          action: 'CANCEL',
          changes: { reason: { from: null, to: `全部行撤出：${reason}` } },
          operator,
        });
      }
    }
    return { cancelledTaskIds, completedTaskIds };
  }

  private async markTaskCompleted(
    task: PickingTaskEntity,
    operator: OperatorContext,
  ): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      await this.taskRepo.updateStatus(runner, task.id, {
        status: 'COMPLETED',
        completedAt: new Date(),
      });
    });
    await this.operationLog.record({
      entityType: 'PICKING_TASK',
      entityId: task.id,
      entityCode: task.pickingNo,
      action: 'COMPLETE',
      changes: { status: { from: task.status, to: 'COMPLETED' } },
      operator,
    });
  }

  private async getTaskOrThrow(taskId: string): Promise<PickingTaskEntity> {
    const task = await this.taskRepo.findById(taskId);
    if (task === null) {
      throw new PickingTaskNotFoundError(taskId);
    }
    return task;
  }

  private async toListItem(taskId: string): Promise<PickingTaskListItemDto> {
    const task = await this.getTaskOrThrow(taskId);
    const [warehouse, items] = await Promise.all([
      this.warehouseService.getEntityById(task.warehouseId),
      this.itemRepo.findByTaskId(taskId),
    ]);
    return {
      id: task.id,
      pickingNo: task.pickingNo,
      warehouseId: task.warehouseId,
      warehouseCode: warehouse?.warehouseCode ?? '',
      warehouseName: warehouse?.name ?? '',
      status: task.status,
      ordersCount: new Set(items.map((item) => item.orderId)).size,
      itemsTotal: items.length,
      itemsPicked: items.filter((item) => item.status === 'PICKED').length,
      requiredTotal: formatQty(items.reduce((sum, item) => sum + qtyFromDb(item.requiredQty), 0n)),
      pickedTotal: formatQty(items.reduce((sum, item) => sum + qtyFromDb(item.pickedQty), 0n)),
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  private toListItemDto(row: {
    task: PickingTaskEntity;
    warehouseCode: string;
    warehouseName: string;
    ordersCount: number;
    itemsTotal: number;
    itemsPicked: number;
    requiredTotal: string;
    pickedTotal: string;
  }): PickingTaskListItemDto {
    return {
      id: row.task.id,
      pickingNo: row.task.pickingNo,
      warehouseId: row.task.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      status: row.task.status,
      ordersCount: row.ordersCount,
      itemsTotal: row.itemsTotal,
      itemsPicked: row.itemsPicked,
      requiredTotal: row.requiredTotal,
      pickedTotal: row.pickedTotal,
      createdAt: row.task.createdAt,
      startedAt: row.task.startedAt,
      completedAt: row.task.completedAt,
    };
  }

  private async toItemDto(
    item: PickingTaskItemEntity,
    orderNos: Map<string, string>,
  ): Promise<PickingItemDto> {
    const [sku, reservation, barcodes] = await Promise.all([
      this.skuService.getEntityById(item.skuId),
      this.inventoryQuery.getReservation(item.reservationId),
      this.barcodeService.listBySku(item.skuId),
    ]);
    let pendingSerialNumbers: string[] = [];
    if (sku?.serialTracking) {
      const serials = await this.inventoryQuery.listReservationSerials(item.reservationId);
      pendingSerialNumbers = serials
        .filter((entry) => entry.status === 'RESERVED')
        .map((entry) => entry.serialNumber);
    }
    return {
      id: item.id,
      orderId: item.orderId,
      orderItemId: item.orderItemId,
      orderNo: orderNos.get(item.orderId) ?? '',
      skuId: item.skuId,
      skuCode: sku?.skuCode ?? '',
      skuName: sku?.nameZh ?? '',
      primaryBarcode:
        barcodes.find((barcode) => barcode.isPrimary)?.barcode ?? barcodes[0]?.barcode ?? null,
      reservationId: item.reservationId,
      requiredQty: item.requiredQty,
      pickedQty: item.pickedQty,
      status: item.status,
      cancelledQty: item.cancelledQty ?? '0.000',
      cancelReason: item.cancelReason ?? null,
      binLines: reservation.lines
        .filter((line) => parseQty(line.quantity) > 0n)
        .map((line) => ({
          binId: line.binId,
          binCode: line.binCode,
          quantity: line.quantity,
          pickedQty: line.pickedQty,
        })),
      serialTracking: sku?.serialTracking ?? false,
      pendingSerialNumbers,
    };
  }
}

/**
 * 部分唯一索引冲突判定（2026-11-04）：同一订单行已有非 CANCELLED 拣货行。
 * 驱动错误可能在顶层或 driverError 上（`23505` + 索引名）。
 */
function isPickingItemUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const driver = candidate.driverError ?? candidate;
  return (
    driver.code === '23505' &&
    (driver.constraint === 'uq_picking_task_items_order_item_active' ||
      driver.constraint === 'uq_picking_task_items_order_item')
  );
}
