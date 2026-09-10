import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * List performance acceptance (task §92):
 * 2000 SKUs + 5000 listing mappings seeded via direct SQL (dev-scale data),
 * then paged list endpoints must answer well under 500ms.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3109';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const platform = await db.query<{ id: string }>("SELECT id FROM platforms WHERE code = 'OZON'");
  const platformId = platform.rows[0]?.id as string;

  const store = await db.query<{ id: string }>(
    'INSERT INTO stores (platform_id, store_code, name) VALUES ($1, $2, $3) RETURNING id',
    [platformId, `${PREFIX}-PERF`, 'perf store'],
  );
  const storeId = store.rows[0]?.id as string;

  // Reserve one number from the product scope so the raw insert can never
  // collide with numbers the scope hands out later.
  const reserved = await db.query<{ first_seq: string }>(
    `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
     VALUES ('product', 1, now())
     ON CONFLICT (scope_key)
     DO UPDATE SET next_value = business_code_sequences.next_value + 1, updated_at = now()
     RETURNING (next_value - 1 + 1)::text AS first_seq`,
  );
  const product = await db.query<{ id: string }>(
    'INSERT INTO products (product_code, code_seq, name_zh, status) VALUES ($1, $2, $3, $4) RETURNING id',
    [`${PREFIX}-PERFPRD`, Number(reserved.rows[0]?.first_seq ?? 1), 'perf product', 'ACTIVE'],
  );
  const productId = product.rows[0]?.id as string;

  // 2000 SKUs in one INSERT (unnest keeps it a single round trip).
  const skuCount = 2000;
  const codes = Array.from(
    { length: skuCount },
    (_, i) => `${PREFIX}-PSKU-${String(i).padStart(5, '0')}`,
  );
  const names = codes.map((code) => `${code} 名称`);
  await db.query(
    `INSERT INTO skus (product_id, sku_code, name_zh, status)
     SELECT $1, c, n, 'ACTIVE' FROM unnest($2::text[], $3::text[]) AS t(c, n)`,
    [productId, codes, names],
  );
  const skuIds = await db.query<{ id: string }>('SELECT id FROM skus WHERE sku_code LIKE $1', [
    `${PREFIX}-PSKU-%`,
  ]);

  // 5000 mappings: 50 listings x 100 variant rows across two stores.
  const listingCount = 50;
  for (let i = 0; i < listingCount; i += 1) {
    await db.query(
      'INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title) VALUES ($1, $2, $3, $4)',
      [platformId, storeId, `${PREFIX}-PERF-L${i}`, `perf listing ${i}`],
    );
  }
  const listings = await db.query<{ id: string }>(
    'SELECT id FROM platform_listings WHERE platform_product_id LIKE $1',
    [`${PREFIX}-PERF-L%`],
  );
  const mappingListingIds: string[] = [];
  const mappingSkuIds: string[] = [];
  const offerIds: string[] = [];
  for (let m = 0; m < 5000; m += 1) {
    const listing = listings.rows[m % listingCount];
    const sku = skuIds.rows[m % skuIds.rows.length];
    mappingListingIds.push(listing?.id as string);
    mappingSkuIds.push(sku?.id as string);
    offerIds.push(`${PREFIX}-PERF-OFF-${m}`);
  }
  await db.query(
    `INSERT INTO platform_listing_skus (listing_id, sku_id, offer_id, status)
     SELECT l, s, o, 'ACTIVE' FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS t(l, s, o)`,
    [mappingListingIds, mappingSkuIds, offerIds],
  );

  api = spawnApiEntry('main.js', { PORT: '3109', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
}, 180_000);

afterAll(async () => {
  await api.stop();
  // Dev database cleanup: remove this run's bulk data.
  await db.query('DELETE FROM platform_listing_skus WHERE offer_id LIKE $1', [
    `${PREFIX}-PERF-OFF-%`,
  ]);
  await db.query('DELETE FROM platform_listings WHERE platform_product_id LIKE $1', [
    `${PREFIX}-PERF-L%`,
  ]);
  await db.query('DELETE FROM skus WHERE sku_code LIKE $1', [`${PREFIX}-PSKU-%`]);
  await db.query('DELETE FROM products WHERE product_code = $1', [`${PREFIX}-PERFPRD`]);
  await db.query('DELETE FROM stores WHERE store_code = $1', [`${PREFIX}-PERF`]);
  await db.end();
});

async function measureMs(path: string): Promise<{ ms: number; ok: boolean }> {
  const started = performance.now();
  const response = await fetch(`${BASE}${path}`, {
    headers: { Cookie: (client as unknown as { cookies: string }).cookies },
  });
  const ms = performance.now() - started;
  return { ms, ok: response.status === 200 };
}

describe('list performance at 2000 SKUs / 5000 mappings (task §92)', () => {
  it('pages the SKU list under 500ms', async () => {
    await client.get(`/api/v1/skus?keyword=${PREFIX}-PSKU&pageSize=50`);
    const { ms, ok } = await measureMs(
      `/api/v1/skus?keyword=${encodeURIComponent(PREFIX + '-PSKU')}&pageSize=50`,
    );
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(500);
  });

  it('filters SKUs by store under 500ms', async () => {
    const stores = await client.get<Array<{ storeCode: string; id: string }>>(
      `/api/v1/stores?keyword=${PREFIX}-PERF`,
    );
    const storeId = stores.body.data[0]?.id ?? '';
    const { ms, ok } = await measureMs(`/api/v1/skus?storeId=${storeId}&pageSize=50`);
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(500);
  });

  it('pages the listing list under 500ms', async () => {
    const { ms, ok } = await measureMs(
      `/api/v1/listings?keyword=${encodeURIComponent(PREFIX + '-PERF-L')}&pageSize=50`,
    );
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(500);
  });

  it('pages the product list under 500ms', async () => {
    const { ms, ok } = await measureMs('/api/v1/products?pageSize=50');
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(500);
  });
});
