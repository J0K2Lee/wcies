import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * 订单行 → 本店未映射变体（2026-11-09 修复）：
 *
 * 事故：订单行 offerId `GRAVASTAR-MH1`，同一店铺还有 `GRAVASTAR-MH1-PRO` 的
 * 链接。旧前端用模糊 keyword 搜索取第一条链接，再「找不到精确匹配就选第一个
 * 未映射变体」，于是映射弹窗把订单行预选成了 PRO。
 *
 * 这里验证新的精确解析端点：
 * - platform_sku_id > seller_sku > offer_id 强次序、逐条精确匹配；
 * - 店铺隔离（同标识不同店铺互不串）；
 * - 查不到返回 data=null（不猜）。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3129';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

let ozonPlatformId = '';
let storeA = '';
let storeB = '';

async function seedListing(input: {
  storeId: string;
  platformProductId: string;
  variants: Array<{
    platformSkuId: string;
    sellerSku?: string | null;
    offerId?: string | null;
  }>;
}): Promise<{ listingId: string; variantIds: string[] }> {
  const listing = await db.query<{ id: string }>(
    `INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     RETURNING id`,
    [ozonPlatformId, input.storeId, `${PREFIX}-${input.platformProductId}`, `IT ${PREFIX}`],
  );
  const listingId = listing.rows[0]!.id;
  const variantIds: string[] = [];
  for (const variant of input.variants) {
    const row = await db.query<{ id: string }>(
      `INSERT INTO platform_listing_skus
         (listing_id, sku_id, mapping_status, platform_sku_id, seller_sku, offer_id, status)
       VALUES ($1, NULL, 'UNMAPPED', $2, $3, $4, 'ACTIVE')
       RETURNING id`,
      [listingId, variant.platformSkuId, variant.sellerSku ?? null, variant.offerId ?? null],
    );
    variantIds.push(row.rows[0]!.id);
  }
  return { listingId, variantIds };
}

async function resolve(query: Record<string, string>): Promise<{
  listingId: string;
  variantId: string;
  matchedBy: string;
} | null> {
  const params = new URLSearchParams(query);
  const response = await client.get<{
    listingId: string;
    variantId: string;
    matchedBy: string;
  } | null>(`/api/v1/listings/unmapped-variant?${params.toString()}`);
  expect(response.status, JSON.stringify(response.body.error ?? {})).toBe(200);
  return response.body.data;
}

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3129', REDIS_URL: 'redis://localhost:6379/15' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const a = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-UA`,
    name: `${PREFIX} 解析A店`,
  });
  storeA = a.body.data.id;
  const b = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-UB`,
    name: `${PREFIX} 解析B店`,
  });
  storeB = b.body.data.id;
}, 180_000);

afterAll(async () => {
  await api.stop();
  await db.end();
});

describe('未映射变体精确解析（订单行 → 链接变体）', () => {
  it('同店存在 MH1 与 MH1-PRO 时，sellerSku=MH1 命中 MH1 而不是 PRO', async () => {
    const mh1 = await seedListing({
      storeId: storeA,
      platformProductId: 'GRAVASTAR-MH1',
      variants: [
        {
          platformSkuId: `${PREFIX}-MH1-PS`,
          sellerSku: 'GRAVASTAR-MH1',
          offerId: 'GRAVASTAR-MH1',
        },
      ],
    });
    const pro = await seedListing({
      storeId: storeA,
      platformProductId: 'GRAVASTAR-MH1-PRO',
      variants: [
        {
          platformSkuId: `${PREFIX}-MH1PRO-PS`,
          sellerSku: 'GRAVASTAR-MH1-PRO',
          offerId: 'GRAVASTAR-MH1-PRO',
        },
      ],
    });

    const bySeller = await resolve({ storeId: storeA, sellerSku: 'GRAVASTAR-MH1' });
    expect(bySeller?.listingId).toBe(mh1.listingId);
    expect(bySeller?.variantId).toBe(mh1.variantIds[0]);
    expect(bySeller?.matchedBy).toBe('sellerSku');

    // 标题前缀相同也不会串到 PRO 的链接上。
    expect(bySeller?.variantId).not.toBe(pro.variantIds[0]);

    // offerId 兜底同样精确。
    const byOffer = await resolve({ storeId: storeA, offerId: 'GRAVASTAR-MH1' });
    expect(byOffer?.listingId).toBe(mh1.listingId);
  });

  it('标识强次序：platformSkuId 优先于 sellerSku', async () => {
    const a = await seedListing({
      storeId: storeA,
      platformProductId: 'PRIORITY-A',
      variants: [
        { platformSkuId: `${PREFIX}-PRI-A`, sellerSku: 'PRI-SHARED', offerId: 'PRI-A-OFF' },
      ],
    });
    const b = await seedListing({
      storeId: storeA,
      platformProductId: 'PRIORITY-B',
      variants: [
        { platformSkuId: `${PREFIX}-PRI-B`, sellerSku: 'PRI-SHARED', offerId: 'PRI-B-OFF' },
      ],
    });

    const hit = await resolve({
      storeId: storeA,
      platformSkuId: `${PREFIX}-PRI-B`,
      sellerSku: 'PRI-SHARED',
    });
    expect(hit?.listingId).toBe(b.listingId);
    expect(hit?.variantId).toBe(b.variantIds[0]);
    expect(hit?.matchedBy).toBe('platformSkuId');
    void a;
  });

  it('店铺隔离：同标识只在本店范围内解析', async () => {
    const inA = await seedListing({
      storeId: storeA,
      platformProductId: 'SCOPE-A',
      variants: [{ platformSkuId: `${PREFIX}-SCOPE`, sellerSku: 'SCOPE-SKU' }],
    });
    const inB = await seedListing({
      storeId: storeB,
      platformProductId: 'SCOPE-B',
      variants: [{ platformSkuId: `${PREFIX}-SCOPE`, sellerSku: 'SCOPE-SKU' }],
    });

    const a = await resolve({ storeId: storeA, sellerSku: 'SCOPE-SKU' });
    const b = await resolve({ storeId: storeB, sellerSku: 'SCOPE-SKU' });
    expect(a?.listingId).toBe(inA.listingId);
    expect(b?.listingId).toBe(inB.listingId);
    expect(a?.variantId).not.toBe(b?.variantId);
  });

  it('已映射变体不参与解析；查不到返回 data=null', async () => {
    const listing = await seedListing({
      storeId: storeA,
      platformProductId: 'MAPPED-ONLY',
      variants: [{ platformSkuId: `${PREFIX}-MAPPED-ONLY-PS`, sellerSku: 'MAPPED-ONLY' }],
    });
    // 把它绑到一个内部 SKU（变成 MAPPED）。
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      nameZh: `${PREFIX} 已映射SKU`,
    });
    await db.query(
      `UPDATE platform_listing_skus SET sku_id = $1, mapping_status = 'MAPPED' WHERE id = $2`,
      [sku.body.data.id, listing.variantIds[0]],
    );

    const mapped = await resolve({ storeId: storeA, sellerSku: 'MAPPED-ONLY' });
    expect(mapped).toBeNull();

    const ghost = await resolve({ storeId: storeA, sellerSku: `${PREFIX}-GHOST-${randomUUID()}` });
    expect(ghost).toBeNull();
  });
});
