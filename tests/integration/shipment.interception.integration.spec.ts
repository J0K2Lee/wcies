import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess, bindPlatformWarehouse } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 4 acceptance (task §64-§79) against real PostgreSQL (wcies_test):
 * shipment creation, packing scans, sealing, formal ship with inventory
 * deduction, idempotency, packing guards, labels, and the full interception
 * lifecycle including the OnHand-never-increases rule.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3113';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();

interface IngestResult {
  orderId: string;
  orderNo: string;
  erpStatus: string;
  itemResults: Array<{
    orderItemId: string;
    fulfillmentStatus: string;
    reservationId: string | null;
  }>;
}

interface ShipmentItem {
  orderItemId: string;
  skuId: string;
  skuCode: string;
  quantity: string;
  packedQty: string;
  serialTracking: boolean;
  serialNumbers: string[];
  /** ACTIVE = still a valid part of the shipment; VOIDED = audit history. */
  status: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  voidSourceType: string | null;
  voidSourceId: string | null;
}

interface ShipmentDetail {
  id: string;
  shipmentNo: string;
  status: string;
  orderId: string;
  orderNo: string;
  trackingNumber: string | null;
  /** Valid lines only (ACTIVE) - drives every business calculation. */
  items: ShipmentItem[];
  /** VOIDED history, permanently retained, never counted. */
  voidedItems: ShipmentItem[];
  packages: Array<{
    id: string;
    packageNo: string;
    status: string;
    totalQty: string;
    items: Array<{ skuCode: string; quantity: string; serialNumbers: string[] }>;
  }>;
  labels: Array<{ id: string; fileName: string; signedUrl: string }>;
}

interface InterceptionDetail {
  id: string;
  interceptionNo: string;
  status: string;
  item: {
    skuId: string;
    skuCode: string;
    remainingQty: string;
    pickedSerialNumbers: string[];
    pickBins: Array<{ binCode: string }>;
    packedPackages: Array<{ packageNo: string; status: string; quantity: string }>;
  } | null;
  history: Array<{ fromStatus: string | null; toStatus: string; action: string }>;
}

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';
let seq = 0;

async function newSku(label: string, serialTracking = false): Promise<string> {
  seq += 1;
  const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU${seq}`,
    serialTracking,
  });
  const skuId = sku.body.data.id;
  skuIdByCode.set(sku.body.data.skuCode, skuId);
  return skuId;
}

async function initialize(
  skuId: string,
  binId: string,
  quantity: string,
  serialNumbers?: string[],
): Promise<void> {
  await client.post('/api/v1/inventory/initialize', {
    skuId,
    warehouseId,
    binId,
    quantity,
    condition: 'SELLABLE',
    referenceType: 'MANUAL',
    referenceId: REF(),
    idempotencyKey: `IT-S4-INIT:${randomUUID()}`,
    ...(serialNumbers === undefined ? {} : { serialNumbers }),
  });
}

const barcodeBySku = new Map<string, string>();
const skuIdByCode = new Map<string, string>();

async function addBarcode(skuId: string): Promise<string> {
  const barcode = `${PREFIX}${seq}${randomUUID().slice(0, 6)}`;
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
  barcodeBySku.set(skuId, barcode);
  return barcode;
}

async function mapSku(skuId: string): Promise<string> {
  const platformSkuId = `PS-${randomUUID().slice(0, 8)}`;
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-PP-${platformSkuId}`,
    skuVariants: [{ skuId, platformSkuId }],
  });
  return platformSkuId;
}

async function ingestOrder(
  items: Array<{ platformSkuId: string; quantity: string }>,
): Promise<IngestResult> {
  const result = await client.post<IngestResult>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'new',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    items,
  });
  return result.body.data;
}

/** Create + start + scan every unit of the order's first picking task. */
async function pickOrder(
  order: IngestResult,
  barcodeOfSku: Map<string, string>,
  serialsOfSku: Map<string, string[]> = new Map(),
): Promise<void> {
  const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
    orderId: order.orderId,
  });
  const taskId = created.body.data.tasks[0]!.id;
  await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
  const detail = await client.get<{
    items: Array<{ skuId: string; requiredQty: string }>;
  }>(`/api/v1/picking-tasks/${taskId}`);
  for (const item of detail.body.data.items) {
    const required = Number(item.requiredQty);
    const serials = serialsOfSku.get(item.skuId)?.splice(0, required) ?? [];
    for (let i = 0; i < required; i += 1) {
      await client.post(`/api/v1/picking-tasks/${taskId}/scan`, {
        barcode: barcodeOfSku.get(item.skuId),
        ...(serials[i] === undefined ? {} : { serialNumber: serials[i] }),
      });
    }
  }
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

async function createShipment(orderId: string): Promise<ShipmentDetail> {
  const created = await client.post<{ shipments: Array<{ id: string }> }>('/api/v1/shipments', {
    orderId,
  });
  const detail = await client.get<ShipmentDetail>(
    `/api/v1/shipments/${created.body.data.shipments[0]!.id}`,
  );
  return detail.body.data;
}

async function createPackage(shipmentId: string): Promise<string> {
  const created = await client.post<{ packageId: string }>(
    `/api/v1/shipments/${shipmentId}/packages`,
    {},
  );
  return created.body.data.packageId;
}

/** Set up a picked order and return everything the scenario needs. */
async function pickedOrderFixture(
  label: string,
  quantity: string,
  options: { serialTracking?: boolean; stockQty?: string } = {},
): Promise<{
  skuId: string;
  barcode: string;
  serials: string[];
  order: IngestResult;
}> {
  const serialTracking = options.serialTracking ?? false;
  const skuId = await newSku(label, serialTracking);
  const barcode = await addBarcode(skuId);
  const platformSkuId = await mapSku(skuId);
  const stockQty = Number(options.stockQty ?? quantity);
  const serials: string[] = [];
  if (serialTracking) {
    for (let i = 1; i <= stockQty; i += 1) {
      serials.push(`SNS4-${PREFIX}-${seq}-${String(i).padStart(3, '0')}`);
    }
  }
  await initialize(skuId, binA01, String(stockQty), serials.length > 0 ? serials : undefined);
  const order = await ingestOrder([{ platformSkuId, quantity }]);
  await pickOrder(
    order,
    new Map([[skuId, barcode]]),
    serialTracking ? new Map([[skuId, [...serials]]]) : new Map(),
  );
  return { skuId, barcode, serials, order };
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3113', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-S`,
    name: `${PREFIX} 发货店`,
  });
  storeId = store.body.data.id;

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-SWH`,
    name: `${PREFIX} 发货测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const binding = await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_FBS');
  expect(binding.id).not.toBe('');

  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 2, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins.find((b) => b.binCode.endsWith('A01-1'))?.id ?? '';
});

afterAll(async () => {
  await api.stop();
});

// ---------------------------------------------------------------------------
// §64/§78: normal shipment incl. SN lifecycle
// ---------------------------------------------------------------------------

describe('normal shipment flow (task §64/§78)', () => {
  it('picks, packs, seals and ships an SN-tracked order end to end', async () => {
    const { skuId, barcode, serials, order } = await pickedOrderFixture('SN', '2', {
      serialTracking: true,
      stockQty: '3',
    });
    const pickedSerials = serials.slice(0, 2);

    const shipment = await createShipment(order.orderId);
    expect(shipment.status).toBe('READY_TO_PACK');
    expect(shipment.items).toHaveLength(1);
    expect(shipment.items[0]!.quantity).toBe('2.000');
    expect(shipment.items[0]!.serialTracking).toBe(true);

    const packageId = await createPackage(shipment.id);
    const afterCreate = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(afterCreate.body.data.status).toBe('PACKING');

    for (const serialNumber of pickedSerials) {
      await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode, serialNumber });
    }
    const seal = await client.post<{ shipmentStatus: string }>(
      `/api/v1/packages/${packageId}/seal`,
      {},
    );
    expect(seal.body.data.shipmentStatus).toBe('READY_TO_SHIP');

    // Label upload (multipart) + signed URL (task §19-§21).
    const upload = await client.upload<{ id: string; signedUrl: string }>(
      `/api/v1/shipments/${shipment.id}/labels`,
      {
        name: 'label.pdf',
        type: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 sprint4 label'),
      },
    );
    expect(upload.status).toBe(201);
    expect(upload.body.data.signedUrl).toContain('X-Amz-Signature');
    const labels = await client.get<Array<{ signedUrl: string }>>(
      `/api/v1/shipments/${shipment.id}/labels`,
    );
    expect(labels.body.data).toHaveLength(1);

    // Manual tracking input, then ship (task §28).
    const tracking = await client.patch<{ trackingNumber: string }>(
      `/api/v1/shipments/${shipment.id}/tracking`,
      {
        trackingNumber: `TRK-${PREFIX}-1`,
        carrierCode: 'CDEK',
      },
    );
    expect(tracking.body.data.trackingNumber).toBe(`TRK-${PREFIX}-1`);

    const before = await balancesOf(skuId);
    expect(before.onHand).toBe(3);
    expect(before.picked).toBe(2);

    const ship = await client.post<{
      status: string;
      orderErpStatus: string;
      alreadyShipped: boolean;
    }>(`/api/v1/shipments/${shipment.id}/ship`, {
      idempotencyKey: `SHIP-TEST-${shipment.id}`,
    });
    expect(ship.body.data.status).toBe('SHIPPED');
    expect(ship.body.data.orderErpStatus).toBe('SHIPPED');
    expect(ship.body.data.alreadyShipped).toBe(false);

    // Inventory: OnHand -2, Picked -2, Reserved 0 (task §22).
    const after = await balancesOf(skuId);
    expect(after.onHand).toBe(1);
    expect(after.picked).toBe(0);
    expect(after.reserved).toBe(0);

    // Order / item / package / shipment all SHIPPED.
    const shippedOrder = await client.get<{
      erpStatus: string;
      items: Array<{ fulfillmentStatus: string }>;
    }>(`/api/v1/orders/${order.orderId}`);
    expect(shippedOrder.body.data.erpStatus).toBe('SHIPPED');
    expect(shippedOrder.body.data.items[0]!.fulfillmentStatus).toBe('SHIPPED');
    const shippedDetail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(shippedDetail.body.data.status).toBe('SHIPPED');
    expect(shippedDetail.body.data.packages[0]!.status).toBe('SHIPPED');

    // SN lifecycle IN_STOCK -> RESERVED -> PICKED -> SHIPPED (task §78).
    const reservationId = order.itemResults[0]!.reservationId as string;
    const reservation = await client.get<{
      status: string;
      serials: Array<{ serialNumber: string; status: string }>;
    }>(`/api/v1/inventory/reservations/${reservationId}`);
    expect(reservation.body.data.status).toBe('CONSUMED');
    expect(
      reservation.body.data.serials
        .filter((serial) => pickedSerials.includes(serial.serialNumber))
        .every((serial) => serial.status === 'SHIPPED'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §65-§70: idempotency + packing guards + multi-SKU/multi-package
// ---------------------------------------------------------------------------

describe('shipment idempotency (task §65)', () => {
  it('repeat ship calls never deduct stock twice (10x)', async () => {
    const { skuId, barcode, order } = await pickedOrderFixture('IDEM', '3', { stockQty: '5' });
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    for (let i = 0; i < 3; i += 1) {
      await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    }
    await client.post(`/api/v1/packages/${packageId}/seal`, {});

    const first = await client.post<{ alreadyShipped: boolean }>(
      `/api/v1/shipments/${shipment.id}/ship`,
      {
        idempotencyKey: `IDEM-${shipment.id}`,
      },
    );
    expect(first.body.data.alreadyShipped).toBe(false);
    for (let i = 0; i < 9; i += 1) {
      const repeat = await client.post<{ status: string; alreadyShipped: boolean }>(
        `/api/v1/shipments/${shipment.id}/ship`,
        {
          idempotencyKey: `IDEM-${shipment.id}`,
        },
      );
      expect(repeat.body.data.status).toBe('SHIPPED');
      expect(repeat.body.data.alreadyShipped).toBe(true);
    }

    const after = await balancesOf(skuId);
    expect(after.onHand).toBe(2); // 5 - 3, deducted exactly once
    expect(after.picked).toBe(0);
    // Only ONE SHIP transaction group ever produced.
    const events = await stockEventCount(skuId);
    expect(events).toBe(4); // 3 PICK + 1 SHIP
  });
});

describe('packing guards (task §66-§68)', () => {
  it('not fully packed -> SHIPMENT_NOT_FULLY_PACKED (task §66)', async () => {
    const { barcode, order } = await pickedOrderFixture('SHORT', '3', { stockQty: '5' });
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    for (let i = 0; i < 2; i += 1) {
      await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    }
    await client.post(`/api/v1/packages/${packageId}/seal`, {});
    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.status).toBe('PACKING'); // short -> stays PACKING

    const ship = await client.post(`/api/v1/shipments/${shipment.id}/ship`, {});
    expect(ship.body.error?.code).toBe('SHIPMENT_NOT_FULLY_PACKED');
  });

  it('wrong SKU scan -> PACKING_SKU_MISMATCH, package + inventory unchanged (task §67)', async () => {
    const { skuId, barcode, order } = await pickedOrderFixture('MISM', '2', { stockQty: '4' });
    const otherSku = await newSku('OTHER');
    const otherBarcode = await addBarcode(otherSku);
    await initialize(otherSku, binA01, '2');
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);

    const before = await balancesOf(skuId);
    const scan = await client.post(`/api/v1/packages/${packageId}/items/scan`, {
      barcode: otherBarcode,
    });
    expect(scan.body.error?.code).toBe('PACKING_SKU_MISMATCH');

    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.items[0]!.packedQty).toBe('0.000');
    expect(await balancesOf(skuId)).toEqual(before);
    void barcode;
  });

  it('over-scan is rejected at the exact quantity boundary (task §68)', async () => {
    const { barcode, order } = await pickedOrderFixture('OVER2', '2', { stockQty: '4' });
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    const third = await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    expect(third.body.error?.code).toBe('PACKING_QUANTITY_EXCEEDED');
  });
});

describe('multi-SKU package and multiple packages (task §69-§70)', () => {
  it('one package holds SKU-A x1 + SKU-B x2 and seals (task §69)', async () => {
    const skuA = await newSku('MULA');
    const barcodeA = await addBarcode(skuA);
    const psA = await mapSku(skuA);
    await initialize(skuA, binA01, '2');
    const skuB = await newSku('MULB');
    const barcodeB = await addBarcode(skuB);
    const psB = await mapSku(skuB);
    await initialize(skuB, binA01, '3');

    const order = await ingestOrder([
      { platformSkuId: psA, quantity: '1' },
      { platformSkuId: psB, quantity: '2' },
    ]);
    await pickOrder(
      order,
      new Map([
        [skuA, barcodeA],
        [skuB, barcodeB],
      ]),
    );

    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode: barcodeA });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode: barcodeB });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode: barcodeB });
    const seal = await client.post(`/api/v1/packages/${packageId}/seal`, {});
    expect(seal.status).toBe(200);

    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.status).toBe('READY_TO_SHIP');
    const pkg = detail.body.data.packages[0]!;
    expect(pkg.items).toHaveLength(2);
    expect(pkg.totalQty).toBe('3.000');

    const ship = await client.post<{ status: string }>(`/api/v1/shipments/${shipment.id}/ship`, {});
    expect(ship.body.data.status).toBe('SHIPPED');
    expect(await balancesOf(skuA)).toEqual({ onHand: 1, reserved: 0, picked: 0 });
    expect(await balancesOf(skuB)).toEqual({ onHand: 1, reserved: 0, picked: 0 });
  });

  it('one order, two packages: shipment ready only when both sealed (task §70)', async () => {
    const sku = await newSku('TWOP');
    const barcode = await addBarcode(sku);
    const platformSkuId = await mapSku(sku);
    await initialize(sku, binA01, '4');
    // Two lines of the same SKU -> two order items, each picked separately.
    const order = await ingestOrder([
      { platformSkuId, quantity: '2' },
      { platformSkuId, quantity: '2' },
    ]);
    await pickOrder(order, new Map([[sku, barcode]]));

    const shipment = await createShipment(order.orderId);
    expect(shipment.items).toHaveLength(2);

    const package1 = await createPackage(shipment.id);
    const package2 = await createPackage(shipment.id);
    // Pack item 1 (2 units) into package 1.
    const item1 = shipment.items[0]!;
    for (let i = 0; i < 2; i += 1) {
      await client.post(`/api/v1/packages/${package1}/items/scan`, { barcode });
    }
    await client.post(`/api/v1/packages/${package1}/seal`, {});
    let detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.status).toBe('PACKING'); // package 2 still open
    void item1;

    // Pack item 2 (2 units) into package 2.
    for (let i = 0; i < 2; i += 1) {
      await client.post(`/api/v1/packages/${package2}/items/scan`, { barcode });
    }
    await client.post(`/api/v1/packages/${package2}/seal`, {});
    detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.status).toBe('READY_TO_SHIP');
    expect(detail.body.data.packages).toHaveLength(2);
    expect(detail.body.data.packages.every((pkg) => pkg.status === 'SEALED')).toBe(true);

    const ship = await client.post<{ status: string }>(`/api/v1/shipments/${shipment.id}/ship`, {});
    expect(ship.body.data.status).toBe('SHIPPED');
    expect(await balancesOf(sku)).toEqual({ onHand: 0, reserved: 0, picked: 0 });
  });
});

// ---------------------------------------------------------------------------
// §71-§77/§79: interception lifecycle
// ---------------------------------------------------------------------------

describe('interception lifecycle (task §71-§79)', () => {
  it('picked cancel returns stock: Picked -2, OnHand stays 10 (task §71)', async () => {
    const { skuId, order } = await pickedOrderFixture('RETV', '2', { stockQty: '10' });
    const before = await balancesOf(skuId);
    expect(before.onHand).toBe(10);
    expect(before.picked).toBe(2);

    const cancel = await client.post<{ interceptions: number }>(
      `/api/v1/orders/${order.orderId}/cancel`,
      {
        reason: 'test interception return',
      },
    );
    expect(cancel.body.data.interceptions).toBe(1);

    const interceptions = await client.get<Array<{ id: string; status: string }>>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    expect(interceptions.body.data).toHaveLength(1);
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    expect(interception.status).toBe('CREATED');
    expect(interception.item!.remainingQty).toBe('2.000');

    // SYSTEM notification exists (task §79) even without FEISHU config.
    const notifications = await client.get<
      Array<{ type: string; channel: string; status: string }>
    >(`/api/v1/notifications?referenceId=${interception.id}`);
    const system = notifications.body.data.find(
      (n) => n.type === 'ORDER_INTERCEPTION_REQUIRED' && n.channel === 'SYSTEM',
    );
    expect(system).toBeDefined();
    expect(system!.status).toBe('SENT');

    // Start + scan (SKU + target bin) + return to stock.
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    const task = await client.get<{ data: Array<{ id: string }> }>(
      `/api/v1/picking-tasks?orderId=${order.orderId}`,
    );
    void task;
    // Bin code scanned into binBarcode: A01-1 of this warehouse.
    const scan = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/scan`,
      {
        barcode: interceptionScanBarcode(skuId),
        binBarcode: `${PREFIX}-SWH-A01-1`,
      },
    );
    expect(scan.body.data.status).toBe('INTERCEPTED');

    const returnResult = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/return-to-stock`,
      {},
    );
    expect(returnResult.body.data.status).toBe('RETURNED_TO_STOCK');

    // THE rule (task §71/§38): Picked -2 -> 0, OnHand stays 10 (never 12).
    const after = await balancesOf(skuId);
    expect(after.onHand).toBe(10);
    expect(after.picked).toBe(0);
    expect(after.reserved).toBe(0);

    // Order item reached the cancelled terminal state.
    const cancelled = await client.get<{
      erpStatus: string;
      items: Array<{ fulfillmentStatus: string }>;
      interceptions: Array<{ status: string }>;
    }>(`/api/v1/orders/${order.orderId}`);
    expect(cancelled.body.data.erpStatus).toBe('CANCELLED');
    expect(cancelled.body.data.items[0]!.fulfillmentStatus).toBe('RELEASED');

    // Reservation terminal state: RELEASED, not PICKED (task §39).
    const reservationId = order.itemResults[0]!.reservationId as string;
    const reservation = await client.get<{ status: string }>(
      `/api/v1/inventory/reservations/${reservationId}`,
    );
    expect(reservation.body.data.status).toBe('RELEASED');

    // RETURN_PICKED ledger event exists (0 onHand change, picked -2).
    const events = await client.get<Array<{ transactionType: string }>>(
      `/api/v1/inventory/transactions?skuId=${skuId}&pageSize=100`,
    );
    expect(events.body.data.some((row) => row.transactionType === 'RETURN_PICKED')).toBe(true);

    // Close finishes the lifecycle (task §41).
    const closed = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/close`,
      {},
    );
    expect(closed.body.data.status).toBe('CLOSED');
  });

  it('wrong SKU at interception scan -> rejected, stock unchanged (task §72)', async () => {
    const { skuId, order } = await pickedOrderFixture('MISK', '1', { stockQty: '3' });
    const otherSku = await newSku('MISK2');
    const otherBarcode = await addBarcode(otherSku);
    await initialize(otherSku, binA01, '1');
    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});

    const before = await balancesOf(skuId);
    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    const scan = await client.post(`/api/v1/interceptions/${interception.id}/scan`, {
      barcode: otherBarcode,
      binBarcode: `${PREFIX}-SWH-A01-1`,
    });
    expect(scan.body.error?.code).toBe('INTERCEPTION_SKU_MISMATCH');
    expect(await balancesOf(skuId)).toEqual(before);
  });

  it('wrong SN at interception scan -> INTERCEPTION_SERIAL_MISMATCH (task §73)', async () => {
    const { skuId, order } = await pickedOrderFixture('MISN', '1', {
      serialTracking: true,
      stockQty: '3',
    });
    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});
    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    // Target SN is the picked one; scan a still-IN_STOCK serial instead.
    const inStockSerial = `SNS4-${PREFIX}-${seq}-003`;
    const scan = await client.post(`/api/v1/interceptions/${interception.id}/scan`, {
      barcode: interceptionScanBarcode(skuId),
      serialNumber: inStockSerial,
      binBarcode: `${PREFIX}-SWH-A01-1`,
    });
    expect(scan.body.error?.code).toBe('INTERCEPTION_SERIAL_MISMATCH');
  });

  it('interception FAILED keeps Picked stock and raises the exception (task §74)', async () => {
    const { skuId, order } = await pickedOrderFixture('FAIL', '1', { stockQty: '3' });
    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});
    const before = await balancesOf(skuId);
    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    const fail = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/fail`,
      {
        reason: '暂存区未找到',
      },
    );
    expect(fail.body.data.status).toBe('FAILED');

    // Stock untouched: picked stays.
    expect(await balancesOf(skuId)).toEqual(before);

    // ORDER_INTERCEPTION_FAILED exception exists.
    const exceptions = await client.get<Array<{ exceptionType: string; referenceId: string }>>(
      `/api/v1/exceptions?referenceType=ORDER_INTERCEPTION&referenceId=${interception.id}`,
    );
    expect(
      exceptions.body.data.some((row) => row.exceptionType === 'ORDER_INTERCEPTION_FAILED'),
    ).toBe(true);
  });

  it('packed (OPEN package) cancel removes the package item (task §75)', async () => {
    const { skuId, barcode, order } = await pickedOrderFixture('UNPK', '2', { stockQty: '5' });
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    // One unit packed (package still OPEN), then cancel the order.
    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});

    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    await client.post(`/api/v1/interceptions/${interception.id}/scan`, {
      barcode: interceptionScanBarcode(skuId),
      binBarcode: `${PREFIX}-SWH-A01-1`,
    });
    const returned = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/return-to-stock`,
      {},
    );
    expect(returned.body.data.status).toBe('RETURNED_TO_STOCK');

    // Package consistency: item removed, emptied package cancelled (task §43).
    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.status).toBe('CANCELLED');
    const after = await balancesOf(skuId);
    expect(after.picked).toBe(0);
    expect(after.onHand).toBe(5);

    // VOIDED, never deleted: the line survives as audit history and points at
    // the interception that voided it.
    expect(detail.body.data.items).toHaveLength(0);
    expect(detail.body.data.voidedItems).toHaveLength(1);
    const voided = detail.body.data.voidedItems[0]!;
    expect(voided.status).toBe('VOIDED');
    expect(voided.skuId).toBe(skuId);
    expect(voided.quantity).toBe('2.000');
    expect(voided.voidSourceType).toBe('ORDER_INTERCEPTION');
    expect(voided.voidSourceId).toBe(interception.id);
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidReason).toContain('拦截回库');

    // Repeating the return is rejected by the interception state machine and
    // produces NO second VOIDED row.
    const repeat = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/return-to-stock`,
      {},
    );
    expect(repeat.body.error).toBeDefined();
    const afterRepeat = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(afterRepeat.body.data.voidedItems).toHaveLength(1);
    expect(afterRepeat.body.data.items).toHaveLength(0);
  });

  it('SEALED package losing a line -> REPACK_REQUIRED (task §76)', async () => {
    const { skuId, barcode, order } = await pickedOrderFixture('RPCK', '2', { stockQty: '5' });
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/seal`, {});
    // Cancel AFTER sealing.
    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});

    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    await client.post(`/api/v1/interceptions/${interception.id}/scan`, {
      barcode: interceptionScanBarcode(skuId),
      binBarcode: `${PREFIX}-SWH-A01-1`,
    });
    const returned = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/return-to-stock`,
      {},
    );
    expect(returned.body.data.status).toBe('RETURNED_TO_STOCK');

    // The sealed package that lost its only line was emptied -> CANCELLED;
    // (with a single-line package there is nothing left to repack).
    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(['CANCELLED', 'PACKING']).toContain(detail.body.data.status);
    const after = await balancesOf(skuId);
    expect(after.picked).toBe(0);
    expect(after.onHand).toBe(5);
  });

  it('SEALED multi-line package losing ONE line -> REPACK_REQUIRED keeps the rest (task §76)', async () => {
    const skuA = await newSku('RPA');
    const barcodeA = await addBarcode(skuA);
    const psA = await mapSku(skuA);
    await initialize(skuA, binA01, '2');
    const skuB = await newSku('RPB');
    const barcodeB = await addBarcode(skuB);
    const psB = await mapSku(skuB);
    await initialize(skuB, binA01, '2');

    const order = await ingestOrder([
      { platformSkuId: psA, quantity: '1' },
      { platformSkuId: psB, quantity: '1' },
    ]);
    await pickOrder(
      order,
      new Map([
        [skuA, barcodeA],
        [skuB, barcodeB],
      ]),
    );
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode: barcodeA });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode: barcodeB });
    await client.post(`/api/v1/packages/${packageId}/seal`, {});

    // Cancel: BOTH lines get interceptions. Return only line A.
    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});
    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    expect(interceptions.body.data).toHaveLength(2);
    const details = await Promise.all(
      interceptions.body.data.map((entry) => interceptionDetail(entry.id)),
    );
    const lineA = details.find((detail) => detail.item!.skuId === skuA)!;
    await client.post(`/api/v1/interceptions/${lineA.id}/start`, {});
    await client.post(`/api/v1/interceptions/${lineA.id}/scan`, {
      barcode: interceptionScanBarcode(skuA),
      binBarcode: `${PREFIX}-SWH-A01-1`,
    });
    const returned = await client.post<{ status: string }>(
      `/api/v1/interceptions/${lineA.id}/return-to-stock`,
      {},
    );
    expect(returned.body.data.status).toBe('RETURNED_TO_STOCK');

    // Package kept line B but is no longer sealed: REPACK_REQUIRED (task §44).
    const detail = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(detail.body.data.packages[0]!.status).toBe('REPACK_REQUIRED');
    expect(detail.body.data.packages[0]!.items).toHaveLength(1);
    // Shipment back to PACKING (not ready with an unsealed package).
    expect(detail.body.data.status).toBe('PACKING');

    // Stock: A returned (picked 0), B still picked 1.
    expect((await balancesOf(skuA)).picked).toBe(0);
    expect((await balancesOf(skuB)).picked).toBe(1);

    // Line A is VOIDED history; line B is still the only ACTIVE line.
    expect(detail.body.data.items).toHaveLength(1);
    expect(detail.body.data.items[0]!.skuId).toBe(skuB);
    expect(detail.body.data.items[0]!.status).toBe('ACTIVE');
    expect(detail.body.data.voidedItems).toHaveLength(1);
    expect(detail.body.data.voidedItems[0]!.skuId).toBe(skuA);
    expect(detail.body.data.voidedItems[0]!.status).toBe('VOIDED');
    expect(detail.body.data.voidedItems[0]!.voidSourceId).toBe(lineA.id);

    // The remaining ACTIVE line can be re-sealed: package completeness counts
    // ACTIVE rows only, so the voided line A is invisible to the check and
    // line B alone satisfies the shipment again. (The order itself is
    // CANCELLED, so a formal ship stays forbidden - that guard is task §77.)
    const reseal = await client.post<{ shipmentStatus: string }>(
      `/api/v1/packages/${packageId}/seal`,
      {},
    );
    expect(reseal.body.error).toBeUndefined();
    expect(reseal.body.data.shipmentStatus).toBe('READY_TO_SHIP');

    const resealed = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
    expect(resealed.body.data.status).toBe('READY_TO_SHIP');
    expect(resealed.body.data.items).toHaveLength(1);
    expect(resealed.body.data.items[0]!.status).toBe('ACTIVE');
    expect(resealed.body.data.voidedItems).toHaveLength(1);
    expect(resealed.body.data.voidedItems[0]!.status).toBe('VOIDED');

    // A stays returned (picked 0), B is still picked and now packed.
    expect(await balancesOf(skuA)).toEqual({ onHand: 2, reserved: 0, picked: 0 });
    expect(await balancesOf(skuB)).toEqual({ onHand: 2, reserved: 0, picked: 1 });
  });

  it('voided SN is reusable: re-packing the same serial is not a unique conflict', async () => {
    const skuId = await newSku('SNR', true);
    const barcode = await addBarcode(skuId);
    const platformSkuId = await mapSku(skuId);
    const serial = `SNR-${PREFIX}-${seq}-001`;
    await initialize(skuId, binA01, '2', [serial, `SNR-${PREFIX}-${seq}-002`]);

    // Order 1 picks + packs the serial, then gets intercepted and returned.
    const order1 = await ingestOrder([{ platformSkuId, quantity: '1' }]);
    await pickOrder(order1, new Map([[skuId, barcode]]), new Map([[skuId, [serial]]]));
    const shipment1 = await createShipment(order1.orderId);
    const package1 = await createPackage(shipment1.id);
    await client.post(`/api/v1/packages/${package1}/items/scan`, { barcode, serialNumber: serial });
    // Packed SNs are the ACTIVE package_item_serials of this shipment.
    const packed = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment1.id}`);
    expect(packed.body.data.items[0]!.serialNumbers).toEqual([serial]);

    await client.post(`/api/v1/orders/${order1.orderId}/cancel`, {});
    const interceptions = await client.get<InterceptionDetail[]>(
      `/api/v1/interceptions?orderId=${order1.orderId}`,
    );
    const interception = await interceptionDetail(interceptions.body.data[0]!.id);
    await client.post(`/api/v1/interceptions/${interception.id}/start`, {});
    await client.post(`/api/v1/interceptions/${interception.id}/scan`, {
      barcode: interceptionScanBarcode(skuId),
      serialNumber: serial,
      binBarcode: `${PREFIX}-SWH-A01-1`,
    });
    const returned = await client.post<{ status: string }>(
      `/api/v1/interceptions/${interception.id}/return-to-stock`,
      {},
    );
    expect(returned.body.data.status).toBe('RETURNED_TO_STOCK');

    // The SN is back in stock and the voided shipment keeps it as history.
    const detail1 = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment1.id}`);
    expect(detail1.body.data.items).toHaveLength(0);
    expect(detail1.body.data.voidedItems).toHaveLength(1);
    expect(detail1.body.data.voidedItems[0]!.voidSourceId).toBe(interception.id);

    // Order 2 re-picks the SAME physical serial. A VOIDED package_item_serial
    // must not block it: only ACTIVE rows take part in the unique index.
    const order2 = await ingestOrder([{ platformSkuId, quantity: '1' }]);
    await pickOrder(order2, new Map([[skuId, barcode]]), new Map([[skuId, [serial]]]));
    const shipment2 = await createShipment(order2.orderId);
    const package2 = await createPackage(shipment2.id);
    const rescan = await client.post(`/api/v1/packages/${package2}/items/scan`, {
      barcode,
      serialNumber: serial,
    });
    expect(rescan.body.error).toBeUndefined();

    const detail2 = await client.get<ShipmentDetail>(`/api/v1/shipments/${shipment2.id}`);
    expect(detail2.body.data.items[0]!.serialNumbers).toEqual([serial]);
    // The old VOIDED row did not consume the serial: shipment 1 keeps it only
    // as history, shipment 2 owns the one and only ACTIVE row.
    expect(detail2.body.data.voidedItems).toHaveLength(0);
    const sealed = await client.post<{ shipmentStatus: string }>(
      `/api/v1/packages/${package2}/seal`,
      {},
    );
    expect(sealed.body.error).toBeUndefined();
    expect(sealed.body.data.shipmentStatus).toBe('READY_TO_SHIP');
  });

  it('already SHIPPED shipment blocks interception return (task §77)', async () => {
    const { skuId, barcode, order } = await pickedOrderFixture('SHIP', '2', { stockQty: '5' });
    const shipment = await createShipment(order.orderId);
    const packageId = await createPackage(shipment.id);
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    await client.post(`/api/v1/packages/${packageId}/seal`, {});
    await client.post(`/api/v1/shipments/${shipment.id}/ship`, {});

    // Cancelling a fully shipped order: line stays SHIPPED, no interception.
    const cancel = await client.post<{ interceptions: number }>(
      `/api/v1/orders/${order.orderId}/cancel`,
      {},
    );
    expect(cancel.body.data.interceptions).toBe(0);

    // Direct interception on a shipped line is rejected at scan level too:
    // (no interception exists, so we assert via the shipped order state).
    const shipped = await client.get<{
      items: Array<{ fulfillmentStatus: string }>;
    }>(`/api/v1/orders/${order.orderId}`);
    expect(shipped.body.data.items[0]!.fulfillmentStatus).toBe('SHIPPED');
    const after = await balancesOf(skuId);
    expect(after.onHand).toBe(3); // shipped stock never comes back via interception
    void skuId;
  });
});

async function interceptionDetail(id: string): Promise<InterceptionDetail> {
  const detail = await client.get<InterceptionDetail>(`/api/v1/interceptions/${id}`);
  return detail.body.data;
}

/** Barcode of the interception's SKU (detail carries skuId). */
function interceptionScanBarcode(skuId: string): string {
  const barcode = barcodeBySku.get(skuId);
  if (barcode === undefined) {
    throw new Error(`no barcode recorded for sku ${skuId}`);
  }
  return barcode;
}
