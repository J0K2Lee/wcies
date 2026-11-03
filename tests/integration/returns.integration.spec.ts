import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Return/refund module acceptance (dual-axis T5, docs/business-rules/
 * returns.md) against real PostgreSQL:
 *
 * - platform return sync pulls rFBS records, links the order store-scoped
 *   by posting_number, is idempotent on re-sync, and raises
 *   RETURN_ORDER_NOT_FOUND for unknown order references;
 * - a return batch is the ONLY stock write-back path: inspection SELLABLE
 *   books a RETURN_RECEIPT receive (explicit bin), DEFECTIVE books the
 *   quarantine condition with the STAGING fallback bin and raises
 *   RETURN_DIFFERENCE on a platform-linked line, LOST writes nothing;
 * - the condition verdict is one-shot; the batch auto-completes once every
 *   line is terminal; draft cancel never touches stock.
 */

const PREFIX = runPrefix();
const BASE = 'http://localhost:3119';
const client = new ApiClient(BASE);

const API_KEY = 'it-test-api-key-ret';
const CLIENT_ID = '333555777';

interface MockRfbsReturn {
  return_id: number;
  return_number: string;
  posting_number: string | null;
  order_number: string | null;
  created_at: string;
  state: { state: string; money_return_state_name: string };
  product: { sku: number; offer_id: string; price: number };
}

const rfbsReturns: MockRfbsReturn[] = [];
let mockOzon: Server;

let api: ManagedProcess;

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binId = '';

interface SyncJobDto {
  id: string;
  status: string;
}

async function waitForJob(jobId: string, timeoutMs = 40_000): Promise<SyncJobDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await client.get<SyncJobDto>(`/api/v1/sync/jobs/${jobId}`);
    const job = response.body.data;
    if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(job.status)) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`sync job ${jobId} did not finish`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function syncOrders(): Promise<SyncJobDto> {
  const dispatch = await client.post<SyncJobDto>('/api/v1/sync/orders', { storeId });
  expect(dispatch.status).toBe(202);
  return waitForJob(dispatch.body.data.id);
}

interface MockPosting {
  posting_number: string;
  status: string;
  in_process_at: string;
  products: Array<{
    offer_id: string;
    sku: number;
    quantity: number;
    price: string;
    currency_code: string;
  }>;
}
const postings: MockPosting[] = [];

beforeAll(async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const clientId = String(req.headers['client-id'] ?? '');
      const apiKey = String(req.headers['api-key'] ?? '');
      const url = req.url ?? '';
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (clientId !== CLIENT_ID || apiKey !== API_KEY) {
        send(401, { code: 16, message: 'client-id or api-key not found' });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
      } catch {
        send(400, { code: 400, message: 'bad json' });
        return;
      }
      if (url === '/v3/product/list') {
        send(200, { result: { last_id: 'last', items: [] } });
        return;
      }
      // v4 list（2026-10-20）：顶层响应 + 游标分页。
      if (url === '/v4/posting/fbs/list') {
        const filter = (parsed['filter'] as { since?: string; to?: string } | undefined) ?? {};
        const since = filter.since ?? '1970-01-01T00:00:00Z';
        const to = filter.to ?? '2999-01-01T00:00:00Z';
        send(200, {
          has_next: false,
          cursor: '',
          postings: postings.filter((p) => p.in_process_at >= since && p.in_process_at <= to),
        });
        return;
      }
      if (url === '/v3/posting/fbs/get') {
        const number = typeof parsed['posting_number'] === 'string' ? parsed['posting_number'] : '';
        const posting = postings.find((p) => p.posting_number === number);
        if (posting === undefined) {
          send(404, { code: 404, message: 'posting not found' });
          return;
        }
        send(200, { result: posting });
        return;
      }
      if (url === '/v2/returns/rfbs/list') {
        const lastId = typeof parsed['last_id'] === 'number' ? parsed['last_id'] : 0;
        send(200, { returns: rfbsReturns.filter((r) => r.return_id > lastId) });
        return;
      }
      send(404, { code: 404, message: `unknown mock endpoint ${url}` });
    });
  });
  mockOzon = await new Promise<Server>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const address = mockOzon.address() as AddressInfo;
  const mockOzonUrl = `http://127.0.0.1:${address.port}`;

  const env = {
    PORT: '3119',
    REDIS_URL: 'redis://localhost:6379/11',
    OZON_API_BASE_URL: mockOzonUrl,
    OZON_MIN_REQUEST_INTERVAL_MS: '0',
  };
  api = spawnApiEntry('main.js', env);
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-A`,
    name: `${PREFIX} 退货店`,
  });
  storeId = store.body.data.id;
  await client.post(`/api/v1/stores/${storeId}/credentials`, {
    credentialType: 'MAIN_API',
    payload: { clientId: CLIENT_ID, apiKey: API_KEY },
    longTerm: true,
  });

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 退货仓`,
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
  await new Promise<void>((resolve) => mockOzon.close(() => resolve()));
});

async function newMappedSku(
  label: string,
  platformSkuId: number,
  quantity: string,
): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  const skuId = sku.body.data.id;
  if (quantity !== '0') {
    const received = await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId,
      quantity,
      condition: 'SELLABLE',
      referenceType: 'MANUAL',
      referenceId: randomUUID(),
      idempotencyKey: `IT-RET-INIT:${randomUUID()}`,
    });
    expect(received.status).toBe(200);
  }
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-${label}-PP`,
    skuVariants: [{ skuId, platformSkuId: String(platformSkuId) }],
  });
  return skuId;
}

async function inventoryOf(
  skuId: string,
  condition?: string,
): Promise<Array<{ onHandQty: string; condition: string }>> {
  const query = condition === undefined ? '' : `&condition=${condition}`;
  const list = await client.get<Array<{ skuId: string; onHandQty: string; condition: string }>>(
    `/api/v1/inventory?skuId=${skuId}${query}&pageSize=50`,
  );
  return list.body.data;
}

async function transactionsOf(
  skuId: string,
): Promise<Array<{ referenceType: string; referenceId: string; eventType: string }>> {
  const list = await client.get<
    Array<{ referenceType: string; referenceId: string; eventType: string }>
  >(`/api/v1/inventory/transactions?skuId=${skuId}&pageSize=100`);
  return list.body.data;
}

// ---------------------------------------------------------------------------

describe('platform return sync (T5, returns.md §2)', () => {
  it('pulls rFBS records, links the order store-scoped, idempotent re-sync', async () => {
    const skuId = await newMappedSku('RTN', 720000001, '0');
    postings.push({
      posting_number: 'IT-RET-ORD-1',
      status: 'awaiting_packaging',
      in_process_at: new Date().toISOString(),
      products: [
        {
          offer_id: 'RTN',
          sku: 720000001,
          quantity: 1,
          price: '100.00',
          currency_code: 'RUB',
        },
      ],
    });
    const job = await syncOrders();
    expect(job.status).toBe('SUCCESS');

    rfbsReturns.push({
      return_id: 1,
      return_number: 'IT-RET-R1',
      posting_number: 'IT-RET-ORD-1',
      order_number: '777',
      created_at: new Date().toISOString(),
      state: { state: 'return_in_progress', money_return_state_name: 'Оплачено' },
      product: { sku: 720000001, offer_id: 'RTN', price: 4590 },
    });
    // Unknown order reference: must raise the exception.
    rfbsReturns.push({
      return_id: 2,
      return_number: 'IT-RET-R2',
      posting_number: 'NO-SUCH-ORDER',
      order_number: '778',
      created_at: new Date().toISOString(),
      state: { state: 'new', money_return_state_name: 'Не оплачено' },
      product: { sku: 720000001, offer_id: 'RTN', price: 4590 },
    });

    const sync = await client.post<{ created: number; updated: number; unlinkable: number }>(
      '/api/v1/returns/platform/sync',
      { storeId },
    );
    expect(sync.status, JSON.stringify(sync.body.error ?? {})).toBe(200);
    expect(sync.body.data.created).toBe(2);
    expect(sync.body.data.unlinkable).toBe(1);

    const list = await client.get<
      Array<{
        id: string;
        platformReturnId: string;
        orderId: string | null;
        refundState: string | null;
      }>
    >(`/api/v1/returns/platform?storeId=${storeId}&pageSize=50`);
    const linked = list.body.data.find((row) => row.platformReturnId === 'IT-RET-R1');
    expect(linked).toBeDefined();
    expect(linked?.orderId).not.toBeNull();
    expect(linked?.refundState).toBe('Оплачено');

    const orphan = list.body.data.find((row) => row.platformReturnId === 'IT-RET-R2');
    expect(orphan?.orderId).toBeNull();

    // RETURN_ORDER_NOT_FOUND raised for the orphan (reference = its row id).
    const exceptions = await client.get<
      Array<{ exceptionType: string; status: string; referenceId: string }>
    >(`/api/v1/exceptions?exceptionType=RETURN_ORDER_NOT_FOUND&status=OPEN&pageSize=50`);
    expect(exceptions.body.data.some((row) => row.referenceId === orphan?.id)).toBe(true);

    // Idempotent re-sync: nothing new, nothing updated (unchanged facts).
    const resync = await client.post<{ created: number; updated: number }>(
      '/api/v1/returns/platform/sync',
      { storeId },
    );
    expect(resync.body.data.created).toBe(0);
    expect(resync.body.data.updated).toBe(0);

    expect(skuId).not.toBe('');
  });
});

describe('return batch inspection (T5, returns.md §3)', () => {
  it('full lifecycle: sellable/defective book stock, lost does not, batch completes', async () => {
    // A linked line (from the platform record) + a manual line.
    const platformList = await client.get<Array<{ id: string }>>(
      `/api/v1/returns/platform?storeId=${storeId}&linked=false&pageSize=50`,
    );
    const pendingReturn = platformList.body.data.find((row) => row.id !== undefined);
    expect(pendingReturn).toBeDefined();

    const manualSku = await newMappedSku('MAN', 720000002, '0');
    const created = await client.post<ReturnBatchShape & { items: ReturnBatchItemShape[] }>(
      '/api/v1/returns/batches',
      {
        warehouseId,
        sourceNote: `${PREFIX} Amol 批次`,
        items: [
          { platformReturnId: pendingReturn!.id, quantity: '1' },
          { skuId: manualSku, quantity: '2' },
        ],
      },
    );
    expect([200, 201]).toContain(created.status);
    const batch = created.body.data;
    expect(batch.batchNo).toMatch(/^RT\d{6}$/);
    expect(batch.status).toBe('DRAFT');
    const linkedLine = batch.items.find((row) => row.platformReturnId !== null);
    const manualLine = batch.items.find((row) => row.platformReturnId === null);
    expect(linkedLine).toBeDefined();
    expect(manualLine).toBeDefined();

    // Receive locks the line set.
    const received = await client.post(`/api/v1/returns/batches/${batch.id}/receive`, {});
    expect(received.status).toBe(200);

    // SELLABLE with an explicit bin: RETURN_RECEIPT receive, on hand +1
    // (the SKU had zero stock - inspection is what books it).
    const inspectOk = await client.post(`/api/v1/returns/items/${linkedLine!.id}/inspect`, {
      condition: 'SELLABLE',
      binId,
    });
    expect(inspectOk.status, JSON.stringify(inspectOk.body.error ?? {})).toBe(200);
    const afterOk = await inventoryOf(linkedLine!.skuId);
    expect(afterOk.reduce((sum, row) => sum + Number(row.onHandQty), 0)).toBe(1);
    const txOk = await transactionsOf(linkedLine!.skuId);
    const returnTx = txOk.find((row) => row.referenceType === 'RETURN_RECEIPT');
    expect(returnTx).toBeDefined();
    expect(returnTx?.referenceId).toBe(linkedLine!.id);
    expect(returnTx?.eventType).toBe('RECEIVE');

    // 批次详情回显回库库位编码（2026-11-03：运营要能确认货落到哪个库位）。
    const detailAfter = await client.get<{
      items: Array<{ id: string; binId: string | null; binCode: string | null }>;
    }>(`/api/v1/returns/batches/${batch.id}`);
    const inspectedLine = detailAfter.body.data.items.find((row) => row.id === linkedLine!.id);
    expect(inspectedLine?.binId).toBe(binId);
    expect(inspectedLine?.binCode).toBeTruthy();

    // DEFECTIVE without a bin: STAGING fallback + quarantine condition +
    // RETURN_DIFFERENCE raised (the line is platform-linked).
    const inspectDefective = await client.post(`/api/v1/returns/items/${manualLine!.id}/inspect`, {
      condition: 'DEFECTIVE',
    });
    expect(inspectDefective.status, JSON.stringify(inspectDefective.body.error ?? {})).toBe(200);
    const defectiveRows = await inventoryOf(manualLine!.skuId, 'DEFECTIVE');
    expect(defectiveRows.reduce((sum, row) => sum + Number(row.onHandQty), 0)).toBe(2);
    const staging = await client.get<Array<{ binCode: string }>>(
      `/api/v1/warehouses/${warehouseId}/bins?pageSize=100`,
    );
    expect(staging.body.data.some((bin) => bin.binCode === 'STAGING')).toBe(true);
    // No difference exception for the MANUAL line (unlinked).
    const diffExceptions = await client.get<Array<{ referenceId: string; status: string }>>(
      `/api/v1/exceptions?exceptionType=RETURN_DIFFERENCE&status=OPEN&pageSize=50`,
    );
    expect(diffExceptions.body.data.some((row) => row.referenceId === manualLine!.id)).toBe(false);

    // Verdict is one-shot: re-inspecting is rejected.
    const again = await client.post(`/api/v1/returns/items/${linkedLine!.id}/inspect`, {
      condition: 'LOST',
    });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('RETURN_ITEM_INVALID_CONDITION');

    // LOST on the linked line? We consumed it with SELLABLE - use a fresh
    // platform-linked line to cover RETURN_DIFFERENCE + LOST + completion.
    rfbsReturns.push({
      return_id: 3,
      return_number: 'IT-RET-R3',
      posting_number: 'IT-RET-ORD-1',
      order_number: '779',
      created_at: new Date().toISOString(),
      state: { state: 'new', money_return_state_name: 'Не оплачено' },
      product: { sku: 720000001, offer_id: 'RTN', price: 4590 },
    });
    await client.post('/api/v1/returns/platform/sync', { storeId });
    const batch2Created = await client.post<ReturnBatchShape & { items: ReturnBatchItemShape[] }>(
      '/api/v1/returns/batches',
      {
        warehouseId,
        items: [{ platformReturnId: pendingReturn!.id, quantity: '1' }],
      },
    );
    expect(batch2Created.status).toBe(409); // platform return already consumed
    const orphanList = await client.get<Array<{ id: string }>>(
      `/api/v1/returns/platform?storeId=${storeId}&linked=false&pageSize=50`,
    );
    const r3 = orphanList.body.data.find((row) => row.id !== undefined);
    const batch2 = await client.post<ReturnBatchShape & { items: ReturnBatchItemShape[] }>(
      '/api/v1/returns/batches',
      {
        warehouseId,
        items: [{ platformReturnId: r3!.id, quantity: '1' }],
      },
    );
    expect([200, 201]).toContain(batch2.status);
    await client.post(`/api/v1/returns/batches/${batch2.body.data.id}/receive`, {});
    const lost = await client.post(
      `/api/v1/returns/items/${batch2.body.data.items[0]!.id}/inspect`,
      { condition: 'LOST' },
    );
    expect(lost.status).toBe(200);
    // LOST wrote no stock: total on-hand for that sku is still 1.
    const afterLost = await inventoryOf(batch2.body.data.items[0]!.skuId);
    expect(afterLost.reduce((sum, row) => sum + Number(row.onHandQty), 0)).toBe(1);
    // Platform-linked + not sellable => RETURN_DIFFERENCE.
    const diff = await client.get<Array<{ referenceId: string; status: string }>>(
      `/api/v1/exceptions?exceptionType=RETURN_DIFFERENCE&status=OPEN&pageSize=50`,
    );
    expect(diff.body.data.some((row) => row.referenceId === batch2.body.data.items[0]!.id)).toBe(
      true,
    );
    // All lines terminal => batch COMPLETED automatically.
    const batch2After = await client.get<ReturnBatchShape & { items: ReturnBatchItemShape[] }>(
      `/api/v1/returns/batches/${batch2.body.data.id}`,
    );
    expect(batch2After.body.data.status).toBe('COMPLETED');

    // First batch also completed (both lines terminal).
    const batch1After = await client.get<ReturnBatchShape & { items: ReturnBatchItemShape[] }>(
      `/api/v1/returns/batches/${batch.id}`,
    );
    expect(batch1After.body.data.status).toBe('COMPLETED');
  }, 120_000);

  it('draft cancel never touches stock', async () => {
    const skuId = await newMappedSku('CXL', 720000003, '0');
    const created = await client.post('/api/v1/returns/batches', {
      warehouseId,
      items: [{ skuId, quantity: '5' }],
    });
    expect([200, 201]).toContain(created.status);
    const cancelled = await client.post(
      `/api/v1/returns/batches/${created.body.data.id}/cancel`,
      {},
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const rows = await inventoryOf(skuId);
    expect(rows).toHaveLength(0);
    const tx = await transactionsOf(skuId);
    expect(tx).toHaveLength(0);
  });
});

interface ReturnBatchShape {
  id: string;
  batchNo: string;
  status: string;
}

interface ReturnBatchItemShape {
  id: string;
  skuId: string;
  platformReturnId: string | null;
}
