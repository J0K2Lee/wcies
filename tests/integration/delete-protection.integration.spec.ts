import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess, bindPlatformWarehouse } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 6 zero-reference delete policy (decision 0003) against real
 * PostgreSQL: every entity deletes when nothing references it and answers a
 * business error (never a raw FK error) when something does; the historic
 * mapping-delete gap (order_items.listing_sku_id) is covered too.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3112';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

interface IdDto {
  id: string;
}

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3112', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
  await db.end();
});

describe('warehouse / bin delete (decision 0003)', () => {
  it('deletes a zero-reference warehouse; GET then 404s', async () => {
    const created = await client.post<IdDto>('/api/v1/warehouses', {
      name: `${PREFIX} 待删仓`,
      warehouseType: 'SELF',
    });
    const deleted = await client.del(`/api/v1/warehouses/${created.body.data.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);

    const gone = await client.get(`/api/v1/warehouses/${created.body.data.id}`);
    expect(gone.status).toBe(404);
  });

  it('rejects a warehouse that has bins (WAREHOUSE_IN_USE, readable message)', async () => {
    const created = await client.post<IdDto>('/api/v1/warehouses', {
      name: `${PREFIX} 占用仓`,
      warehouseType: 'SELF',
    });
    const warehouseId = created.body.data.id;
    await client.post(`/api/v1/warehouses/${warehouseId}/bins`, {
      binCode: `${PREFIX}-B01`,
    });

    const rejected = await client.del(`/api/v1/warehouses/${warehouseId}`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe('WAREHOUSE_IN_USE');
    expect(rejected.body.error?.message).toContain('只能停用');

    // Zero-reference bin deletes fine; then the warehouse becomes deletable.
    const bins = await client.get<Array<{ id: string; binCode: string }>>(
      `/api/v1/warehouses/${warehouseId}/bins`,
    );
    const binId = bins.body.data.find((bin) => bin.binCode === `${PREFIX}-B01`)?.id ?? '';
    const binDeleted = await client.del(`/api/v1/warehouses/${warehouseId}/bins/${binId}`);
    expect(binDeleted.status).toBe(200);

    const warehouseDeleted = await client.del(`/api/v1/warehouses/${warehouseId}`);
    expect(warehouseDeleted.status).toBe(200);
  });
});

describe('store / binding delete', () => {
  it('deletes a binding and then a zero-reference store', async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozonId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';

    const store = await client.post<IdDto>('/api/v1/stores', {
      platformId: ozonId,
      name: `${PREFIX} 待删店`,
    });
    const storeId = store.body.data.id;

    const warehouse = await client.post<IdDto>('/api/v1/warehouses', {
      name: `${PREFIX} 绑定仓`,
      warehouseType: 'SELF',
    });
    const binding = await bindPlatformWarehouse(client, storeId, warehouse.body.data.id);

    // A store with a binding is IN_USE.
    const storeRejected = await client.del(`/api/v1/stores/${storeId}`);
    expect(storeRejected.status).toBe(409);
    expect(storeRejected.body.error?.code).toBe('STORE_IN_USE');

    // Binding has no inbound references -> deletable.
    const bindingDeleted = await client.del(
      `/api/v1/warehouses/${warehouse.body.data.id}/platform-bindings/${binding.id}`,
    );
    expect(bindingDeleted.status).toBe(200);

    const storeDeleted = await client.del(`/api/v1/stores/${storeId}`);
    expect(storeDeleted.status).toBe(200);

    await client.del(`/api/v1/warehouses/${warehouse.body.data.id}`);
  });
});

describe('brand / category delete', () => {
  it('brand: IN_USE with SKUs, deletable without (V1: brand is a SKU field)', async () => {
    const brand = await client.post<IdDto>('/api/v1/brands', { name: `${PREFIX} 删除品牌` });
    const sku = await client.post<IdDto>('/api/v1/skus', {
      nameZh: `${PREFIX} 引用品牌SKU`,
      brandId: brand.body.data.id,
    });

    const rejected = await client.del(`/api/v1/brands/${brand.body.data.id}`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe('BRAND_IN_USE');
    expect(rejected.body.error?.message).toContain('SKU');

    await client.del(`/api/v1/skus/${sku.body.data.id}`);
    const deleted = await client.del(`/api/v1/brands/${brand.body.data.id}`);
    expect(deleted.status).toBe(200);
  });

  it('category: children / SKUs block; zero-reference deletes (V1)', async () => {
    // L1 -> L2 -> L3 so a SKU can legally sit on the leaf.
    const parent = await client.post<IdDto>('/api/v1/categories', {
      nameZh: `${PREFIX} 删除父类`,
    });
    const mid = await client.post<IdDto>('/api/v1/categories', {
      parentId: parent.body.data.id,
      nameZh: `${PREFIX} 删除中间类`,
    });
    const child = await client.post<IdDto>('/api/v1/categories', {
      parentId: mid.body.data.id,
      nameZh: `${PREFIX} 删除子类`,
    });

    const withChildren = await client.del(`/api/v1/categories/${parent.body.data.id}`);
    expect(withChildren.status).toBe(409);
    expect(withChildren.body.error?.code).toBe('CATEGORY_HAS_CHILDREN');

    const sku = await client.post<IdDto>('/api/v1/skus', {
      nameZh: `${PREFIX} 引用类目SKU`,
      categoryId: child.body.data.id,
    });

    const withSkus = await client.del(`/api/v1/categories/${child.body.data.id}`);
    expect(withSkus.status).toBe(409);
    expect(withSkus.body.error?.code).toBe('CATEGORY_IN_USE');
    expect(withSkus.body.error?.message).toContain('SKU');

    await client.del(`/api/v1/skus/${sku.body.data.id}`);
    const childDeleted = await client.del(`/api/v1/categories/${child.body.data.id}`);
    expect(childDeleted.status).toBe(200);
    const midDeleted = await client.del(`/api/v1/categories/${mid.body.data.id}`);
    expect(midDeleted.status).toBe(200);
    const parentDeleted = await client.del(`/api/v1/categories/${parent.body.data.id}`);
    expect(parentDeleted.status).toBe(200);
  });
});

describe('product / sku delete', () => {
  it('product with SKUs -> PRODUCT_IN_USE; SKU with barcodes -> SKU_IN_USE; empty product deletes', async () => {
    const product = await client.post<IdDto>('/api/v1/products', {
      nameZh: `${PREFIX} 删除商品`,
    });
    const sku = await client.post<IdDto & { skuCode: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 删除SKU`,
    });

    const productRejected = await client.del(`/api/v1/products/${product.body.data.id}`);
    expect(productRejected.status).toBe(409);
    expect(productRejected.body.error?.code).toBe('PRODUCT_IN_USE');

    // Must be unique per run: barcodes are globally unique, and deriving the
    // value from the digits of PREFIX collided across runs (the same digits
    // recurred), leaving the SKU reference-free and making this assertion fail
    // for the wrong reason.
    const uniqueBarcode = `69${String(Date.now()).slice(-11)}`;
    const barcode = await client.post<IdDto>(`/api/v1/skus/${sku.body.data.id}/barcodes`, {
      barcode: uniqueBarcode,
      barcodeType: 'EAN',
    });
    expect(barcode.status).toBe(201);

    const skuRejected = await client.del(`/api/v1/skus/${sku.body.data.id}`);
    expect(skuRejected.status).toBe(409);
    expect(skuRejected.body.error?.code).toBe('SKU_IN_USE');
    expect(skuRejected.body.error?.message).toContain('只能停用');
  });

  it('a SKU without any references deletes; then its product deletes', async () => {
    const product = await client.post<IdDto>('/api/v1/products', {
      nameZh: `${PREFIX} 空商品`,
    });
    const sku = await client.post<IdDto>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 空SKU`,
    });

    const skuDeleted = await client.del(`/api/v1/skus/${sku.body.data.id}`);
    expect(skuDeleted.status).toBe(200);

    const productDeleted = await client.del(`/api/v1/products/${product.body.data.id}`);
    expect(productDeleted.status).toBe(200);
  });
});

describe('listing / mapping delete (incl. the order-history gap fix)', () => {
  it('rejects a listing with mappings; deletes once the mappings are gone', async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozonId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    const store = await client.post<IdDto>('/api/v1/stores', {
      platformId: ozonId,
      name: `${PREFIX} 列表店`,
    });

    const product = await client.post<IdDto>('/api/v1/products', {
      nameZh: `${PREFIX} 列表商品`,
    });
    const sku = await client.post<IdDto>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 列表SKU`,
    });
    // Listings are always created with >= 1 variant (skuVariants is required),
    // so every fresh listing is referenced -> LISTING_IN_USE.
    const listing = await client.post<IdDto>('/api/v1/listings', {
      platformId: ozonId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-MAPPED-L`,
      title: `${PREFIX} 带映射列表`,
      skuVariants: [{ platformSkuId: `${PREFIX}-V1`, skuId: sku.body.data.id }],
    });
    const listingId = listing.body.data.id;

    const listingRejected = await client.del(`/api/v1/listings/${listingId}`);
    expect(listingRejected.status).toBe(409);
    expect(listingRejected.body.error?.code).toBe('LISTING_IN_USE');

    // The mapping deletes when no order references it... (detail incl. skus)
    const detail = await client.get<{ skus: Array<{ id: string; platformSkuId: string | null }> }>(
      `/api/v1/listings/${listingId}`,
    );
    const mappingId = detail.body.data.skus[0]?.id ?? '';
    const mappingDeleted = await client.del(`/api/v1/listings/${listingId}/skus/${mappingId}`);
    expect(mappingDeleted.status).toBe(200);
    // ...and then the (now empty) listing deletes.
    const listingDeleted = await client.del(`/api/v1/listings/${listingId}`);
    expect(listingDeleted.status).toBe(200);

    await client.del(`/api/v1/skus/${sku.body.data.id}`);
    await client.del(`/api/v1/products/${product.body.data.id}`);
    await client.del(`/api/v1/stores/${store.body.data.id}`);
  });

  it('mapping with order history -> LISTING_SKU_MAPPING_IN_USE (gap fix, no FK error)', async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozonId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    const store = await client.post<IdDto>('/api/v1/stores', {
      platformId: ozonId,
      name: `${PREFIX} 订单店`,
    });
    const product = await client.post<IdDto>('/api/v1/products', {
      nameZh: `${PREFIX} 订单商品`,
    });
    const sku = await client.post<IdDto>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 订单SKU`,
    });
    const listing = await client.post<IdDto>('/api/v1/listings', {
      platformId: ozonId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-ORDER-L`,
      title: `${PREFIX} 订单列表`,
      skuVariants: [{ platformSkuId: `${PREFIX}-OV1`, skuId: sku.body.data.id }],
    });
    const listingId = listing.body.data.id;
    const detail = await client.get<{ skus: Array<{ id: string }> }>(
      `/api/v1/listings/${listingId}`,
    );
    const mappingId = detail.body.data.skus[0]?.id ?? '';

    // Minimal order + order line referencing the mapping (raw SQL: order
    // ingestion is out of scope here; the reference row is what matters).
    const order = await db.query<{ id: string }>(
      `INSERT INTO orders (order_no, store_id, platform_order_id, erp_status, ordered_at)
       VALUES ($1, $2, $3, 'NEW', now()) RETURNING id`,
      [`${PREFIX}-ORD-1`, store.body.data.id, `${PREFIX}-PO-1`],
    );
    await db.query(
      `INSERT INTO order_items (order_id, line_no, listing_sku_id, quantity, fulfillment_status, mapping_status)
       VALUES ($1, 1, $2, 1, 'PENDING', 'MAPPED')`,
      [order.rows[0]?.id, mappingId],
    );

    const rejected = await client.del(`/api/v1/listings/${listingId}/skus/${mappingId}`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe('LISTING_SKU_MAPPING_IN_USE');
    expect(rejected.body.error?.message).toContain('只能停用');
  });
});

describe('operation log for deletes (master-data §11)', () => {
  it('records a DELETE row in operation_logs', async () => {
    const warehouse = await client.post<IdDto>('/api/v1/warehouses', {
      name: `${PREFIX} 审计仓`,
      warehouseType: 'SELF',
    });
    await client.del(`/api/v1/warehouses/${warehouse.body.data.id}`);

    const logs = await db.query<{ action: string; entity_type: string }>(
      `SELECT action, entity_type FROM operation_logs
        WHERE entity_id = $1 AND action = 'DELETE'`,
      [warehouse.body.data.id],
    );
    expect(logs.rows.length).toBeGreaterThan(0);
    expect(logs.rows[0]?.entity_type).toBe('WAREHOUSE');
  });
});
