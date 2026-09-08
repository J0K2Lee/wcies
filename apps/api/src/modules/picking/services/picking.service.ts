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
 * Picking workflow (Sprint 3 task §28-§51).
 *
 * Scan concurrency design (task §85): each scan FIRST claims one unit via an
 * atomic guarded increment on picking_task_items (row lock re-evaluates
 * picked_qty + 1 <= required_qty), THEN moves the stock through
 * ReservationService.pickStockPartial on a deterministic idempotency key
 * (`PTI<itemId>#<resulting pickedQty>`). A failed pick compensates the
 * increment back. Holding no outer transaction across the inventory call
 * avoids a cross-connection deadlock (the inventory tx also writes the FK
 * picking_task_item_id on inventory_serials).
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

    // 4. Claim one unit atomically (over-pick guard under the row lock).
    const pickedQtyAfter = await this.itemRepo.incrementPickedQty(target);
    if (pickedQtyAfter === null) {
      const fresh = await this.itemRepo.findById(target.id);
      throw new PickingQuantityExceededError({
        pickingTaskItemId: target.id,
        requiredQty: target.requiredQty,
        pickedQty: fresh?.pickedQty ?? target.pickedQty,
      });
    }

    // 5. Move the stock via the inventory core; compensate on failure.
    try {
      await this.reservationService.pickStockPartial(target.reservationId, {
        quantity: '1',
        serialNumbers: sku.serialTracking ? [input.serialNumber?.trim() as string] : undefined,
        pickingTaskItemId: target.id,
        operator,
        idempotencyKey: `PTI${target.id}#${pickedQtyAfter}`,
        remark: `picking=${task.pickingNo}`,
      });
    } catch (error: unknown) {
      await this.itemRepo.decrementPickedQty(target.id, pickedQtyAfter);
      this.logger.warn(
        `picking scan rolled back taskId=${taskId} item=${target.id} pickedQtyAfter=${pickedQtyAfter}: ${String(error)}`,
        'PickingService',
      );
      throw error;
    }

    // 6. Post-scan bookkeeping.
    const freshItem = (await this.itemRepo.findById(target.id)) as PickingTaskItemEntity;
    if (freshItem.status === 'PICKED') {
      await this.orderService.markItemPicked(target.orderItemId, operator);
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
    const taskIds = await this.itemRepo.findZeroProgressTaskIdsOfOrder(orderId);
    for (const taskId of taskIds) {
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.deleteZeroProgressItemsOfTask(taskId);
        await this.taskRepo.updateStatus(runner, taskId, { status: 'CANCELLED' });
      });
      await this.operationLog.record({
        entityType: 'PICKING_TASK',
        entityId: taskId,
        entityCode: taskId,
        action: 'CANCEL',
        changes: { reason: { from: null, to: '订单取消，零进度拣货任务一并取消' } },
        operator,
      });
    }
    return taskIds;
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
