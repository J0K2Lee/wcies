import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
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
      const task = await this.dataSource.transaction(async (runner) => {
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

    // 按仓库分组：每仓一个合并任务，任务内行跨订单。
    const byWarehouse = new Map<string, typeof eligible>();
    for (const entry of eligible) {
      const warehouseId = entry.item.warehouseId as string;
      const bucket = byWarehouse.get(warehouseId) ?? [];
      bucket.push(entry);
      byWarehouse.set(warehouseId, bucket);
    }

    const createdTaskNos: string[] = [];
    const createdOrders = new Set<string>();
    for (const [warehouseId, bucket] of byWarehouse) {
      const task = await this.dataSource.transaction(async (runner) => {
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
      });
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
      items: eligible.length,
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

  async cancelZeroProgressTasksForOrder(
    orderId: string,
    operator: OperatorContext,
  ): Promise<string[]> {
    const taskIds = await this.itemRepo.findActiveTaskIdsOfOrder(orderId);
    const cancelledTaskIds: string[] = [];
    for (const taskId of taskIds) {
      await this.dataSource.transaction(async (runner) => {
        // 合并任务（2026-10-15）：只摘除该订单的零进度行，同任务其他订单
        // 继续拣；任务删空才取消。
        const removed = await this.itemRepo.deleteZeroProgressItemsOfOrderInTask(taskId, orderId);
        if (removed > 0 && (await this.itemRepo.countItemsOfTask(taskId)) === 0) {
          await this.taskRepo.updateStatus(runner, taskId, { status: 'CANCELLED' });
          cancelledTaskIds.push(taskId);
        }
      });
      await this.operationLog.record({
        entityType: 'PICKING_TASK',
        entityId: taskId,
        entityCode: taskId,
        action: 'CANCEL',
        changes: { reason: { from: null, to: '订单取消，摘除其零进度拣货行' } },
        operator,
      });
    }
    return cancelledTaskIds;
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
