import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { OrderService } from '../../order/services/order.service';
import {
  OrderInterceptionCreateInput,
  OrderInterceptionPort,
} from '../../order/ports/order-interception.port';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { ReservationNotFoundError } from '../../inventory/errors/inventory.errors';
import { ExceptionService } from '../../exception/services/exception.service';
import { ShipmentService } from '../../shipment/services/shipment.service';
import { NotificationService } from '../../notification/services/notification.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { OrderInterceptionEntity } from '../entities/order-interception.entity';
import { OrderInterceptionRepository } from '../repositories/order-interception.repository';
import { OrderInterceptionHistoryRepository } from '../repositories/order-interception-history.repository';
import { interceptionReturnKey } from '../../shipment/enums/shipment.constants';
import {
  InterceptionBarcodeNotFoundError,
  InterceptionBinNotFoundError,
  InterceptionNotAllowedAfterShipmentError,
  InterceptionNotFoundError,
  InterceptionSerialMismatchError,
  InterceptionSkuMismatchError,
  InterceptionStateInvalidError,
} from '../errors/interception.errors';

/**
 * Interception workflow (Sprint 4 task §29-§45).
 *
 * Lifecycle: CREATED -> (ASSIGNED) -> LOCATING -> INTERCEPTED ->
 * RETURNED_TO_STOCK -> CLOSED, or FAILED. The return-to-stock step is ONE
 * transaction: unpack packages + shipment snapshot cleanup
 * (ShipmentService.handleInterceptionReturnInTx) + inventory
 * returnPickedStockInTx (Picked - N, On Hand NEVER +N, SN -> IN_STOCK at the
 * scanned bin, reservation -> RELEASED) + order item -> RELEASED. FAILED
 * keeps the Picked stock exactly as it was (task §42).
 */
@Injectable()
export class InterceptionService implements OrderInterceptionPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly interceptionRepo: OrderInterceptionRepository,
    private readonly historyRepo: OrderInterceptionHistoryRepository,
    private readonly orderService: OrderService,
    private readonly reservationService: ReservationService,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly shipmentService: ShipmentService,
    private readonly exceptionService: ExceptionService,
    private readonly notificationService: NotificationService,
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
    private readonly binService: WarehouseBinService,
    private readonly warehouseService: WarehouseService,
    private readonly operationLog: OperationLogService,
  ) {}

  // --------------------------------------------------------------------------
  // OrderInterceptionPort (called by OrderService.cancel)
  // --------------------------------------------------------------------------

  async createForCancelledPickedItem(
    input: OrderInterceptionCreateInput,
  ): Promise<{ id: string; interceptionNo: string }> {
    const item = await this.orderService.getItemFulfillment(input.orderItemId);
    const { remainingQty, skuCode, warehouseCode } = await this.itemFacts(item);

    const created = await this.dataSource.transaction(async (manager) => {
      const interceptionNo = await this.interceptionRepo.nextInterceptionNo(manager);
      const row = await this.interceptionRepo.insert(manager, {
        interceptionNo,
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        warehouseId: input.warehouseId,
        reason:
          input.reason && input.reason !== ''
            ? input.reason
            : `订单 ${input.orderNo} 取消时该行已拣货，需要拦截找回`,
      });
      await this.historyRepo.insert(manager, {
        interceptionId: row.id,
        fromStatus: null,
        toStatus: 'CREATED',
        action: 'CREATE',
        operatorId: null,
        operatorName: 'system',
        details: { orderNo: input.orderNo, remainingQty },
      });
      return row;
    });

    // ORDER_INTERCEPTION_REQUIRED domain event (task §50): best-effort, never
    // breaks the cancel transaction (task §51).
    await this.notificationService.notifyInterceptionRequired({
      orderNo: input.orderNo,
      orderItemId: input.orderItemId,
      interceptionId: created.id,
      interceptionNo: created.interceptionNo,
      skuCode,
      warehouseCode,
      remainingQty,
    });
    return { id: created.id, interceptionNo: created.interceptionNo };
  }

  async listByOrderId(orderId: string): Promise<
    Array<{
      id: string;
      interceptionNo: string;
      orderItemId: string | null;
      warehouseId: string;
      status: string;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    const rows = await this.interceptionRepo.listByOrderId(orderId);
    return rows.map((row) => ({
      id: row.id,
      interceptionNo: row.interceptionNo,
      orderItemId: row.orderItemId,
      warehouseId: row.warehouseId,
      status: row.status,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  // --------------------------------------------------------------------------
  // Reads (task §31-§32)
  // --------------------------------------------------------------------------

  async list(
    filters: { orderId?: string; warehouseId?: string; status?: string },
    page: { page: number; pageSize: number },
  ): Promise<{
    items: Array<{
      id: string;
      interceptionNo: string;
      orderId: string;
      orderNo: string;
      warehouseId: string;
      warehouseCode: string;
      skuCode: string;
      skuName: string;
      status: string;
      createdAt: Date;
      assignedToName: string | null;
    }>;
    meta: PageMeta;
  }> {
    const { rows, total } = await this.interceptionRepo.listWithRefs(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => ({
        id: row.interception.id,
        interceptionNo: row.interception.interceptionNo,
        orderId: row.interception.orderId,
        orderNo: row.orderNo,
        warehouseId: row.interception.warehouseId,
        warehouseCode: row.warehouseCode,
        skuCode: row.skuCode,
        skuName: row.skuName,
        status: row.interception.status,
        createdAt: row.interception.createdAt,
        assignedToName: row.interception.assignedToName,
      })),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getDetail(id: string) {
    const interception = await this.getOrThrow(id);
    const item =
      interception.orderItemId === null
        ? null
        : await this.orderService.getItemFulfillment(interception.orderItemId);
    const order = await this.orderService.getOrderOrThrow(interception.orderId);
    const facts = item === null ? null : await this.itemFacts(item);

    const history = await this.historyRepo.listByInterceptionId(id);

    return {
      id: interception.id,
      interceptionNo: interception.interceptionNo,
      orderId: interception.orderId,
      orderNo: order.orderNo,
      orderErpStatus: order.erpStatus,
      warehouseId: interception.warehouseId,
      warehouseCode: facts?.warehouseCode ?? '',
      status: interception.status,
      reason: interception.reason,
      assignedToName: interception.assignedToName,
      assignedAt: interception.assignedAt,
      scannedAt: interception.scannedAt,
      targetBinId: interception.targetBinId,
      failedReason: interception.failedReason,
      failedAt: interception.failedAt,
      returnedToStockAt: interception.returnedToStockAt,
      closedAt: interception.closedAt,
      createdAt: interception.createdAt,
      item:
        item === null || facts === null
          ? null
          : {
              orderItemId: item.orderItemId,
              skuId: item.skuId as string,
              skuCode: facts.skuCode ?? '',
              skuName: facts.skuName ?? '',
              serialTracking: facts.serialTracking,
              remainingQty: facts.remainingQty,
              pickedSerialNumbers: facts.pickedSerialNumbers,
              pickBins: facts.pickBins,
              packedPackages: facts.packedPackages,
            },
      history: history.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        action: entry.action,
        operatorName: entry.operatorName,
        details: entry.details,
        createdAt: entry.createdAt,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle (task §33-§45)
  // --------------------------------------------------------------------------

  /** CREATED -> ASSIGNED (optional explicit assignment step, task §33). */
  async assign(id: string, input: { assigneeName?: string }, operator: OperatorContext) {
    const interception = await this.getOrThrow(id);
    this.assertStatus(interception, ['CREATED'], 'ASSIGN');
    const assigneeName = input.assigneeName?.trim() || operator.username;
    await this.transition(id, {
      action: 'ASSIGN',
      from: interception.status,
      to: 'ASSIGNED',
      operator,
      patch: {
        status: 'ASSIGNED',
        assignedToName: assigneeName,
        assignedAt: new Date(),
      },
      details: { assigneeName },
    });
    return this.getDetail(id);
  }

  /** CREATED/ASSIGNED -> LOCATING (task §33). */
  async start(id: string, operator: OperatorContext) {
    const interception = await this.getOrThrow(id);
    this.assertStatus(interception, ['CREATED', 'ASSIGNED'], 'START');
    await this.transition(id, {
      action: 'START',
      from: interception.status,
      to: 'LOCATING',
      operator,
      patch: { status: 'LOCATING' },
    });
    return this.getDetail(id);
  }

  /**
   * Interception scan (task §34-§36): SKU + target bin are ALWAYS backend
   * verified; SN verified for serial-tracked SKUs. Success records the scan
   * and moves to INTERCEPTED. Stock is NOT touched here (task §35/§72).
   */
  async scan(
    id: string,
    input: { barcode: string; serialNumber?: string; binBarcode: string },
    operator: OperatorContext,
  ) {
    const interception = await this.getOrThrow(id);
    this.assertStatus(interception, ['CREATED', 'ASSIGNED', 'LOCATING'], 'SCAN');
    const item = await this.requireItem(interception);
    await this.rejectIfShipped(item.orderItemId, id);

    // 1. SKU verification (task §35).
    const barcode = input.barcode.trim();
    const barcodeRow = await this.barcodeService.findByBarcode(barcode);
    if (barcodeRow === null) {
      throw new InterceptionBarcodeNotFoundError(barcode);
    }
    if (item.skuId === null || barcodeRow.skuId !== item.skuId) {
      throw new InterceptionSkuMismatchError({
        expectedSkuId: item.skuId,
        scannedSkuId: barcodeRow.skuId,
        scannedBarcode: barcode,
      });
    }
    const sku = await this.skuService.getEntityById(item.skuId);
    if (sku === null) {
      throw new InterceptionSkuMismatchError({
        expectedSkuId: item.skuId,
        scannedBarcode: barcode,
      });
    }

    // 2. SN verification (task §36): must belong to this order's reservation.
    let scannedSerialNumbers: string[] = [];
    if (sku.serialTracking) {
      const serialNumber = input.serialNumber?.trim();
      if (serialNumber === undefined || serialNumber === '') {
        throw new InterceptionSerialMismatchError({
          reason: '该 SKU 启用 SN 管理，拦截必须扫描序列号',
        });
      }
      const serial = await this.inventoryQuery.findSerialByNumber(serialNumber);
      if (
        serial === null ||
        serial.skuId !== item.skuId ||
        serial.reservationId !== item.reservationId ||
        serial.status !== 'PICKED'
      ) {
        throw new InterceptionSerialMismatchError({
          serialNumber,
          reason: 'SN 不属于该订单的拣货记录或状态不允许拦截',
        });
      }
      scannedSerialNumbers = [serialNumber];
    } else if (input.serialNumber !== undefined && input.serialNumber.trim() !== '') {
      throw new InterceptionSerialMismatchError({
        reason: '该 SKU 未启用 SN 管理，无需序列号',
      });
    }

    // 3. Target bin verification (task §34).
    const bin = await this.binService.findByWarehouseAndCode(
      interception.warehouseId,
      input.binBarcode.trim(),
    );
    if (bin === null) {
      throw new InterceptionBinNotFoundError({
        warehouseId: interception.warehouseId,
        binBarcode: input.binBarcode.trim(),
      });
    }

    await this.transition(id, {
      action: 'SCAN',
      from: interception.status,
      to: 'INTERCEPTED',
      operator,
      patch: {
        status: 'INTERCEPTED',
        scannedSkuId: item.skuId,
        scannedSerialNumbers: scannedSerialNumbers.length > 0 ? scannedSerialNumbers : null,
        scannedAt: new Date(),
        interceptedAt: new Date(),
        targetBinId: bin.id,
      },
      details: {
        skuCode: sku.skuCode,
        binCode: bin.binCode,
        serialNumbers: scannedSerialNumbers,
      },
    });
    return this.getDetail(id);
  }

  /**
   * Return to stock (task §37-§41): the intercepted unit goes back into the
   * scanned bin. ONE transaction covers inventory (Picked - N, On Hand
   * unchanged), SN state, reservation terminal state, package unpacking and
   * the order-item terminal state - a half-returned interception cannot
   * exist.
   */
  async returnToStock(id: string, input: { binBarcode?: string }, operator: OperatorContext) {
    const interception = await this.getOrThrow(id);
    this.assertStatus(
      interception,
      ['CREATED', 'ASSIGNED', 'LOCATING', 'INTERCEPTED'],
      'RETURN_TO_STOCK',
    );
    const item = await this.requireItem(interception);
    if (item.fulfillmentStatus !== 'PICKED') {
      throw new InterceptionStateInvalidError(
        `订单行状态 ${item.fulfillmentStatus} 不允许回库（需 PICKED）`,
        { interceptionId: id, fulfillmentStatus: item.fulfillmentStatus },
      );
    }
    await this.rejectIfShipped(item.orderItemId, id);

    // Resolve the target bin: the scanned one or an explicit override.
    let targetBinId = interception.targetBinId;
    if (input.binBarcode !== undefined && input.binBarcode.trim() !== '') {
      const bin = await this.binService.findByWarehouseAndCode(
        interception.warehouseId,
        input.binBarcode.trim(),
      );
      if (bin === null) {
        throw new InterceptionBinNotFoundError({
          warehouseId: interception.warehouseId,
          binBarcode: input.binBarcode.trim(),
        });
      }
      targetBinId = bin.id;
    }
    if (targetBinId === null) {
      throw new InterceptionStateInvalidError('缺少目标回库库位：请先扫码或传入 binBarcode', {
        interceptionId: id,
      });
    }
    if (item.reservationId === null) {
      throw new InterceptionStateInvalidError('订单行缺少 Reservation，无法回库', {
        interceptionId: id,
        orderItemId: item.orderItemId,
      });
    }

    const collapsedFrom = interception.status;
    // Explicit QueryRunner: the inventory return primitive takes the runner
    // itself, so unpacking + stock + order-item state share ONE transaction.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const locked = await this.interceptionRepo.lockById(runner.manager, id);
      if (
        locked === null ||
        !['CREATED', 'ASSIGNED', 'LOCATING', 'INTERCEPTED'].includes(locked.status)
      ) {
        throw new InterceptionStateInvalidError(
          `拦截任务状态 ${locked?.status ?? 'DELETED'} 不允许回库`,
          { interceptionId: id },
        );
      }

      // Collapsed internal steps stay auditable (task §41).
      if (locked.status !== 'INTERCEPTED') {
        await this.historyRepo.insert(runner.manager, {
          interceptionId: id,
          fromStatus: locked.status,
          toStatus: 'INTERCEPTED',
          action: 'RETURN_TO_STOCK_INNER',
          operatorId: operator.userId,
          operatorName: operator.username,
          details: { collapsed: true },
        });
      }

      // 1. Package consistency BEFORE stock returns (task §43-§44/§75-§76):
      //    package lines and the shipment snapshot are VOIDED (audit history)
      //    instead of deleted, traceable to this interception.
      const unpacked = await this.shipmentService.handleInterceptionReturnInTx(runner, {
        orderItemId: item.orderItemId,
        operator,
        reason: '拦截回库：该行已取消并实体回库',
        sourceType: 'ORDER_INTERCEPTION',
        sourceId: id,
      });

      // 2. Stock: Picked - N, On Hand unchanged, SN -> IN_STOCK at the bin,
      //    reservation -> RELEASED (task §37-§40).
      await this.reservationService.returnPickedStockInTx(runner, item.reservationId, {
        targetBinId,
        idempotencyKey: interceptionReturnKey(id),
        operator,
        remark: `interception=${locked.interceptionNo}`,
      });

      // 3. Order line reaches its cancelled terminal state atomically.
      await this.orderService.markItemReleasedInTx(runner.manager, item.orderItemId);

      // 4. Interception state.
      await this.interceptionRepo.update(runner.manager, id, {
        status: 'RETURNED_TO_STOCK',
        targetBinId,
        scannedSkuId: locked.scannedSkuId ?? item.skuId,
        interceptedAt: locked.interceptedAt ?? new Date(),
        returnedToStockAt: new Date(),
      });
      await this.historyRepo.insert(runner.manager, {
        interceptionId: id,
        fromStatus: 'INTERCEPTED',
        toStatus: 'RETURNED_TO_STOCK',
        action: 'RETURN_TO_STOCK',
        operatorId: operator.userId,
        operatorName: operator.username,
        details: {
          targetBinId,
          repackRequiredPackages: unpacked?.repackRequiredPackageIds ?? [],
          shipmentId: unpacked?.shipmentId ?? null,
        },
      });
      await runner.commitTransaction();
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    await this.orderService.recomputeAfterInterception(item.orderId, operator);
    await this.operationLog.record({
      entityType: 'ORDER_INTERCEPTION',
      entityId: id,
      entityCode: interception.interceptionNo,
      action: 'RETURN_TO_STOCK',
      changes: { status: { from: collapsedFrom, to: 'RETURNED_TO_STOCK' } },
      operator,
    });
    return this.getDetail(id);
  }

  /** FAILED: goods not found; stock stays Picked (task §42/§74). */
  async fail(id: string, input: { reason?: string }, operator: OperatorContext) {
    const interception = await this.getOrThrow(id);
    this.assertStatus(interception, ['CREATED', 'ASSIGNED', 'LOCATING', 'INTERCEPTED'], 'FAIL');
    const item = await this.requireItem(interception);
    await this.transition(id, {
      action: 'FAIL',
      from: interception.status,
      to: 'FAILED',
      operator,
      patch: {
        status: 'FAILED',
        failedAt: new Date(),
        failedReason: input.reason ?? '未找到实体商品',
      },
      details: { reason: input.reason ?? null },
    });

    // ORDER_INTERCEPTION_FAILED exception, deduplicated while OPEN.
    await this.exceptionService.create({
      exceptionType: 'ORDER_INTERCEPTION_FAILED',
      severity: 'HIGH',
      referenceType: 'ORDER_INTERCEPTION',
      referenceId: id,
      storeId: null,
      message: `拦截任务 ${interception.interceptionNo} 失败：${input.reason ?? '未找到实体商品'}（库存保持 Picked）`,
      details: { interceptionNo: interception.interceptionNo, orderItemId: item.orderItemId },
    });
    const order = await this.orderService.getOrderOrThrow(interception.orderId);
    await this.notificationService.notifyInterceptionFailed({
      interceptionNo: interception.interceptionNo,
      interceptionId: id,
      orderNo: order.orderNo,
      reason: input.reason,
    });
    return this.getDetail(id);
  }

  /** CLOSED: terminal acknowledgement (task §41). */
  async close(id: string, operator: OperatorContext) {
    const interception = await this.getOrThrow(id);
    this.assertStatus(interception, ['RETURNED_TO_STOCK', 'FAILED'], 'CLOSE');
    await this.transition(id, {
      action: 'CLOSE',
      from: interception.status,
      to: 'CLOSED',
      operator,
      patch: { status: 'CLOSED', closedAt: new Date() },
    });
    return this.getDetail(id);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async getOrThrow(id: string): Promise<OrderInterceptionEntity> {
    const interception = await this.interceptionRepo.findById(id);
    if (interception === null) {
      throw new InterceptionNotFoundError(id);
    }
    return interception;
  }

  private assertStatus(
    interception: OrderInterceptionEntity,
    allowed: string[],
    action: string,
  ): void {
    if (!allowed.includes(interception.status)) {
      throw new InterceptionStateInvalidError(
        `拦截任务状态 ${interception.status} 不允许 ${action}`,
        { interceptionId: interception.id, status: interception.status, action },
      );
    }
  }

  private async requireItem(
    interception: OrderInterceptionEntity,
  ): Promise<NonNullable<Awaited<ReturnType<OrderService['getItemFulfillment']>>>> {
    if (interception.orderItemId === null) {
      throw new InterceptionStateInvalidError('拦截任务缺少订单行', {
        interceptionId: interception.id,
      });
    }
    return this.orderService.getItemFulfillment(interception.orderItemId);
  }

  /** Task §45: goods that already SHIPPED leave warehouse jurisdiction. */
  private async rejectIfShipped(orderItemId: string, interceptionId: string): Promise<void> {
    const live = await this.shipmentService.findLiveShipmentOfOrderItem(orderItemId);
    if (live !== null && live.status === 'SHIPPED') {
      throw new InterceptionNotAllowedAfterShipmentError({
        interceptionId,
        shipmentId: live.shipmentId,
      });
    }
  }

  /** Shared per-item facts: remaining picked qty, SNs, bins, packages. */
  private async itemFacts(item: Awaited<ReturnType<OrderService['getItemFulfillment']>>): Promise<{
    skuCode: string | null;
    skuName: string | null;
    warehouseCode: string;
    serialTracking: boolean;
    remainingQty: string;
    pickedSerialNumbers: string[];
    pickBins: Array<{ binId: string; binCode: string; pickedQty: string; shippedQty: string }>;
    packedPackages: Array<{
      packageId: string;
      packageNo: string;
      status: string;
      quantity: string;
    }>;
  }> {
    const sku = item.skuId === null ? null : await this.skuService.getEntityById(item.skuId);
    let remainingQty = '0.000';
    let pickedSerialNumbers: string[] = [];
    const pickBins: Array<{
      binId: string;
      binCode: string;
      pickedQty: string;
      shippedQty: string;
    }> = [];
    if (item.reservationId !== null) {
      try {
        const reservation = await this.inventoryQuery.getReservation(item.reservationId);
        let remaining = 0n;
        for (const line of reservation.lines) {
          remaining += parseQty(line.pickedQty) - parseQty(line.shippedQty);
          const bin = await this.binService.getEntityById(line.binId);
          pickBins.push({
            binId: line.binId,
            binCode: bin?.binCode ?? '',
            pickedQty: line.pickedQty,
            shippedQty: line.shippedQty,
          });
        }
        remainingQty = formatQty(remaining);
        if (sku?.serialTracking === true) {
          pickedSerialNumbers = (
            await this.inventoryQuery.listReservationSerials(item.reservationId)
          )
            .filter((entry) => entry.status === 'PICKED')
            .map((entry) => entry.serialNumber);
        }
      } catch (error) {
        if (!(error instanceof ReservationNotFoundError)) {
          throw error;
        }
      }
    }
    const packedPackages = await this.shipmentService.listPackagesContainingOrderItem(
      item.orderItemId,
    );
    const warehouse =
      item.warehouseId === null
        ? null
        : await this.warehouseService.getEntityById(item.warehouseId);
    return {
      skuCode: sku?.skuCode ?? null,
      skuName: sku?.nameZh ?? null,
      warehouseCode: warehouse?.warehouseCode ?? '',
      serialTracking: sku?.serialTracking ?? false,
      remainingQty,
      pickedSerialNumbers,
      pickBins,
      packedPackages,
    };
  }

  private async transition(
    id: string,
    input: {
      action: string;
      from: string;
      to: string;
      operator: OperatorContext;
      patch: Parameters<OrderInterceptionRepository['update']>[2];
      details?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.interceptionRepo.update(manager, id, input.patch);
      await this.historyRepo.insert(manager, {
        interceptionId: id,
        fromStatus: input.from,
        toStatus: input.to,
        action: input.action,
        operatorId: input.operator.userId,
        operatorName: input.operator.username,
        details: input.details ?? null,
      });
    });
  }
}
