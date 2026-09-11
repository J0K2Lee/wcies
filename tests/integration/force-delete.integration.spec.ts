import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 6 forced delete (decision 0008) against real PostgreSQL.
 *
 * The rule under test: forcing cascades MASTER DATA (SKUs, barcodes, images,
 * platform mappings, bundle links) but never business history. Inventory
 * ledger rows, order lines, picking/package/shipment records are evidence the
 * goods physically moved, so they must always block - this is the boundary
 * that keeps AGENTS.md §25 traceability intact while still letting a seller
 * clean up a mis-created product.
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

/** Creates product -> SKU -> internal barcode; returns all three ids. */
async function seedProductWithSku(label: string): Promise<{ productId: string; skuId: string }> {
  const product = await client.post<IdDto>('/api/v1/products', {
    nameZh: `${PREFIX} ${label}`,
  });
  const productId = product.body.data.id;
  const sku = await client.post<IdDto>('/api/v1/skus', {
    productId,
    nameZh: `${PREFIX} ${label} SKU`,
  });
  const skuId = sku.body.data.id;
  await client.post(`/api/v1/skus/${skuId}/barcodes/generate-internal`, {});
  return { productId, skuId };
}

describe('forced product delete (decision 0008)', () => {
  it('cascades product + SKUs + barcodes when there is no business history', async () => {
    const { productId, skuId } = await seedProductWithSku('强制删除-无流水');

    const deleted = await client.del(`/api/v1/products/${productId}?force=true`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);

    const productRows = await db.query('SELECT 1 FROM products WHERE id = $1', [productId]);
    const skuRows = await db.query('SELECT 1 FROM skus WHERE id = $1', [skuId]);
    const barcodeRows = await db.query('SELECT 1 FROM sku_barcodes WHERE sku_id = $1', [skuId]);
    expect(productRows.rowCount).toBe(0);
    expect(skuRows.rowCount).toBe(0);
    expect(barcodeRows.rowCount).toBe(0);
  });

  it('refuses when a SKU already has inventory history (PRODUCT_HAS_BUSINESS_HISTORY)', async () => {
    const { productId, skuId } = await seedProductWithSku('强制删除-有库存');

    // Real inventory movement through the Inventory module (never raw SQL on
    // balances): the ledger row is what makes the SKU non-deletable.
    const warehouse = await client.post<IdDto>('/api/v1/warehouses', {
      name: `${PREFIX} 强制删除仓`,
      warehouseType: 'SELF',
    });
    const warehouseId = warehouse.body.data.id;
    const bin = await client.post<IdDto>(`/api/v1/warehouses/${warehouseId}/bins`, {
      binCode: `${PREFIX}-FD01`,
    });

    const received = await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId: bin.body.data.id,
      quantity: 3,
      referenceType: 'TEST',
      referenceId: skuId,
      idempotencyKey: `${PREFIX}-force-history-1`,
    });
    expect(received.status).toBe(200);

    const rejected = await client.del(`/api/v1/products/${productId}?force=true`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe('PRODUCT_HAS_BUSINESS_HISTORY');
    // The message must name the blocking table so the seller knows why.
    expect(rejected.body.error?.message).toContain('inventory');

    // Nothing was removed.
    const productRows = await db.query('SELECT 1 FROM products WHERE id = $1', [productId]);
    const skuRows = await db.query('SELECT 1 FROM skus WHERE id = $1', [skuId]);
    expect(productRows.rowCount).toBe(1);
    expect(skuRows.rowCount).toBe(1);
  });

  it('records FORCE_DELETE in the audit log with the cascade count', async () => {
    const { productId } = await seedProductWithSku('强制删除-审计');

    await client.del(`/api/v1/products/${productId}?force=true`);

    const logs = await db.query<{ action: string; changes: Record<string, unknown> }>(
      `SELECT action, changes FROM operation_logs
        WHERE entity_id = $1 AND action = 'FORCE_DELETE'`,
      [productId],
    );
    expect(logs.rows.length).toBe(1);
    expect(logs.rows[0]?.changes).toMatchObject({ cascadedSkus: { from: 1 } });
  });

  it('plain delete still refuses a product that has SKUs (no implicit cascade)', async () => {
    const { productId } = await seedProductWithSku('普通删除-不级联');

    const rejected = await client.del(`/api/v1/products/${productId}`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe('PRODUCT_IN_USE');

    const rows = await db.query('SELECT 1 FROM products WHERE id = $1', [productId]);
    expect(rows.rowCount).toBe(1);
  });
});

describe('forced SKU delete (decision 0008)', () => {
  it('cascades the SKU and its master-data children', async () => {
    const { skuId } = await seedProductWithSku('SKU强制删除');

    const deleted = await client.del(`/api/v1/skus/${skuId}?force=true`);
    expect(deleted.status).toBe(200);

    const skuRows = await db.query('SELECT 1 FROM skus WHERE id = $1', [skuId]);
    const barcodeRows = await db.query('SELECT 1 FROM sku_barcodes WHERE sku_id = $1', [skuId]);
    expect(skuRows.rowCount).toBe(0);
    expect(barcodeRows.rowCount).toBe(0);
  });

  it('refuses a forced SKU delete once the SKU has inventory history', async () => {
    const { skuId } = await seedProductWithSku('SKU强制删除-有库存');

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
    const { skuId } = await seedProductWithSku('SKU强制删除-映射');

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
