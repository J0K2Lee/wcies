import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 6 forced delete (decision 0008) against real PostgreSQL.
 *
 * The rule under test: forcing cascades MASTER DATA (barcodes, images,
 * platform mappings, bundle links) but never business history. Inventory
 * ledger rows, order lines, picking/package/shipment records are evidence the
 * goods physically moved, so they must always block - this is the boundary
 * that keeps AGENTS.md §25 traceability intact while still letting a seller
 * clean up a mis-created SKU.
 *
 * V1 (2026-10-13): the forced PRODUCT delete (which cascaded the product's
 * SKUs) is gone with the product layer - only the SKU-level force delete
 * remains.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3113';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

interface IdDto {
  id: string;
}

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3113', REDIS_URL: 'redis://localhost:6379/9' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
  await db.end();
});

/** Creates a SKU + internal barcode directly (V1: no product layer). */
async function seedSkuWithBarcode(label: string): Promise<{ skuId: string }> {
  const sku = await client.post<IdDto>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label} SKU`,
  });
  const skuId = sku.body.data.id;
  await client.post(`/api/v1/skus/${skuId}/barcodes/generate-internal`, {});
  return { skuId };
}

describe('forced SKU delete (decision 0008)', () => {
  it('cascades the SKU and its master-data children', async () => {
    const { skuId } = await seedSkuWithBarcode('SKU强制删除');

    const deleted = await client.del(`/api/v1/skus/${skuId}?force=true`);
    expect(deleted.status).toBe(200);

    const skuRows = await db.query('SELECT 1 FROM skus WHERE id = $1', [skuId]);
    const barcodeRows = await db.query('SELECT 1 FROM sku_barcodes WHERE sku_id = $1', [skuId]);
    expect(skuRows.rowCount).toBe(0);
    expect(barcodeRows.rowCount).toBe(0);
  });

  it('refuses a forced SKU delete once the SKU has inventory history', async () => {
    const { skuId } = await seedSkuWithBarcode('SKU强制删除-有库存');

    const warehouse = await client.post<IdDto>('/api/v1/warehouses', {
      name: `${PREFIX} SKU强制仓`,
      warehouseType: 'SELF',
    });
    const warehouseId = warehouse.body.data.id;
    const bin = await client.post<IdDto>(`/api/v1/warehouses/${warehouseId}/bins`, {
      binCode: `${PREFIX}-FD02`,
    });
    await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId: bin.body.data.id,
      quantity: 1,
      referenceType: 'TEST',
      referenceId: skuId,
      idempotencyKey: `${PREFIX}-force-history-2`,
    });

    const rejected = await client.del(`/api/v1/skus/${skuId}?force=true`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe('SKU_HAS_BUSINESS_HISTORY');

    const rows = await db.query('SELECT 1 FROM skus WHERE id = $1', [skuId]);
    expect(rows.rowCount).toBe(1);
  });

  it('detaches the SKU from its listing but keeps the listing record', async () => {
    const { skuId } = await seedSkuWithBarcode('SKU强制删除-映射');

    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozonId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    const store = await client.post<IdDto>('/api/v1/stores', {
      platformId: ozonId,
      name: `${PREFIX} 强制删除店`,
    });
    const listing = await client.post<IdDto>('/api/v1/listings', {
      platformId: ozonId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-FD-L1`,
      title: `${PREFIX} 强制删除列表`,
      skuVariants: [{ platformSkuId: `${PREFIX}-FD-PS1`, skuId }],
    });
    const listingId = listing.body.data.id;

    const deleted = await client.del(`/api/v1/skus/${skuId}?force=true`);
    expect(deleted.status).toBe(200);

    const mappingRows = await db.query('SELECT 1 FROM platform_listing_skus WHERE sku_id = $1', [
      skuId,
    ]);
    const listingRows = await db.query('SELECT 1 FROM platform_listings WHERE id = $1', [
      listingId,
    ]);
    expect(mappingRows.rowCount).toBe(0);
    // The listing itself survives: it still describes a real platform product.
    expect(listingRows.rowCount).toBe(1);
  });
});
