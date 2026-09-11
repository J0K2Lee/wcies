import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 7 T5.1/T5.6 barcode resolution acceptance: the receiving workbench
 * resolves scanned codes to internal SKUs through the HTTP endpoint, and a
 * barcode bound on the spot (D13) resolves immediately afterwards.
 * Barcodes are globally unique - no store dimension on this lookup
 * (unlike the store-scoped Listing Resolver).
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

interface Resolved {
  skuId: string;
  skuCode: string;
  skuName: string;
  matchedBarcode: string;
  barcodeType: string;
  serialTracking: boolean;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
});

describe('barcode resolution (Sprint 7 T5)', () => {
  it('resolves a bound barcode to its SKU; unknown barcodes 404', async () => {
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 条码商品`,
    });
    const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 条码SKU`,
    });
    const barcode = `${PREFIX}-EAN-1`;
    await client.post(`/api/v1/skus/${sku.body.data.id}/barcodes`, {
      barcode,
      barcodeType: 'EAN',
    });

    const hit = await client.get<Resolved>(
      `/api/v1/barcodes/${encodeURIComponent(barcode)}/resolve`,
    );
    expect(hit.status).toBe(200);
    expect(hit.body.data.skuId).toBe(sku.body.data.id);
    expect(hit.body.data.skuCode).toBe(sku.body.data.skuCode);
    expect(hit.body.data.matchedBarcode).toBe(barcode);
    expect(hit.body.data.barcodeType).toBe('EAN');
    expect(hit.body.data.serialTracking).toBe(false);

    const miss = await client.get(`/api/v1/barcodes/${encodeURIComponent('NO-SUCH-CODE')}/resolve`);
    expect(miss.status).toBe(404);
  });

  it('a barcode bound on the spot resolves immediately (D13 receiving flow)', async () => {
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 补码商品`,
    });
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 补码SKU`,
    });
    const vendorCode = `${PREFIX}-VENDOR-9`;

    // Before binding: unknown.
    const before = await client.get(`/api/v1/barcodes/${encodeURIComponent(vendorCode)}/resolve`);
    expect(before.status).toBe(404);

    // Bind the physical vendor code to the SKU (multi-barcode: existing
    // barcodes are never replaced). This legacy endpoint returns 201 CREATED.
    const bound = await client.post<{ barcode: string; barcodeType: string }>(
      `/api/v1/skus/${sku.body.data.id}/barcodes`,
      { barcode: vendorCode, barcodeType: 'OTHER' },
    );
    expect(bound.status).toBe(201);

    const after = await client.get<Resolved>(
      `/api/v1/barcodes/${encodeURIComponent(vendorCode)}/resolve`,
    );
    expect(after.status).toBe(200);
    expect(after.body.data.skuId).toBe(sku.body.data.id);

    // The generated internal barcode (WCSKU...) also resolves.
    const generated = await client.post<{ barcode: string }>(
      `/api/v1/skus/${sku.body.data.id}/barcodes/generate-internal`,
    );
    expect(generated.body.data.barcode).toMatch(/^WCSKU\d{8}$/);
    const internal = await client.get<Resolved>(
      `/api/v1/barcodes/${generated.body.data.barcode}/resolve`,
    );
    expect(internal.status).toBe(200);
    expect(internal.body.data.skuId).toBe(sku.body.data.id);
    expect(internal.body.data.barcodeType).toBe('INTERNAL');
  });
});
