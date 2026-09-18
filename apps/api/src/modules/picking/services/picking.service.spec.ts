import { describe, expect, it, vi } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { PickingService } from './picking.service';
import { PickingTaskRepository } from '../repositories/picking-task.repository';
import { PickingTaskItemRepository } from '../repositories/picking-task-item.repository';
import { OrderService } from '../../order/services/order.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { PickingTaskEntity } from '../entities/picking-task.entity';
import { PickingTaskItemEntity } from '../entities/picking-task-item.entity';
import { PickingNoEligibleItemsError } from '../errors/picking.errors';
const OPERATOR = { userId: null, username: 'test' };

function makeTask(status: PickingTaskEntity['status'] = 'IN_PROGRESS'): PickingTaskEntity {
  return {
    id: 'task-1',
    pickingNo: 'PCK00000001',
    warehouseId: 'wh-1',
    status,
    createdBy: null,
    createdByName: 't',
    assignedTo: null,
    assignedToName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
  };
}

function makeItem(overrides: Partial<PickingTaskItemEntity> = {}): PickingTaskItemEntity {
  return {
    id: 'pt-item-1',
    pickingTaskId: 'task-1',
    orderId: 'order-1',
    orderItemId: 'oi-1',
    skuId: 'sku-A',
    reservationId: 'rsv-1',
    requiredQty: '2.000',
    pickedQty: '0.000',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(input: {
  task?: PickingTaskEntity;
  items: PickingTaskItemEntity[];
  barcodeSkuId?: string | null;
  serialTracked?: boolean;
  reservationSerials?: Array<{ serialNumber: string; status: string }>;
  incrementResult?: string | null;
  pickError?: Error;
}) {
  const task = input.task ?? makeTask();
  const itemsAfterScan = input.items.map((item) =>
    item.id === 'pt-item-1'
      ? {
          ...item,
          pickedQty: input.incrementResult ?? '1.000',
          status: (input.incrementResult ?? '1.000') === item.requiredQty ? 'PICKED' : 'PENDING',
        }
      : item,
  );
  // A fake QueryRunner standing in for the ONE transaction that now spans the
  // guarded increment + inventory pick + order-item flip (Sprint 4 P0).
  const manager = {
    getRepository: () => ({ update: vi.fn().mockResolvedValue(undefined) }),
  };
  const runner = {
    manager,
    connect: vi.fn().mockResolvedValue(undefined),
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
  } as unknown as QueryRunner;
  const dataSource = {
    transaction: vi.fn(),
    createQueryRunner: vi.fn().mockReturnValue(runner),
  } as unknown as DataSource;
  const taskRepo = {
    findById: vi.fn().mockResolvedValue(task),
    nextPickingNo: vi.fn(),
    insert: vi.fn(),
    updateStatus: vi.fn(),
    listWithAggregates: vi.fn(),
  } as unknown as PickingTaskRepository;
  const findByTaskId = vi.fn().mockResolvedValue(input.items);
  const countActivePickingItems = vi.fn();
  const hasPickedProgress = vi.fn();
  const itemRepo = {
    findByTaskId,
    findById: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(itemsAfterScan.find((item) => item.id === id) ?? null),
      ),
    lockById: vi
      .fn()
      .mockImplementation((runnerArg: QueryRunner, id: string) =>
        Promise.resolve(
          (runnerArg === runner ? input.items.find((item) => item.id === id) : null) ?? null,
        ),
      ),
    incrementPickedQtyTx: vi
      .fn()
      .mockImplementation((runnerArg: QueryRunner, _id: string) =>
        runnerArg === runner
          ? Promise.resolve(input.incrementResult === undefined ? '1.000' : input.incrementResult)
          : Promise.resolve(null),
      ),
    countPendingOfTask: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          itemsAfterScan.filter((item) => item.status === 'PENDING').length === 0 ? 0 : 1,
        ),
      ),
    deleteZeroProgressItemsOfTask: vi.fn(),
    findZeroProgressTaskIdsOfOrder: vi.fn().mockResolvedValue([]),
    countActivePickingItems,
    hasPickedProgress,
    insert: vi.fn(),
  } as unknown as PickingTaskItemRepository;
  const markItemPickedInTx = vi.fn().mockResolvedValue(undefined);
  const recomputeAfterPick = vi.fn().mockResolvedValue('PICKED');
  const orderService = {
    listReservedItemsForPicking: vi.fn(),
    listReadyToPickOrders: vi.fn().mockResolvedValue([]),
    getOrderOrThrow: vi.fn().mockResolvedValue({ id: 'order-1', orderNo: 'ORD1' }),
    markItemPickedInTx,
    recomputeAfterPick,
  } as unknown as OrderService;
  const barcodeService = {
    findByBarcode: vi
      .fn()
      .mockResolvedValue(
        input.barcodeSkuId === null ? null : { skuId: input.barcodeSkuId ?? 'sku-A', barcode: 'B' },
      ),
    listBySku: vi.fn().mockResolvedValue([]),
  } as unknown as BarcodeService;
  const skuService = {
    getEntityById: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        skuCode: `SKU-${id}`,
        nameZh: 'A',
        serialTracking: input.serialTracked ?? false,
      }),
    ),
  } as unknown as SkuService;
  const warehouseService = {
    getEntityById: vi.fn().mockResolvedValue({ warehouseCode: 'SZ01', name: 'SZ' }),
  } as unknown as WarehouseService;
  const binService = {
    findByWarehouseAndCode: vi.fn().mockResolvedValue(null),
  } as unknown as WarehouseBinService;
  const reservationService = {
    pickStockPartialInTx: vi.fn().mockImplementation(() => {
      if (input.pickError !== undefined) {
        throw input.pickError;
      }
      return Promise.resolve({ reservation: {}, idempotentReplay: false });
    }),
  } as unknown as ReservationService;
  const inventoryQuery = {
    getReservation: vi.fn().mockResolvedValue({ lines: [] }),
    listReservationSerials: vi.fn().mockResolvedValue(input.reservationSerials ?? []),
  } as unknown as InventoryQueryService;
  const operationLog = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as OperationLogService;
  const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
  const service = new PickingService(
    dataSource,
    taskRepo,
    itemRepo,
    orderService,
    barcodeService,
    skuService,
    warehouseService,
    binService,
    reservationService,
    inventoryQuery,
    operationLog,
    logger,
  );
  return {
    service,
    itemRepo,
    reservationService,
    orderService,
    markItemPickedInTx,
    recomputeAfterPick,
    runner,
    countActivePickingItems,
    hasPickedProgress,
  };
}

describe('PickingService.scan (task §35-§41/§74-§77; Sprint 4 P0 single-transaction)', () => {
  it('rejects scans before the task is started', async () => {
    const { service } = build({ task: makeTask('CREATED'), items: [makeItem()] });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_TASK_STATE_INVALID',
    });
  });

  it('unknown barcode -> PICKING_BARCODE_NOT_FOUND, no stock touched', async () => {
    const { service, reservationService } = build({
      items: [makeItem()],
      barcodeSkuId: null,
    });
    await expect(service.scan('task-1', { barcode: 'NOPE' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_BARCODE_NOT_FOUND',
    });
    expect(reservationService.pickStockPartialInTx).not.toHaveBeenCalled();
  });

  it('scanned SKU is not the pending line -> PICKING_SKU_MISMATCH, no stock touched (task §75)', async () => {
    const { service, reservationService } = build({
      items: [makeItem({ skuId: 'sku-A' })],
      barcodeSkuId: 'sku-B',
    });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_SKU_MISMATCH',
    });
    expect(reservationService.pickStockPartialInTx).not.toHaveBeenCalled();
  });

  it('guarded increment rejects the scan beyond requiredQty (task §77/§85)', async () => {
    const { service, reservationService } = build({
      items: [makeItem({ requiredQty: '2.000', pickedQty: '2.000' })],
      incrementResult: null,
    });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_QUANTITY_EXCEEDED',
    });
    expect(reservationService.pickStockPartialInTx).not.toHaveBeenCalled();
  });

  it('serial-tracked SKU without serialNumber -> PICKING_SERIAL_REQUIRED', async () => {
    const { service } = build({ items: [makeItem()], serialTracked: true });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_SERIAL_REQUIRED',
    });
  });

  it('serial not belonging to the reservation -> PICKING_SERIAL_INVALID', async () => {
    const { service } = build({
      items: [makeItem()],
      serialTracked: true,
      reservationSerials: [{ serialNumber: 'SN-1', status: 'RESERVED' }],
    });
    await expect(
      service.scan('task-1', { barcode: 'B', serialNumber: 'SN-9' }, OPERATOR),
    ).rejects.toMatchObject({ code: 'PICKING_SERIAL_INVALID' });
  });

  it('serial already picked -> PICKING_SERIAL_INVALID (unique occupancy)', async () => {
    const { service } = build({
      items: [makeItem()],
      serialTracked: true,
      reservationSerials: [{ serialNumber: 'SN-1', status: 'PICKED' }],
    });
    await expect(
      service.scan('task-1', { barcode: 'B', serialNumber: 'SN-1' }, OPERATOR),
    ).rejects.toMatchObject({ code: 'PICKING_SERIAL_INVALID' });
  });

  it('successful scan moves one unit via pickStockPartialInTx on the SAME transaction', async () => {
    const { service, reservationService, runner } = build({ items: [makeItem()] });
    const result = await service.scan('task-1', { barcode: 'B' }, OPERATOR);
    expect(result.pickedQty).toBe('1.000');
    expect(reservationService.pickStockPartialInTx).toHaveBeenCalledWith(
      runner,
      'rsv-1',
      expect.objectContaining({
        quantity: '1',
        idempotencyKey: 'PTIpt-item-1#1.000',
        pickingTaskItemId: 'pt-item-1',
      }),
    );
  });

  it('inventory pick failure ROLLS THE WHOLE TRANSACTION BACK - no compensation (Sprint 4 P0)', async () => {
    const { service, runner } = build({
      items: [makeItem()],
      pickError: new Error('boom'),
    });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toThrow('boom');
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
  });

  it('completed line flips the order item PICKED inside the same transaction', async () => {
    const { service, markItemPickedInTx, recomputeAfterPick } = build({
      items: [makeItem({ requiredQty: '1.000' })],
      incrementResult: '1.000',
    });
    await service.scan('task-1', { barcode: 'B' }, OPERATOR);
    expect(markItemPickedInTx).toHaveBeenCalled();
    expect(recomputeAfterPick).toHaveBeenCalledWith('oi-1', OPERATOR);
  });
});

describe('PickingService state port (order rollup / cancel blockers)', () => {
  it('exposes active picking counts and picked progress from the repository', async () => {
    const { service, countActivePickingItems, hasPickedProgress } = build({ items: [] });
    countActivePickingItems.mockResolvedValue(2);
    hasPickedProgress.mockResolvedValue(true);
    await expect(service.countActivePickingItems('order-1')).resolves.toBe(2);
    await expect(service.hasPickedProgress('order-1')).resolves.toBe(true);
  });
});

describe('PickingService.autoCreateForReadyOrders (2026-09-18 批量入口)', () => {
  it('creates for eligible orders, skips active ones, isolates per-order domain failures', async () => {
    const { service, orderService, countActivePickingItems } = build({ items: [makeItem()] });
    vi.mocked(orderService.listReadyToPickOrders).mockResolvedValue([
      { id: 'o1', orderNo: 'ORD1' },
      { id: 'o2', orderNo: 'ORD2' },
      { id: 'o3', orderNo: 'ORD3' },
    ]);
    vi.mocked(countActivePickingItems)
      .mockResolvedValueOnce(0) // o1 -> create
      .mockResolvedValueOnce(1) // o2 -> skip (active task exists)
      .mockResolvedValueOnce(0); // o3 -> domain failure
    const createSpy = vi
      .spyOn(service, 'createPickingTask')
      .mockResolvedValueOnce([{ pickingNo: 'PCK00000001' } as never])
      .mockRejectedValueOnce(new PickingNoEligibleItemsError({ orderId: 'o3' }));

    const result = await service.autoCreateForReadyOrders(OPERATOR, { limit: 100 });

    expect(result).toMatchObject({ candidates: 3, created: 1, skipped: 1, failed: 1 });
    expect(result.createdTaskNos).toEqual(['PCK00000001']);
    expect(result.failures).toEqual([
      expect.objectContaining({ orderNo: 'ORD3', code: 'PICKING_NO_ELIGIBLE_ITEMS' }),
    ]);
    expect(createSpy).toHaveBeenCalledTimes(2); // o1 attempted, o2 skipped, o3 attempted
    expect(orderService.listReadyToPickOrders).toHaveBeenCalledWith({ limit: 100 });
  });

  it('passes the store filter through and reports an empty candidate set', async () => {
    const { service, orderService } = build({ items: [makeItem()] });
    vi.mocked(orderService.listReadyToPickOrders).mockResolvedValue([]);

    const result = await service.autoCreateForReadyOrders(OPERATOR, {
      storeId: 'store-1',
      limit: 50,
    });

    expect(orderService.listReadyToPickOrders).toHaveBeenCalledWith({
      storeId: 'store-1',
      limit: 50,
    });
    expect(result).toMatchObject({ candidates: 0, created: 0, skipped: 0, failed: 0 });
  });

  it('rethrows system errors (only domain errors are isolated)', async () => {
    const { service, orderService, countActivePickingItems } = build({ items: [makeItem()] });
    vi.mocked(orderService.listReadyToPickOrders).mockResolvedValue([
      { id: 'o1', orderNo: 'ORD1' },
    ]);
    vi.mocked(countActivePickingItems).mockResolvedValue(0);
    vi.spyOn(service, 'createPickingTask').mockRejectedValueOnce(new Error('db down'));

    await expect(service.autoCreateForReadyOrders(OPERATOR, { limit: 100 })).rejects.toThrow(
      'db down',
    );
  });
});
