import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
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
  const dataSource = { transaction: vi.fn() } as unknown as DataSource;
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
    incrementPickedQty: vi
      .fn()
      .mockResolvedValue(input.incrementResult === undefined ? '1.000' : input.incrementResult),
    decrementPickedQty: vi.fn().mockResolvedValue(undefined),
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
  const markItemPicked = vi.fn().mockResolvedValue(undefined);
  const orderService = {
    listReservedItemsForPicking: vi.fn(),
    getOrderOrThrow: vi.fn().mockResolvedValue({ id: 'order-1', orderNo: 'ORD1' }),
    markItemPicked,
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
    pickStockPartial: vi.fn().mockImplementation(() => {
      if (input.pickError !== undefined) {
        throw input.pickError;
      }
      return Promise.resolve({});
    }),
  } as unknown as ReservationService;
  const inventoryQuery = {
    getReservation: vi.fn().mockResolvedValue({ lines: [] }),
    listReservationSerials: vi.fn().mockResolvedValue(input.reservationSerials ?? []),
  } as unknown as InventoryQueryService;
  const operationLog = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as OperationLogService;
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
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
    markItemPicked,
    countActivePickingItems,
    hasPickedProgress,
  };
}

describe('PickingService.scan (task §35-§41/§74-§77)', () => {
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
    expect(reservationService.pickStockPartial).not.toHaveBeenCalled();
  });

  it('scanned SKU is not the pending line -> PICKING_SKU_MISMATCH, no stock touched (task §75)', async () => {
    const { service, reservationService } = build({
      items: [makeItem({ skuId: 'sku-A' })],
      barcodeSkuId: 'sku-B',
    });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_SKU_MISMATCH',
    });
    expect(reservationService.pickStockPartial).not.toHaveBeenCalled();
  });

  it('guarded increment rejects the scan beyond requiredQty (task §77/§85)', async () => {
    const { service, reservationService } = build({
      items: [makeItem({ requiredQty: '2.000', pickedQty: '2.000' })],
      incrementResult: null,
    });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toMatchObject({
      code: 'PICKING_QUANTITY_EXCEEDED',
    });
    expect(reservationService.pickStockPartial).not.toHaveBeenCalled();
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

  it('successful scan moves one unit via pickStockPartial with deterministic key', async () => {
    const { service, reservationService } = build({ items: [makeItem()] });
    const result = await service.scan('task-1', { barcode: 'B' }, OPERATOR);
    expect(result.pickedQty).toBe('1.000');
    expect(reservationService.pickStockPartial).toHaveBeenCalledWith(
      'rsv-1',
      expect.objectContaining({
        quantity: '1',
        idempotencyKey: 'PTIpt-item-1#1.000',
        pickingTaskItemId: 'pt-item-1',
      }),
    );
  });

  it('inventory pick failure compensates the increment back (task §23)', async () => {
    const { service, itemRepo } = build({
      items: [makeItem()],
      pickError: new Error('boom'),
    });
    await expect(service.scan('task-1', { barcode: 'B' }, OPERATOR)).rejects.toThrow('boom');
    expect(itemRepo.decrementPickedQty).toHaveBeenCalledWith('pt-item-1', '1.000');
  });

  it('completed line notifies the order module to mark the item PICKED', async () => {
    const { service, markItemPicked } = build({
      items: [makeItem({ requiredQty: '1.000' })],
      incrementResult: '1.000',
    });
    await service.scan('task-1', { barcode: 'B' }, OPERATOR);
    expect(markItemPicked).toHaveBeenCalledWith('oi-1', OPERATOR);
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
