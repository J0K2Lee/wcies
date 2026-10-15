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
import { OrderNotFoundError } from '../../order/errors/order.errors';
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

describe('PickingService.autoCreateForReadyOrders (2026-10-15 合并语义：一任务多订单)', () => {
  /** 合并路径的轻量装配：行收集 + 按仓建任务的真实编排。 */
  function buildMerge(options: {
    candidatesByOrder: Record<
      string,
      Array<{
        id: string;
        orderId: string;
        warehouseId: string | null;
        reservationId: string;
        quantity: string;
      }>
    >;
    activeCounts?: Record<string, number>;
  }) {
    const insertedRows: Array<Record<string, unknown>> = [];
    const createdTasks: Array<{ id: string; pickingNo: string }> = [];
    let pickingNoSeq = 0;
    const dataSource = {
      transaction: vi.fn(async (work: (manager: unknown) => Promise<unknown>) => work({})),
    } as unknown as DataSource;
    const taskRepo = {
      nextPickingNo: vi.fn(async () => {
        pickingNoSeq += 1;
        return `PCK0000000${pickingNoSeq}`;
      }),
      insert: vi.fn(async (_runner: unknown, header: Record<string, unknown>) => {
        const created = {
          id: `task-${createdTasks.length + 1}`,
          pickingNo: String(header.pickingNo),
          ...header,
        };
        createdTasks.push(created);
        return created;
      }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    const itemRepo = {
      insert: vi.fn(async (_runner: unknown, rows: Array<Record<string, unknown>>) => {
        insertedRows.push(...rows);
        return rows;
      }),
      countActivePickingItems: vi.fn(
        async (orderId: string) => options.activeCounts?.[orderId] ?? 0,
      ),
    };
    const orderService = {
      listReadyToPickOrders: vi.fn().mockResolvedValue([]),
      getOrderOrThrow: vi.fn(async (id: string) => ({ id, orderNo: `ORD-${id}` })),
      listReservedItemsForPicking: vi.fn(async (orderId: string) =>
        (options.candidatesByOrder[orderId] ?? []).map((item) => ({
          item,
          order: { id: orderId, orderNo: `ORD-${orderId}`, erpStatus: 'READY_TO_PICK' },
        })),
      ),
    };
    const service = new PickingService(
      dataSource,
      taskRepo as never,
      itemRepo as never,
      orderService as never,
      { findByBarcode: vi.fn(), listBySku: vi.fn() } as never,
      { getEntityById: vi.fn() } as never,
      { getEntityById: vi.fn() } as never,
      { findByWarehouseAndCode: vi.fn() } as never,
      { pickStockPartialInTx: vi.fn() } as never,
      { getReservation: vi.fn() } as never,
      { record: vi.fn() } as never,
      { log: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
    );
    return { service, itemRepo, taskRepo, orderService, insertedRows, createdTasks };
  }

  const reservedItem = (overrides: {
    id: string;
    orderId: string;
    warehouseId: string | null;
  }) => ({
    id: overrides.id,
    orderId: overrides.orderId,
    warehouseId: overrides.warehouseId,
    reservationId: `rsv-${overrides.id}`,
    quantity: '1.000',
    skuId: `sku-${overrides.id}`,
  });

  it('merges same-warehouse orders into ONE task with per-order lines', async () => {
    const { service, itemRepo, createdTasks, insertedRows } = buildMerge({
      candidatesByOrder: {
        o1: [reservedItem({ id: 'oi-1', orderId: 'o1', warehouseId: 'wh-1' })],
        o2: [reservedItem({ id: 'oi-2', orderId: 'o2', warehouseId: 'wh-1' })],
        o3: [reservedItem({ id: 'oi-3', orderId: 'o3', warehouseId: 'wh-1' })],
      },
    });

    const result = await service.autoCreateForReadyOrders(OPERATOR, {
      limit: 100,
      orderIds: ['o1', 'o2', 'o3'],
    });

    expect(result).toMatchObject({
      candidates: 3,
      created: 1,
      createdOrders: 3,
      itemsTotal: 3,
      skipped: 0,
      failed: 0,
    });
    expect(result.createdTaskNos).toHaveLength(1);
    expect(createdTasks).toHaveLength(1);
    expect(insertedRows).toHaveLength(3);
    expect(new Set(insertedRows.map((row) => row.orderId))).toEqual(new Set(['o1', 'o2', 'o3']));
    expect(itemRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('still splits one task per warehouse (1 task = 1 warehouse, task §33)', async () => {
    const { service, createdTasks, insertedRows } = buildMerge({
      candidatesByOrder: {
        o1: [reservedItem({ id: 'oi-1', orderId: 'o1', warehouseId: 'wh-1' })],
        o2: [
          reservedItem({ id: 'oi-2', orderId: 'o2', warehouseId: 'wh-1' }),
          reservedItem({ id: 'oi-3', orderId: 'o2', warehouseId: 'wh-2' }),
        ],
      },
    });

    const result = await service.autoCreateForReadyOrders(OPERATOR, {
      limit: 100,
      orderIds: ['o1', 'o2'],
    });

    expect(result.created).toBe(2);
    expect(createdTasks).toHaveLength(2);
    expect(insertedRows).toHaveLength(3);
  });

  it('skips orders with active tasks and isolates no-eligible-item failures', async () => {
    const { service, createdTasks, insertedRows } = buildMerge({
      candidatesByOrder: {
        o1: [reservedItem({ id: 'oi-1', orderId: 'o1', warehouseId: 'wh-1' })],
        o3: [],
      },
      activeCounts: { o2: 2 },
    });

    const result = await service.autoCreateForReadyOrders(OPERATOR, {
      limit: 100,
      orderIds: ['o1', 'o2', 'o3'],
    });

    expect(result).toMatchObject({
      candidates: 3,
      created: 1,
      createdOrders: 1,
      itemsTotal: 1,
      skipped: 1,
      failed: 1,
    });
    expect(result.failures).toEqual([
      expect.objectContaining({ orderNo: 'ORD-o3', code: 'PICKING_NO_ELIGIBLE_ITEMS' }),
    ]);
    expect(createdTasks).toHaveLength(1);
    expect(insertedRows).toHaveLength(1);
  });

  it('多选模式：去重、未知订单按失败记录、绝不走自动候选查询', async () => {
    const { service, orderService } = buildMerge({
      candidatesByOrder: {
        o1: [reservedItem({ id: 'oi-1', orderId: 'o1', warehouseId: 'wh-1' })],
      },
    });
    vi.mocked(orderService.getOrderOrThrow).mockImplementation((id: string) =>
      id === 'missing'
        ? Promise.reject(new OrderNotFoundError('missing'))
        : Promise.resolve({ id, orderNo: `ORD-${id}` } as never),
    );

    const result = await service.autoCreateForReadyOrders(OPERATOR, {
      limit: 100,
      orderIds: ['o1', 'o1', 'missing'],
    });

    // candidates = 解析成功的订单数（missing 在 failures 里）。
    expect(result).toMatchObject({ candidates: 1, created: 1, createdOrders: 1, failed: 1 });
    expect(result.failures).toEqual([
      expect.objectContaining({ orderNo: 'missing', code: 'ORDER_NOT_FOUND' }),
    ]);
    expect(orderService.listReadyToPickOrders).not.toHaveBeenCalled();
  });

  it('rethrows system errors (only domain errors are isolated)', async () => {
    const { service, orderService } = buildMerge({ candidatesByOrder: {} });
    vi.mocked(orderService.listReadyToPickOrders).mockResolvedValue([
      { id: 'o1', orderNo: 'ORD1' },
    ]);
    vi.mocked(orderService.listReservedItemsForPicking).mockRejectedValueOnce(new Error('db down'));

    await expect(service.autoCreateForReadyOrders(OPERATOR, { limit: 100 })).rejects.toThrow(
      'db down',
    );
  });

  it('passes the store filter through and reports an empty candidate set', async () => {
    const { service, orderService } = buildMerge({ candidatesByOrder: {} });
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
});

describe('PickingService.cancelZeroProgressTasksForOrder (2026-10-15 合并任务摘行)', () => {
  function buildCancel(options: {
    taskIds: string[];
    removedPerTask?: number;
    remainingAfterDelete?: number;
  }) {
    const dataSource = {
      transaction: vi.fn(async (work: (m: unknown) => Promise<unknown>) => work({})),
    } as unknown as DataSource;
    const itemRepo = {
      findActiveTaskIdsOfOrder: vi.fn().mockResolvedValue(options.taskIds),
      deleteZeroProgressItemsOfOrderInTask: vi.fn().mockResolvedValue(options.removedPerTask ?? 1),
      countItemsOfTask: vi.fn().mockResolvedValue(options.remainingAfterDelete ?? 1),
    };
    const taskRepo = { updateStatus: vi.fn().mockResolvedValue(undefined) };
    const service = new PickingService(
      dataSource,
      taskRepo as never,
      itemRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { record: vi.fn() } as never,
      { log: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
    );
    return { service, itemRepo, taskRepo };
  }

  it('removes only the cancelled order lines and keeps the merged task alive', async () => {
    const { service, itemRepo, taskRepo } = buildCancel({
      taskIds: ['task-1'],
      removedPerTask: 2,
      remainingAfterDelete: 3,
    });

    const cancelled = await service.cancelZeroProgressTasksForOrder('order-A', OPERATOR);

    expect(itemRepo.deleteZeroProgressItemsOfOrderInTask).toHaveBeenCalledWith('task-1', 'order-A');
    expect(taskRepo.updateStatus).not.toHaveBeenCalled();
    expect(cancelled).toEqual([]);
  });

  it('cancels the task only when the last lines were removed', async () => {
    const { service, taskRepo } = buildCancel({
      taskIds: ['task-1'],
      removedPerTask: 3,
      remainingAfterDelete: 0,
    });

    const cancelled = await service.cancelZeroProgressTasksForOrder('order-A', OPERATOR);

    expect(taskRepo.updateStatus).toHaveBeenCalledWith(expect.anything(), 'task-1', {
      status: 'CANCELLED',
    });
    expect(cancelled).toEqual(['task-1']);
  });
});
