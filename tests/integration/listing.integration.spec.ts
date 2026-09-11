import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * THE critical Sprint 1 listing acceptance (task §84):
 * Case A one SKU -> two listings in one store;
 * Case B one listing -> multiple variants mapped to different SKUs;
 * Case C same offer_id in two stores, resolver must not cross stores;
 * Case D ambiguous candidates within one store -> AMBIGUOUS, never first-row.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3107';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

let ozonPlatformId = '';
let wbPlatformId = '';
let storeA = '';
let storeB = '';
let wbStore = '';
let skuBlack = '';
let skuBlue = '';

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3107', REDIS_URL: 'redis://localhost:6379/6' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
  wbPlatformId = platforms.body.data.find((platform) => platform.code === 'WB')?.id ?? '';

  const storeA_ = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-A`,
    name: 'A',
  });
  const storeB_ = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-B`,
    name: 'B',
  });
  const wbStore_ = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: wbPlatformId,
    storeCode: `${PREFIX}-W`,
    name: 'W',
  });
  storeA = storeA_.body.data.id;
  storeB = storeB_.body.data.id;
  wbStore = wbStore_.body.data.id;

  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} VK87`,
  });
  const black = await client.post<{ id: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} 黑`,
  });
  const blue = await client.post<{ id: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} 蓝`,
  });
  skuBlack = black.body.data.id;
  skuBlue = blue.body.data.id;
});

afterAll(async () => {
  await api.stop();
});

describe('Case A: one internal SKU -> multiple listings, same store (task §84)', () => {
  it('creates Listing 1 and Listing 2 for the same SKU in OZON store A', async () => {
    const l1 = await client.post<{ id: string; platformProductId: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P1`,
      title: 'Listing 1',
      skuVariants: [{ skuId: skuBlack, offerId: `${PREFIX}-OFF1` }],
    });
    expect(l1.body.success).toBe(true);

    const l2 = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P2`,
      title: 'Listing 2',
      skuVariants: [{ skuId: skuBlack, offerId: `${PREFIX}-OFF2` }],
    });
    expect(l2.body.success).toBe(true);

    const wb = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: wbPlatformId,
      storeId: wbStore,
      platformProductId: `${PREFIX}-W1`,
      title: 'WB Listing',
      skuVariants: [{ skuId: skuBlack, offerId: `${PREFIX}-WOFF` }],
    });
    expect(wb.body.success).toBe(true);
  });

  it('rejects duplicate store + platform_product_id', async () => {
    const dup = await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P1`,
      skuVariants: [{ skuId: skuBlack }],
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error?.code).toBe('LISTING_ALREADY_EXISTS');
  });

  // Decision 0012: orders resolve by platformSkuId/sellerSku/offerId, so a
  // mapping carrying none of them can never be matched. Letting it be created
  // only defers the failure to an inexplicable ORDER_SKU_MAPPING_FAILED.
  it('rejects a variant mapping with no platform identifier at all', async () => {
    // Dedicated store + SKU: this case must not add mappings to the shared
    // SKU/store whose counts other tests assert.
    const store = await client.post<{ id: string }>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-NOID`,
      name: 'NOID',
    });
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} NOID`,
    });
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} NOID`,
    });
    const noId = await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-NOID`,
      skuVariants: [{ skuId: sku.body.data.id }],
    });
    expect(noId.status).toBe(422);
    expect(noId.body.error?.code).toBe('LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED');
  });

  it('accepts a variant mapping that carries only an offer id', async () => {
    const store = await client.post<{ id: string }>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-OFFONLY`,
      name: 'OFFONLY',
    });
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} OFFONLY`,
    });
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} OFFONLY`,
    });
    const offerOnly = await client.post<{ skus: Array<{ id: string; offerId: string | null }> }>(
      '/api/v1/listings',
      {
        platformId: ozonPlatformId,
        storeId: store.body.data.id,
        platformProductId: `${PREFIX}-OFFONLY`,
        skuVariants: [{ skuId: sku.body.data.id, offerId: `${PREFIX}-OFFONLY-1` }],
      },
    );
    expect(offerOnly.status).toBe(201);
    expect(offerOnly.body.data.skus[0]?.offerId).toBe(`${PREFIX}-OFFONLY-1`);
  });

  it('shows all three mappings on the SKU (task §91 key acceptance)', async () => {
    const mappings = await client.get<Array<{ storeCode: string; platformProductId: string }>>(
      `/api/v1/listings/skus/${skuBlack}/mappings`,
    );
    expect(mappings.body.data).toHaveLength(3);
    expect(mappings.body.data.map((row) => row.platformProductId).sort()).toEqual(
      [`${PREFIX}-P1`, `${PREFIX}-P2`, `${PREFIX}-W1`].sort(),
    );
  });
});

describe('Case B: one listing -> multiple variant SKUs (task §84)', () => {
  it('creates a listing with black + blue variants in one submit', async () => {
    const listing = await client.post<{ skus: Array<{ offerId: string }> }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P3`,
      title: 'variants',
      skuVariants: [
        { skuId: skuBlack, offerId: 'V-BLK' },
        { skuId: skuBlue, offerId: 'V-BLU' },
      ],
    });
    expect(listing.body.data.skus).toHaveLength(2);
    expect(listing.body.data.skus.map((sku) => sku.offerId)).toEqual(['V-BLK', 'V-BLU']);
  });

  it('rejects mapping the same SKU to the same listing twice', async () => {
    const detail = await client.get<{ skus: Array<{ id: string }> }>(
      `/api/v1/listings?keyword=${PREFIX}-P3`,
    );
    const listingList = await client.get<Array<{ id: string; platformProductId: string }>>(
      `/api/v1/listings?keyword=${PREFIX}-P3`,
    );
    const listingId = listingList.body.data[0]?.id ?? '';
    void detail;
    const dup = await client.post(`/api/v1/listings/${listingId}/skus`, { skuId: skuBlack });
    expect(dup.status).toBe(409);
  });
});

describe('Case C: same offer_id in two stores, store-scoped resolution (task §84)', () => {
  it('allows the same offer string under different stores and resolves per store', async () => {
    // store A already has OFF1 -> black; create store B listing with SAME offer -> blue
    const listing = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeB,
      platformProductId: `${PREFIX}-B1`,
      skuVariants: [{ skuId: skuBlue, offerId: `${PREFIX}-OFF1` }],
    });
    expect(listing.body.success).toBe(true);

    const inA = await client.get<{ internalSkuCode: string }>(
      `/api/v1/listings/resolve?storeId=${storeA}&offerId=${PREFIX}-OFF1`,
    );
    expect(inA.body.data.internalSkuCode).toMatch(/SKU\d{6}/);

    const inB = await client.get<{ internalSkuCode: string }>(
      `/api/v1/listings/resolve?storeId=${storeB}&offerId=${PREFIX}-OFF1`,
    );
    expect(inB.body.data.internalSkuCode).toMatch(/SKU\d{6}/);
    expect(inB.body.data.internalSkuCode).not.toBe(inA.body.data.internalSkuCode);
  });

  it('fails with LISTING_SKU_RESOLVE_FAILED for unknown identifiers', async () => {
    const failed = await client.get(`/api/v1/listings/resolve?storeId=${storeA}&offerId=GHOST`);
    expect(failed.status).toBe(404);
    expect(failed.body.error?.code).toBe('LISTING_SKU_RESOLVE_FAILED');
  });
});

describe('Case D: ambiguity within one store -> AMBIGUOUS (task §84)', () => {
  it('never takes the first row when multiple candidates match', async () => {
    // Store B second listing with the same offer -> now two candidates in B.
    const listing = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeB,
      platformProductId: `${PREFIX}-B2`,
      skuVariants: [{ skuId: skuBlack, offerId: `${PREFIX}-OFF1` }],
    });
    expect(listing.body.success).toBe(true);

    const ambiguous = await client.get(
      `/api/v1/listings/resolve?storeId=${storeB}&offerId=${PREFIX}-OFF1`,
    );
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error?.code).toBe('LISTING_SKU_RESOLVE_AMBIGUOUS');
    const candidates = ambiguous.body.error?.details['candidateIds'] as string[];
    expect(candidates).toHaveLength(2);
  });
});

describe('listing filters (task §68)', () => {
  it('filters by store / sku / mapping state with paging', async () => {
    const byStore = await client.get<Array<{ storeCode: string }>>(
      `/api/v1/listings?storeId=${storeA}&pageSize=20`,
    );
    expect(byStore.body.data.every((row) => row.storeCode === `${PREFIX}-A`)).toBe(true);

    const bySku = await client.get<Array<{ platformProductId: string }>>(
      `/api/v1/listings?skuId=${skuBlack}&pageSize=50`,
    );
    expect(bySku.body.data.length).toBeGreaterThanOrEqual(3);

    const unmapped = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeB,
      platformProductId: `${PREFIX}-EMPTY`,
      skuVariants: [],
    });
    expect(unmapped.body.success).toBe(true);
    const unmappedList = await client.get<
      Array<{ platformProductId: string; mappingCount: number; mappingStatus: string }>
    >(`/api/v1/listings?storeId=${storeB}&mappingState=UNMAPPED`);
    expect(unmappedList.body.data.map((row) => row.platformProductId)).toContain(`${PREFIX}-EMPTY`);
    // A listing with no variants must report UNMAPPED on the row itself, not
    // only under the filter - otherwise the status column and the counter
    // derived from this same filter contradict each other on one screen.
    const emptyRow = unmappedList.body.data.find(
      (row) => row.platformProductId === `${PREFIX}-EMPTY`,
    );
    expect(emptyRow?.mappingStatus).toBe('UNMAPPED');
  });

  it('row mappingStatus agrees with the mappingState filter', async () => {
    // Self-contained: make sure an unmapped listing exists in storeA too.
    await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-EMPTY-A`,
      skuVariants: [],
    });

    for (const state of ['MAPPED', 'UNMAPPED'] as const) {
      const filtered = await client.get<
        Array<{ platformProductId: string; mappingStatus: string }>
      >(`/api/v1/listings?storeId=${storeA}&mappingState=${state}&pageSize=50`);
      expect(filtered.body.data.length).toBeGreaterThan(0);
      // Every row returned by the filter must carry that same status: the
      // status column and the counter built on this filter share one meaning.
      expect(filtered.body.data.every((row) => row.mappingStatus === state)).toBe(true);
    }
  });
});
