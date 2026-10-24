import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Replenishment suggestions (Sprint 10 T4) against real PostgreSQL:
 *
 * - the derivation combines shipped velocity, sellable availability, safety
 *   stock and open PO quantity into suggestedQty = ceil(velocity x coverDays
 *   + safety - available - openPO) when positive;
 * - a fully covered SKU yields no suggestion and disappears under
 *   onlyAlert; keyword filters by SKU code/name.
 */

const PREFIX = runPrefix();
const BASE = 'http://localhost:3122';
const client = new ApiClient(BASE);

let api: ManagedProcess;
let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binId = '';

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3122', REDIS_URL: 'redis://localhost:6379/10' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-RP`,
    name: `${PREFIX} 补货店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-RPWH`,
    name: `${PREFIX} 补货仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binId = bins.body.data.bins[0]!.id;
  await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
}, 180_000);

afterAll(async () => {
  await api.stop();
});

async function newSku(label: string): Promise<{ skuId: string; barcode: string }> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  const skuId = sku.body.data.id;
  const barcode = `${PREFIX}${label}BAR`;
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
  return { skuId, barcode };
}

async function receive(skuId: string, quantity: string): Promise<void> {
  const receipt = await client.post<{ id: string }>('/api/v1/purchase-receipts', {
    warehouseId,
    sourceNote: `${PREFIX} 补货测试收货`,
    items: [{ skuId, quantity, binId }],
  });
  const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
  expect(confirm.status).toBe(200);
}

interface SuggestionRow {
  skuId: string;
  skuCode: string;
  availableQty: string;
  safetyQty: string;
  shippedInWindowQty: string;
  openPoQty: string;
  suggestedQty: string;
  needsReplenishment: boolean;
}

async function suggestions(query: string): Promise<SuggestionRow[]> {
  const list = await client.get<SuggestionRow[]>(
    `/api/v1/inventory/replenishment-suggestions?${query}`,
  );
  expect(list.status, JSON.stringify(list.body.error ?? {})).toBe(200);
  return list.body.data;
}

describe('replenishment suggestions (Sprint 10 T4)', () => {
  it('derives urgency from velocity, safety stock and open POs', async () => {
    const { skuId: moverSku, barcode: moverBarcode } = await newSku('RP1');
    const { skuId: calmSku } = await newSku('RP2');

    // Mover: 30 units shipped in the window, none left in stock.
    await receive(moverSku, '30');
    await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId,
      platformProductId: `${PREFIX}-PP-RP1`,
      skuVariants: [{ skuId: moverSku, platformSkuId: `${PREFIX}-RP1` }],
    });
    const order = await client.post<{ orderId: string }>('/api/v1/orders/ingest', {
      storeId,
      platformOrderId: `RP-${randomUUID()}`,
      platformStatus: 'new',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      items: [{ platformSkuId: `${PREFIX}-RP1`, quantity: '30' }],
    });
    expect(order.status).toBe(200);
    const taskId = (
      await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
        orderId: order.body.data.orderId,
      })
    ).body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    for (let i = 0; i < 30; i += 1) {
      await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode: moverBarcode });
    }
    const shipmentId = (
      await client.post<{ shipments: Array<{ id: string }> }>('/api/v1/shipments', {
        orderId: order.body.data.orderId,
      })
    ).body.data.shipments[0]!.id;
    const packageId = (
      await client.post<{ packageId: string }>(`/api/v1/shipments/${shipmentId}/packages`, {})
    ).body.data.packageId;
    for (let i = 0; i < 30; i += 1) {
      await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode: moverBarcode });
    }
    await client.post(`/api/v1/packages/${packageId}/seal`, {});
    const ship = await client.post(`/api/v1/shipments/${shipmentId}/ship`, {});
    expect(ship.status).toBe(200);

    // Calm SKU: healthy stock, no sales, safety 2.
    await receive(calmSku, '10');
    const safety = await client.put(`/api/v1/inventory/safety-stocks/${calmSku}/${warehouseId}`, {
      safetyQty: '2',
    });
    expect(safety.status).toBe(200);

    // The test database holds thousands of SKUs from earlier specs - narrow
    // to this run's two SKUs by their name keyword.
    const rows = await suggestions(
      `windowDays=30&coverDays=30&pageSize=100&keyword=${encodeURIComponent(`${PREFIX} RP`)}`,
    );
    const mover = rows.find((row) => row.skuId === moverSku);
    const calm = rows.find((row) => row.skuId === calmSku);

    // Mover: velocity 1/day x 30 cover = 30, available 0 -> suggest 30.
    expect(mover?.shippedInWindowQty).toBe('30.000');
    expect(mover?.availableQty).toBe('0.000');
    expect(mover?.suggestedQty).toBe('30.000');
    expect(mover?.needsReplenishment).toBe(true);

    // Calm: available 10 >= safety 2 + velocity 0 -> no suggestion.
    expect(calm?.safetyQty).toBe('2.000');
    expect(calm?.suggestedQty).toBe('0.000');
    expect(calm?.needsReplenishment).toBe(false);

    // onlyAlert hides the covered SKU but keeps the mover.
    const alerts = await suggestions(
      `windowDays=30&coverDays=30&onlyAlert=true&pageSize=100&keyword=${encodeURIComponent(`${PREFIX} RP`)}`,
    );
    expect(alerts.some((row) => row.skuId === moverSku)).toBe(true);
    expect(alerts.some((row) => row.skuId === calmSku)).toBe(false);

    // Open PO quantity reduces the suggestion: buy 12 -> suggest 18.
    // 采购单必须有目标仓（2026-10-21 决策 0023）：在途量按 SKU×仓 统计。
    const po = await client.post<{ id: string }>('/api/v1/purchase-orders', {
      receivingWarehouseId: warehouseId,
      items: [{ skuId: moverSku, quantity: '12' }],
    });
    expect(po.status).toBe(200);
    const rowAfter = (
      await suggestions(
        `windowDays=30&coverDays=30&pageSize=100&keyword=${encodeURIComponent(`${PREFIX} RP1`)}`,
      )
    ).find((row) => row.skuId === moverSku);
    expect(rowAfter?.openPoQty).toBe('12.000');
    expect(rowAfter?.suggestedQty).toBe('18.000');
  });
});
