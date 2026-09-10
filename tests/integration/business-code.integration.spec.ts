import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 6 business-code system (decisions 0001/0002) against real
 * PostgreSQL: scoped auto-coding, scope isolation, atomic concurrent takes,
 * overflow carry, SKU derivation from the product sequence.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3110';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3110', REDIS_URL: 'redis://localhost:6379/5' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
  await db.end();
});

async function scopeValue(scopeKey: string): Promise<number | null> {
  const result = await db.query<{ next_value: string }>(
    'SELECT next_value FROM business_code_sequences WHERE scope_key = $1',
    [scopeKey],
  );
  return result.rows[0] ? Number(result.rows[0].next_value) : null;
}

describe('scoped auto-coding (decision 0001)', () => {
  it('auto-codes a warehouse per type scope (ZG-%02d for SELF)', async () => {
    const created = await client.post<{ warehouseCode: string }>('/api/v1/warehouses', {
      name: `${PREFIX} 自管仓`,
      warehouseType: 'SELF',
    });
    expect(created.body.success).toBe(true);
    expect(created.body.data.warehouseCode).toMatch(/^ZG-\d{2,}$/);
  });

  it('isolates store scopes per platform (ON/WS independent increments)', async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozonId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    const wbId = platforms.body.data.find((platform) => platform.code === 'WB')?.id ?? '';

    const wbBefore = await scopeValue('store:WB');

    const first = await client.post<{ storeCode: string }>('/api/v1/stores', {
      platformId: ozonId,
      name: `${PREFIX} OZON auto 1`,
    });
    const second = await client.post<{ storeCode: string }>('/api/v1/stores', {
      platformId: ozonId,
      name: `${PREFIX} OZON auto 2`,
    });
    const n1 = Number((first.body.data.storeCode.match(/^ON-(\d+)$/) ?? [])[1]);
    const n2 = Number((second.body.data.storeCode.match(/^ON-(\d+)$/) ?? [])[1]);
    expect(Number.isInteger(n1)).toBe(true);
    expect(n2).toBe(n1 + 1);

    const wb = await client.post<{ storeCode: string }>('/api/v1/stores', {
      platformId: wbId,
      name: `${PREFIX} WB auto`,
    });
    const m = Number((wb.body.data.storeCode.match(/^WS-(\d+)$/) ?? [])[1]);
    // WB scope advanced exactly once from its own prior value - the two OZON
    // takes must not have touched it.
    expect(m).toBe((wbBefore ?? 0) + 1);
  });

  it('auto-codes brands and categories (BN%05d / CN%05d)', async () => {
    const brand = await client.post<{ code: string }>('/api/v1/brands', {
      name: `${PREFIX} 测试品牌`,
    });
    expect(brand.body.data.code).toMatch(/^BN\d{5,}$/);

    const category = await client.post<{ code: string }>('/api/v1/categories', {
      nameZh: `${PREFIX} 测试分类`,
    });
    expect(category.body.data.code).toMatch(/^CN\d{5,}$/);
  });

  it('carries overflow naturally (ZG-100 after 99, not an error)', async () => {
    // Idempotent across repeated runs: never rewind below an existing code.
    const maxUsed = await db.query<{ m: number }>(
      `SELECT COALESCE(MAX(substring(warehouse_code from '[0-9]+$')::integer), 99) AS m
         FROM warehouses WHERE warehouse_code ~ '^ZG-[0-9]+$'`,
    );
    const base = Math.max(99, Number(maxUsed.rows[0]?.m ?? 99));
    await db.query(
      `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
       VALUES ('warehouse:SELF', $1, now())
       ON CONFLICT (scope_key) DO UPDATE SET next_value = $1, updated_at = now()`,
      [base],
    );
    const created = await client.post<{ warehouseCode: string }>('/api/v1/warehouses', {
      name: `${PREFIX} 溢出仓`,
      warehouseType: 'SELF',
    });
    expect(created.body.data.warehouseCode).toBe(`ZG-${base + 1}`);
  });

  it('hands out N unique numbers to N concurrent creators', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        client
          .post<{ id: string; productCode: string }>('/api/v1/products', {
            nameZh: `${PREFIX} 并发商品 ${index}`,
          })
          .then((response) => {
            expect(response.body.success).toBe(true);
            return response.body.data.productCode;
          }),
      ),
    );
    expect(new Set(results).size).toBe(20);
    const seqRows = await db.query<{ code_seq: string }>(
      'SELECT code_seq FROM products WHERE product_code = ANY($1::text[]) ORDER BY code_seq',
      [results],
    );
    expect(seqRows.rows.map((row) => Number(row.code_seq))).toEqual(
      seqRows.rows.map((row) => Number(row.code_seq)).sort((a, b) => a - b),
    );
    expect(new Set(seqRows.rows.map((row) => row.code_seq)).size).toBe(20);
  });
});

describe('SKU derivation from the product sequence (decision 0002)', () => {
  it('derives SKU{product 6}{in-product 3}; every product restarts at 001', async () => {
    const productA = await client.post<{ id: string; productCode: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 派生商品 A`,
    });
    const productB = await client.post<{ id: string; productCode: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 派生商品 B`,
    });
    const seqA = Number(productA.body.data.productCode.replace(/^PN/, ''));
    const seqB = Number(productB.body.data.productCode.replace(/^PN/, ''));

    const skuA1 = await client.post<{ skuCode: string }>('/api/v1/skus', {
      productId: productA.body.data.id,
      nameZh: `${PREFIX} A-1`,
    });
    const skuA2 = await client.post<{ skuCode: string }>('/api/v1/skus', {
      productId: productA.body.data.id,
      nameZh: `${PREFIX} A-2`,
    });
    const skuB1 = await client.post<{ skuCode: string }>('/api/v1/skus', {
      productId: productB.body.data.id,
      nameZh: `${PREFIX} B-1`,
    });

    expect(skuA1.body.data.skuCode).toBe(`SKU${String(seqA).padStart(6, '0')}001`);
    expect(skuA2.body.data.skuCode).toBe(`SKU${String(seqA).padStart(6, '0')}002`);
    expect(skuB1.body.data.skuCode).toBe(`SKU${String(seqB).padStart(6, '0')}001`);
  });
});

describe('immutable codes after creation (decision #7/#8/#3)', () => {
  it('rejects productCode changes on PATCH (forbidNonWhitelisted guard)', async () => {
    const product = await client.post<{ id: string; productCode: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 不可改编码商品`,
    });
    const patched = await client.patch(`/api/v1/products/${product.body.data.id}`, {
      productCode: 'PN999999',
      nameZh: `${PREFIX} 改名`,
    });
    expect(patched.status).toBe(400);

    const renamed = await client.patch<{ productCode: string }>(
      `/api/v1/products/${product.body.data.id}`,
      { nameZh: `${PREFIX} 改名` },
    );
    expect(renamed.body.data.productCode).toBe(product.body.data.productCode);
  });

  it('rejects skuCode changes on PATCH', async () => {
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} SKU冻结商品`,
    });
    const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 冻结SKU`,
    });
    const patched = await client.patch(`/api/v1/skus/${sku.body.data.id}`, {
      skuCode: 'SKU999999999',
    });
    expect(patched.status).toBe(400);
  });

  it('rejects warehouseType changes on PATCH', async () => {
    const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
      name: `${PREFIX} 类型不可改仓`,
      warehouseType: 'SELF',
    });
    const patched = await client.patch(`/api/v1/warehouses/${warehouse.body.data.id}`, {
      warehouseType: 'PLATFORM',
    });
    expect(patched.status).toBe(400);
  });
});
