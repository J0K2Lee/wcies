import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

// @nestjs/* and typeorm live in apps/api's dependency scope (pnpm), so the
// in-process application context is required through apps/api - never guessed
// from root. Sharing the native require registry keeps class identities (and
// therefore Nest DI tokens) identical to what AppModule registered.
const apiRequire = createRequire(resolve(import.meta.dirname, '../../apps/api/package.json'));

/**
 * Repository / database-level regression for the VOIDED lifecycle of
 * shipment_items (Sprint 4 follow-up):
 *
 *   1. a VOIDED row and a new ACTIVE row for the SAME order item coexist,
 *      so a voided line does not block a future re-fulfilment;
 *   2. a SECOND ACTIVE row for the same order item is rejected by the partial
 *      unique index uq_shipment_items_order_item_active (PG 23505), so the
 *      "one live assignment per order line" invariant is enforced by the
 *      database, not only by application code;
 *   3. ACTIVE-only reads (findItemsByShipmentId) keep excluding the VOIDED
 *      history, i.e. no business calculation counts it.
 *
 * Setup runs over HTTP against a spawned API (same pattern as the other
 * suites); the void + re-insert is executed through the real repository on a
 * second in-process connection to the same wcies_test database. No new
 * business entry point is invented for this test - voidShipmentItem is the
 * production method the interception path uses.
 * Requires apps/api/dist (build before test:integration).
 */
let api: ManagedProcess;
let context: { get(token: unknown): unknown; close(): Promise<void> };

const BASE = 'http://localhost:3115';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();
const OPERATOR = { userId: null, username: 'void-test' };

interface IngestResult {
  orderId: string;
  itemResults: Array<{ orderItemId: string }>;
}

interface ShipmentItemRow {
  id: string;
  shipmentId: string;
  orderItemId: string;
  skuId: string;
  reservationId: string;
  quantity: string;
  status: string;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  voidSourceType: string | null;
  voidSourceId: string | null;
}

interface ShipmentRepositoryLike {
  voidShipmentItem(
    manager: unknown,
    input: {
      orderItemId: string;
      operator: { userId: string | null; username: string };
      reason?: string;
      sourceType: string;
      sourceId?: string | null;
    },
  ): Promise<number>;
  findItemsByShipmentId(shipmentId: string): Promise<ShipmentItemRow[]>;
  findAllItemsByShipmentId(shipmentId: string): Promise<ShipmentItemRow[]>;
  findLiveShipmentOfOrderItem(
    orderItemId: string,
  ): Promise<{ shipmentId: string; status: string } | null>;
}

let shipmentRepo: ShipmentRepositoryLike;
let itemRepository: {
  insert(row: Record<string, unknown>): Promise<unknown>;
};
let dataSourceManager: unknown;

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';
let seq = 0;

/** Postgres error code / constraint, whether or not TypeORM wrapped it. */
function pgMeta(error: unknown): { code?: string; constraint?: string } {
  const candidate = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  return candidate?.driverError ?? candidate ?? {};
}

async function newSku(): Promise<{ skuId: string; barcode: string }> {
  seq += 1;
  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} 作废商品${seq}`,
  });
  const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} 作废SKU${seq}`,
  });
  const barcode = `${PREFIX}V${seq}${randomUUID().slice(0, 6)}`;
  await client.post(`/api/v1/skus/${sku.body.data.id}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
  return { skuId: sku.body.data.id, barcode };
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

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3115', REDIS_URL: 'redis://localhost:6379/10' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-VD`,
    name: `${PREFIX} 作废店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-VDWH`,
    name: `${PREFIX} 作废仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const binding = await client.post(`/api/v1/stores/${storeId}/warehouse-bindings`, {
    warehouseId,
    fulfillmentMode: 'OZON_FBS',
    isInventorySource: true,
    priority: 1,
  });
  expect(binding.body.error).toBeUndefined();
  const bins = await client.post<{ bins: Array<{ id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { rackFrom: 'A01', rackTo: 'A01', levelFrom: '01', levelTo: '01' },
  );
  binA01 = bins.body.data.bins[0]!.id;

  const { AppModule } = apiRequire('./dist/app.module.js');
  const { ShipmentRepository } = apiRequire(
    './dist/modules/shipment/repositories/shipment.repository.js',
  );
  const { ShipmentItemEntity } = apiRequire(
    './dist/modules/shipment/entities/shipment-item.entity.js',
  );
  const { DataSource } = apiRequire('typeorm') as { DataSource: unknown };
  const { NestFactory } = apiRequire('@nestjs/core') as {
    NestFactory: {
      createApplicationContext(
        cls: unknown,
        options?: Record<string, unknown>,
      ): Promise<{ get(token: unknown): unknown; close(): Promise<void> }>;
    };
  };

  context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  shipmentRepo = context.get(ShipmentRepository) as ShipmentRepositoryLike;
  const dataSource = context.get(DataSource) as {
    manager: unknown;
    getRepository(entity: unknown): { insert(row: Record<string, unknown>): Promise<unknown> };
  };
  dataSourceManager = dataSource.manager;
  itemRepository = dataSource.getRepository(ShipmentItemEntity);
});

afterAll(async () => {
  // The spawned API must be stopped even if closing the in-process context
  // throws, otherwise the leftover process keeps the port and the next run
  // silently talks to a stale server.
  try {
    await context?.close();
  } finally {
    await api.stop();
  }
});

describe('shipment_items VOIDED lifecycle (repository / database level)', () => {
  it('keeps VOIDED history, allows one new ACTIVE row and rejects a second', async () => {
    const { skuId, barcode } = await newSku();
    const initialized = await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId: binA01,
      quantity: '3',
      condition: 'SELLABLE',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `IT-VD-INIT:${randomUUID()}`,
    });
    expect(initialized.body.error).toBeUndefined();

    const platformSkuId = await mapSku(skuId);
    const order = await client.post<IngestResult>('/api/v1/orders/ingest', {
      storeId,
      platformOrderId: `PO-${randomUUID()}`,
      platformStatus: 'new',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      items: [{ platformSkuId, quantity: '1' }],
    });
    const orderItemId = order.body.data.itemResults[0]!.orderItemId;
    const orderId = order.body.data.orderId;

    const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId,
    });
    const taskId = task.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });

    const created = await client.post<{ shipments: Array<{ id: string }> }>('/api/v1/shipments', {
      orderId,
    });
    expect(created.body.error).toBeUndefined();
    const shipmentId = created.body.data.shipments[0]!.id;

    const before = await shipmentRepo.findAllItemsByShipmentId(shipmentId);
    expect(before).toHaveLength(1);
    expect(before[0]!.status).toBe('ACTIVE');
    expect(before[0]!.orderItemId).toBe(orderItemId);

    // 1) VOID the live row through the production repository method.
    const affected = await shipmentRepo.voidShipmentItem(dataSourceManager, {
      orderItemId,
      operator: OPERATOR,
      reason: '回归测试：作废后重建',
      sourceType: 'MANUAL',
    });
    expect(affected).toBe(1);

    // Voiding again is a no-op (idempotent): no ACTIVE row left to match.
    const reVoid = await shipmentRepo.voidShipmentItem(dataSourceManager, {
      orderItemId,
      operator: OPERATOR,
      sourceType: 'MANUAL',
    });
    expect(reVoid).toBe(0);

    // 2) A VOIDED row no longer counts as a live assignment...
    expect(await shipmentRepo.findLiveShipmentOfOrderItem(orderItemId)).toBeNull();
    // ...and the ACTIVE-only read used by business calculations sees nothing.
    expect(await shipmentRepo.findItemsByShipmentId(shipmentId)).toHaveLength(0);

    // 3) The same order line can be assigned again: VOIDED history does not
    //    block a future re-fulfilment.
    const original = before[0]!;
    const reinsert = await itemRepository.insert({
      shipmentId: original.shipmentId,
      orderItemId: original.orderItemId,
      skuId: original.skuId,
      reservationId: original.reservationId,
      quantity: original.quantity,
      status: 'ACTIVE',
    });
    expect(reinsert).toBeDefined();

    // 4) A SECOND ACTIVE row for the same order item is rejected by the
    //    partial unique index - enforced by PostgreSQL, not just by code.
    let insertError: unknown;
    try {
      await itemRepository.insert({
        shipmentId: original.shipmentId,
        orderItemId: original.orderItemId,
        skuId: original.skuId,
        reservationId: original.reservationId,
        quantity: original.quantity,
        status: 'ACTIVE',
      });
    } catch (error) {
      insertError = error;
    }
    expect(insertError).toBeDefined();
    expect(pgMeta(insertError).code).toBe('23505');
    expect(pgMeta(insertError).constraint).toBe('uq_shipment_items_order_item_active');

    // 5) VOIDED + ACTIVE coexist, and the VOIDED row kept its audit context.
    const all = await shipmentRepo.findAllItemsByShipmentId(shipmentId);
    expect(all).toHaveLength(2);
    const voided = all.filter((row) => row.status === 'VOIDED');
    const active = all.filter((row) => row.status === 'ACTIVE');
    expect(voided).toHaveLength(1);
    expect(active).toHaveLength(1);
    expect(voided[0]!.id).toBe(original.id);
    expect(active[0]!.id).not.toBe(original.id);
    expect(voided[0]!.voidedAt).not.toBeNull();
    expect(voided[0]!.voidedByName).toBe('void-test');
    expect(voided[0]!.voidReason).toBe('回归测试：作废后重建');
    expect(voided[0]!.voidSourceType).toBe('MANUAL');
    expect(active[0]!.voidedAt).toBeNull();

    // 6) Business reads count only the ACTIVE row.
    const liveItems = await shipmentRepo.findItemsByShipmentId(shipmentId);
    expect(liveItems).toHaveLength(1);
    expect(liveItems[0]!.id).toBe(active[0]!.id);
    expect(await shipmentRepo.findLiveShipmentOfOrderItem(orderItemId)).not.toBeNull();
  });
});
