import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnApiEntry, waitForHttp, ManagedProcess, bindPlatformWarehouse } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

// @nestjs/* live in apps/api's dependency scope (pnpm), so the in-process
// application context is required through apps/api - never guessed from root.
const apiRequire = createRequire(resolve(import.meta.dirname, '../../apps/api/package.json'));

interface AppContextLike {
  get(token: unknown): unknown;
  init(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Sprint 4 transaction-atomicity proof (task §62-§63/§80) against the real
 * wcies_test database, using FAULT INJECTION on the compiled services:
 *
 *   §62/§63 - the inventory pick throws mid-scan  -> PickingTaskItem
 *   increment, balances, reservation and ledger must ALL stay untouched
 *   (the Sprint 3 "pickedQty +1 but no inventory pick" risk is closed).
 *
 *   §80 - the package status update throws AFTER the inventory ship
 *   succeeded -> the WHOLE shipment business rolls back: no half-shipped
 *   state, no stock deduction, no SHIP ledger event.
 *
 * Setup happens over HTTP against a spawned API (same pattern as the other
 * suites); the fault-injected calls run on an in-process application context
 * whose prototypes are patched at runtime, so the shipped code path itself
 * is what gets tested. Requires apps/api/dist (build before test:integration).
 */
let api: ManagedProcess;
let context: AppContextLike;
let disarmPick: () => void = () => undefined;
let disarmPackage: () => void = () => undefined;

const BASE = 'http://localhost:3114';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();
const OPERATOR = { userId: null, username: 'atomicity-test' };

interface ShipmentDetail {
  id: string;
  status: string;
  packages: Array<{ id: string; status: string }>;
}

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';
let seq = 0;

async function newSku(): Promise<{ skuId: string; skuCode: string; barcode: string }> {
  seq += 1;
  const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} 原子性SKU${seq}`,
  });
  const barcode = `${PREFIX}A${seq}${randomUUID().slice(0, 6)}`;
  await client.post(`/api/v1/skus/${sku.body.data.id}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
  return { skuId: sku.body.data.id, skuCode: sku.body.data.skuCode, barcode };
}

async function balancesOf(
  skuId: string,
): Promise<{ onHand: number; reserved: number; picked: number }> {
  const list = await client.get<
    Array<{ onHandQty: string; reservedQty: string; pickedQty: string }>
  >(`/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`);
  const rows = list.body.data;
  const sum = (
    pick: (row: { onHandQty: string; reservedQty: string; pickedQty: string }) => string,
  ) => rows.reduce((acc, row) => acc + Number(pick(row)), 0);
  return {
    onHand: sum((row) => row.onHandQty),
    reserved: sum((row) => row.reservedQty),
    picked: sum((row) => row.pickedQty),
  };
}

async function stockEventCount(skuId: string): Promise<number> {
  const list = await client.get<Array<{ transactionType: string }>>(
    `/api/v1/inventory/transactions?skuId=${skuId}&pageSize=100`,
  );
  return list.body.data.filter((row) =>
    ['PICK', 'SHIP', 'RETURN_PICKED'].includes(row.transactionType),
  ).length;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3114', REDIS_URL: 'redis://localhost:6379/9' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-AX`,
    name: `${PREFIX} 原子性店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-AXWH`,
    name: `${PREFIX} 原子性仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const binding = await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_FBS');
  expect(binding.id).not.toBe('');
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins[0]!.id;

  // In-process application context with runtime fault injection points.
  // All dist modules load through the SAME native require registry so class
  // identities match what AppModule registered (vitest's transform pipeline
  // would create duplicate class tokens).
  const { AppModule } = apiRequire('./dist/app.module.js');
  const { ReservationService } = apiRequire(
    './dist/modules/inventory/services/reservation.service.js',
  );
  const { PackageRepository } = apiRequire(
    './dist/modules/shipment/repositories/package.repository.js',
  );
  const pickOriginal = ReservationService.prototype.pickStockPartialInTx;
  let failNextPick = false;
  ReservationService.prototype.pickStockPartialInTx = function patchedPick(
    this: unknown,
    ...args: Parameters<typeof pickOriginal>
  ): ReturnType<typeof pickOriginal> {
    if (failNextPick) {
      failNextPick = false;
      return Promise.reject(new Error('INJECTED_PICK_FAILURE'));
    }
    return pickOriginal.apply(this, args);
  } as typeof pickOriginal;
  disarmPick = () => {
    ReservationService.prototype.pickStockPartialInTx = pickOriginal;
  };

  const packageOriginal = PackageRepository.prototype.updateManyStatus;
  let failNextPackageUpdate = false;
  PackageRepository.prototype.updateManyStatus = function patchedPackage(
    this: unknown,
    ...args: Parameters<typeof packageOriginal>
  ): ReturnType<typeof packageOriginal> {
    if (failNextPackageUpdate) {
      failNextPackageUpdate = false;
      return Promise.reject(new Error('INJECTED_PACKAGE_UPDATE_FAILURE'));
    }
    return packageOriginal.apply(this, args);
  } as typeof packageOriginal;
  disarmPackage = () => {
    PackageRepository.prototype.updateManyStatus = packageOriginal;
  };

  // Expose the arm switches via module-level state helpers below.
  armPickFailure = () => {
    failNextPick = true;
  };
  armPackageFailure = () => {
    failNextPackageUpdate = true;
  };

  const { NestFactory } = apiRequire('@nestjs/core') as {
    NestFactory: {
      createApplicationContext(
        cls: unknown,
        options?: Record<string, unknown>,
      ): Promise<AppContextLike>;
    };
  };
  context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await context.init();
});

let armPickFailure: () => void = () => undefined;
let armPackageFailure: () => void = () => undefined;

afterAll(async () => {
  await context?.close();
  disarmPick();
  disarmPackage();
  await api.stop();
});

describe('P0 picking atomicity (task §62-§63)', () => {
  it('inventory pick failure mid-scan leaves EVERYTHING untouched', async () => {
    const { skuId, barcode } = await newSku();
    const initialized = await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId: binA01,
      quantity: '5',
      condition: 'SELLABLE',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `IT-AX-INIT:${randomUUID()}`,
    });
    expect(initialized.body.error).toBeUndefined();
    const platformSkuId = `PS-${randomUUID().slice(0, 8)}`;
    await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId,
      platformProductId: `${PREFIX}-PP-${platformSkuId}`,
      skuVariants: [{ skuId, platformSkuId }],
    });
    const order = await client.post<{
      orderId: string;
      erpStatus: string;
      itemResults: Array<{ orderItemId: string; reservationId: string }>;
    }>('/api/v1/orders/ingest', {
      storeId,
      platformOrderId: `PO-${randomUUID()}`,
      platformStatus: 'new',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      items: [{ platformSkuId, quantity: '2' }],
    });
    expect(order.body.data.erpStatus).toBe('READY_TO_PICK');
    const orderId = order.body.data.orderId;
    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId,
    });
    expect(created.body.error).toBeUndefined();
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});

    const before = await balancesOf(skuId);
    expect(before).toEqual({ onHand: 5, reserved: 2, picked: 0 });
    const eventsBefore = await stockEventCount(skuId);

    // Inject: the inventory pick explodes AFTER the picked_qty increment
    // inside the SAME transaction.
    const { PickingService } = apiRequire('./dist/modules/picking/services/picking.service.js');
    const picking = context.get(PickingService) as {
      scan(
        taskId: string,
        input: { barcode: string },
        operator: { userId: string | null; username: string },
      ): Promise<unknown>;
    };
    armPickFailure();
    await expect(picking.scan(taskId, { barcode }, OPERATOR)).rejects.toThrow(
      'INJECTED_PICK_FAILURE',
    );

    // Picked_qty NOT incremented (Sprint 3 risk closed), balances identical,
    // no PICK ledger line, order item still RESERVED.
    const taskAfter = await client.get<{ items: Array<{ pickedQty: string; status: string }> }>(
      `/api/v1/picking-tasks/${taskId}`,
    );
    expect(taskAfter.body.data.items[0]!.pickedQty).toBe('0.000');
    expect(taskAfter.body.data.items[0]!.status).toBe('PENDING');
    expect(await balancesOf(skuId)).toEqual(before);
    expect(await stockEventCount(skuId)).toBe(eventsBefore);
    const orderAfter = await client.get<{ items: Array<{ fulfillmentStatus: string }> }>(
      `/api/v1/orders/${orderId}`,
    );
    expect(orderAfter.body.data.items[0]!.fulfillmentStatus).toBe('RESERVED');

    // The very same scan succeeds via HTTP afterwards (no poisoned state).
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(await balancesOf(skuId)).toEqual({ onHand: 5, reserved: 0, picked: 2 });
  });
});

describe('shipment ship atomicity (task §80)', () => {
  it('package update failure AFTER inventory ship rolls the WHOLE ship back', async () => {
    const { skuId, barcode } = await newSku();
    await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId: binA01,
      quantity: '4',
      condition: 'SELLABLE',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `IT-AX-INIT2:${randomUUID()}`,
    });
    const platformSkuId = `PS-${randomUUID().slice(0, 8)}`;
    await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId,
      platformProductId: `${PREFIX}-PP2-${platformSkuId}`,
      skuVariants: [{ skuId, platformSkuId }],
    });
    const order = await client.post<{ orderId: string }>('/api/v1/orders/ingest', {
      storeId,
      platformOrderId: `PO-${randomUUID()}`,
      platformStatus: 'new',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      items: [{ platformSkuId, quantity: '2' }],
    });
    const orderId = order.body.data.orderId;
    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });

    const shipmentCreated = await client.post<{ shipments: Array<{ id: string }> }>(
      '/api/v1/shipments',
      { orderId },
    );
    const shipmentId = shipmentCreated.body.data.shipments[0]!.id;
    const packageCreated = await client.post<{ packageId: string }>(
      `/api/v1/shipments/${shipmentId}/packages`,
      {},
    );
    const packageId = packageCreated.body.data.packageId;
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/seal`, {});

    const before = await balancesOf(skuId);
    expect(before).toEqual({ onHand: 4, reserved: 0, picked: 2 });
    const eventsBefore = await stockEventCount(skuId);

    // Inject: package -> SHIPPED update fails AFTER shipStockPartialInTx ran.
    const { ShipmentShipService } = apiRequire(
      './dist/modules/shipment/services/shipment-ship.service.js',
    );
    const shipService = context.get(ShipmentShipService) as {
      shipShipment(
        shipmentId: string,
        input: Record<string, never>,
        operator: { userId: string | null; username: string },
      ): Promise<unknown>;
    };
    armPackageFailure();
    await expect(shipService.shipShipment(shipmentId, {}, OPERATOR)).rejects.toThrow(
      'INJECTED_PACKAGE_UPDATE_FAILURE',
    );

    // No half-shipment: shipment still READY_TO_SHIP, package SEALED, stock
    // NOT deducted, no SHIP event, order item still PICKED.
    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipmentId}`);
    expect(detail.body.data.status).toBe('READY_TO_SHIP');
    expect(detail.body.data.packages[0]!.status).toBe('SEALED');
    expect(await balancesOf(skuId)).toEqual(before);
    expect(await stockEventCount(skuId)).toBe(eventsBefore);
    const orderAfter = await client.get<{
      erpStatus: string;
      items: Array<{ fulfillmentStatus: string }>;
    }>(`/api/v1/orders/${orderId}`);
    expect(orderAfter.body.data.erpStatus).toBe('PICKED');
    expect(orderAfter.body.data.items[0]!.fulfillmentStatus).toBe('PICKED');

    // And the shipment ships cleanly afterwards.
    const ship = await client.post<{ status: string }>(`/api/v1/shipments/${shipmentId}/ship`, {});
    expect(ship.body.data.status).toBe('SHIPPED');
    expect(await balancesOf(skuId)).toEqual({ onHand: 2, reserved: 0, picked: 0 });
  });
});
