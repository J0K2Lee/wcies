import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * 重复档案候选（2026-10-24 用户指示）：映射 / 建档之前提示已存在的档案。
 *
 * 覆盖三档与硬反证：
 * - SAME_VARIANT：同店铺里这个平台变体已经挂在某 SKU 上；
 * - SAME_FACT：跨店铺同一平台标识，或名称签名一致；
 * - SIMILAR_VARIANT：同型号的另一个配色（只提示、不推荐）；
 * - 硬反证（型号不同 / 配色不同）不产生候选。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3124';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

let ozonPlatformId = '';
let storeA = '';
let storeB = '';

interface Candidate {
  skuId: string;
  skuCode: string;
  nameZh: string;
  level: string;
  evidence: string[];
}

async function seedListing(input: {
  storeId: string;
  variants: Array<{
    platformSkuId: string;
    offerId?: string | null;
    skuId?: string | null;
  }>;
}): Promise<{ listingId: string; mappingIds: string[] }> {
  const listing = await db.query<{ id: string }>(
    `INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     RETURNING id`,
    [ozonPlatformId, input.storeId, `${PREFIX}-PP-${randomUUID().slice(0, 8)}`, `${PREFIX} 标题`],
  );
  const mappingIds: string[] = [];
  for (const variant of input.variants) {
    const mapping = await db.query<{ id: string }>(
      `INSERT INTO platform_listing_skus
         (listing_id, sku_id, mapping_status, platform_sku_id, offer_id, seller_sku, status)
       VALUES ($1, $2, $3, $4, $5, NULL, 'ACTIVE')
       RETURNING id`,
      [
        listing.rows[0]!.id,
        variant.skuId ?? null,
        variant.skuId === undefined || variant.skuId === null ? 'UNMAPPED' : 'MAPPED',
        variant.platformSkuId,
        variant.offerId ?? null,
      ],
    );
    mappingIds.push(mapping.rows[0]!.id);
  }
  return { listingId: listing.rows[0]!.id, mappingIds };
}

async function newSku(nameZh: string, brandId?: string): Promise<{ id: string; skuCode: string }> {
  const created = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
    nameZh,
    ...(brandId === undefined ? {} : { brandId }),
  });
  expect(created.status, JSON.stringify(created.body.error ?? {})).toBe(201);
  return created.body.data;
}

async function candidates(
  listingId: string,
  mappingId: string,
  query: { name?: string; brandId?: string } = {},
): Promise<{ candidates: Candidate[]; recommendedSkuId: string | null }> {
  const params = new URLSearchParams();
  if (query.name !== undefined) params.set('name', query.name);
  if (query.brandId !== undefined) params.set('brandId', query.brandId);
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const response = await client.get<{ candidates: Candidate[]; recommendedSkuId: string | null }>(
    `/api/v1/listings/${listingId}/skus/${mappingId}/match-candidates${suffix}`,
  );
  expect(response.status, JSON.stringify(response.body.error ?? {})).toBe(200);
  return response.body.data;
}

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3124', REDIS_URL: 'redis://localhost:6379/11' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const a = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-MA`,
    name: `${PREFIX} 候选A店`,
  });
  storeA = a.body.data.id;
  const b = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-MB`,
    name: `${PREFIX} 候选B店`,
  });
  storeB = b.body.data.id;
}, 180_000);

afterAll(async () => {
  await api.stop();
  await db.end();
});

describe('重复档案候选（映射/建档之前）', () => {
  it('同店铺同一平台变体已挂到某 SKU → SAME_VARIANT 且被推荐', async () => {
    const sku = await newSku(`${PREFIX} 已挂档案`);
    const taken = await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-1`, offerId: `${PREFIX}-OFF-1`, skuId: sku.id }],
    });
    const pending = await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-1B`, offerId: `${PREFIX}-OFF-1` }],
    });

    const result = await candidates(pending.listingId, pending.mappingIds[0]!);
    const hit = result.candidates.find((item) => item.skuId === sku.id);
    expect(hit?.level).toBe('SAME_VARIANT');
    expect(hit?.evidence.join('；')).toContain('本店铺');
    expect(result.recommendedSkuId).toBe(sku.id);
    // 已映射的那条记录自身不应出现在它自己的候选里
    const self = await candidates(taken.listingId, taken.mappingIds[0]!);
    expect(self.candidates.some((item) => item.skuId === sku.id)).toBe(false);
  });

  it('跨店铺同一平台标识 → SAME_FACT（提示优先复用，不建重复档案）', async () => {
    const sku = await newSku(`${PREFIX} 跨店档案`);
    await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-2`, offerId: `${PREFIX}-OFF-2`, skuId: sku.id }],
    });
    const pending = await seedListing({
      storeId: storeB,
      variants: [{ platformSkuId: `${PREFIX}-PS-2B`, offerId: `${PREFIX}-OFF-2` }],
    });

    const result = await candidates(pending.listingId, pending.mappingIds[0]!);
    const hit = result.candidates.find((item) => item.skuId === sku.id);
    expect(hit?.level).toBe('SAME_FACT');
    expect(hit?.evidence.join('；')).toContain('同一平台标识');
    expect(result.recommendedSkuId).toBe(sku.id);
  });

  it('名称签名一致 → SAME_FACT；同型号不同配色 → SIMILAR_VARIANT 且不推荐', async () => {
    const brand = await client.post<{ id: string }>('/api/v1/brands', {
      name: `${PREFIX} 候选品牌`,
    });
    const brandId = brand.body.data.id;
    // 白银：与建档名称只差品类词与分隔符
    const silver = await newSku(`${PREFIX} V9 TURBO+耳机-白银`, brandId);
    // 白色：同型号的另一配色
    const white = await newSku(`${PREFIX} V9 TURBO+耳机-白色`, brandId);

    const pending = await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-3`, offerId: `${PREFIX}-OFF-3` }],
    });

    const same = await candidates(pending.listingId, pending.mappingIds[0]!, {
      name: `${PREFIX} V9 TURBO+-白银`,
      brandId,
    });
    const silverHit = same.candidates.find((item) => item.skuId === silver.id);
    expect(silverHit?.level).toBe('SAME_FACT');
    expect(same.recommendedSkuId).toBe(silver.id);

    const colorOnly = await candidates(pending.listingId, pending.mappingIds[0]!, {
      name: `${PREFIX} V9 TURBO+-白色`,
      brandId,
    });
    // 白色档案自身：名称签名一致 → SAME_FACT 并成为推荐目标
    const whiteHit = colorOnly.candidates.find((item) => item.skuId === white.id);
    expect(whiteHit?.level).toBe('SAME_FACT');
    // 白色与白银是不同变体：白银只以 SIMILAR 出现（不预选）
    const silverAsSimilar = colorOnly.candidates.find((item) => item.skuId === silver.id);
    expect(silverAsSimilar?.level).toBe('SIMILAR_VARIANT');
    expect(colorOnly.recommendedSkuId).toBe(white.id);
  });

  it('型号/档位不同是硬反证：不产生候选也不预选', async () => {
    const brand = await client.post<{ id: string }>('/api/v1/brands', {
      name: `${PREFIX} 反证品牌`,
    });
    const brandId = brand.body.data.id;
    await newSku(`${PREFIX} A7 V3 Ultra+-鼠标-白色`, brandId);
    await newSku(`${PREFIX} V9 TURBO-耳机-白色`, brandId);

    const pending = await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-4`, offerId: `${PREFIX}-OFF-4` }],
    });

    const otherModel = await candidates(pending.listingId, pending.mappingIds[0]!, {
      name: `${PREFIX} A5 V3 Ultra+-鼠标-白色`,
      brandId,
    });
    expect(otherModel.candidates).toEqual([]);
    expect(otherModel.recommendedSkuId).toBeNull();

    const otherTier = await candidates(pending.listingId, pending.mappingIds[0]!, {
      name: `${PREFIX} V9 TURBO+-耳机-白色`,
      brandId,
    });
    expect(otherTier.candidates).toEqual([]);
  });

  it('变体不属于该 listing 时 404（候选查询不越权）', async () => {
    const first = await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-5`, offerId: `${PREFIX}-OFF-5` }],
    });
    const second = await seedListing({
      storeId: storeA,
      variants: [{ platformSkuId: `${PREFIX}-PS-6`, offerId: `${PREFIX}-OFF-6` }],
    });
    const response = await client.get(
      `/api/v1/listings/${first.listingId}/skus/${second.mappingIds[0]}/match-candidates`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe('LISTING_SKU_MAPPING_NOT_FOUND');
  });
});
