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

  const black = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} 黑`,
  });
  const blue = await client.post<{ id: string }>('/api/v1/skus', {
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
    // Decision 0016: every variant carries a platform SKU id (the resolution
    // identifier); the offer id rides along as a platform fact.
    const l1 = await client.post<{ id: string; platformProductId: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P1`,
      title: 'Listing 1',
      skuVariants: [
        { skuId: skuBlack, platformSkuId: `${PREFIX}-P1SKU`, offerId: `${PREFIX}-OFF1` },
      ],
    });
    expect(l1.body.success).toBe(true);

    const l2 = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P2`,
      title: 'Listing 2',
      skuVariants: [
        { skuId: skuBlack, platformSkuId: `${PREFIX}-P2SKU`, offerId: `${PREFIX}-OFF2` },
      ],
    });
    expect(l2.body.success).toBe(true);

    const wb = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: wbPlatformId,
      storeId: wbStore,
      platformProductId: `${PREFIX}-W1`,
      title: 'WB Listing',
      skuVariants: [
        { skuId: skuBlack, platformSkuId: `${PREFIX}-W1SKU`, offerId: `${PREFIX}-WOFF` },
      ],
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
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
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

  // Decision 0012 + 0016: a mapping needs a RESOLUTION identifier (platform
  // SKU id or seller SKU). Offer id alone is refused - the platform lets
  // operators edit it, so resolution could silently drift.
  it('rejects a variant mapping that carries only an offer id', async () => {
    const store = await client.post<{ id: string }>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-OFFONLY`,
      name: 'OFFONLY',
    });
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      nameZh: `${PREFIX} OFFONLY`,
    });
    const offerOnly = await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-OFFONLY`,
      skuVariants: [{ skuId: sku.body.data.id, offerId: `${PREFIX}-OFFONLY-1` }],
    });
    expect(offerOnly.status).toBe(422);
    expect(offerOnly.body.error?.code).toBe('LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED');
    expect(offerOnly.body.error?.message).toContain('不作为订单解析依据');
  });

  it('accepts an offer id when a resolution identifier is present too', async () => {
    const store = await client.post<{ id: string }>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-OFFPLUS`,
      name: 'OFFPLUS',
    });
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      nameZh: `${PREFIX} OFFPLUS`,
    });
    const withSkuId = await client.post<{
      skus: Array<{ platformSkuId: string | null; offerId: string | null }>;
    }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-OFFPLUS`,
      skuVariants: [
        {
          skuId: sku.body.data.id,
          platformSkuId: `${PREFIX}-OFFPLUS-SKU`,
          offerId: `${PREFIX}-OFFPLUS-1`,
        },
      ],
    });
    expect(withSkuId.status).toBe(201);
    // offer_id stays a synced platform fact (decision 0016 §7).
    expect(withSkuId.body.data.skus[0]?.offerId).toBe(`${PREFIX}-OFFPLUS-1`);
    expect(withSkuId.body.data.skus[0]?.platformSkuId).toBe(`${PREFIX}-OFFPLUS-SKU`);
  });

  it('shows all three mappings on the SKU (task §91 key acceptance)', async () => {
    const mappings = await client.get<Array<{ storeCode: string; platformProductId: string }>>(
      `/api/v1/listings/skus/${skuBlack}/mappings`,
    );
    // P1/P2/W1 (offer-only variants above are rejected, so they add nothing).
    expect(mappings.body.data).toHaveLength(3);
    expect(mappings.body.data.map((row) => row.platformProductId).sort()).toEqual(
      [`${PREFIX}-P1`, `${PREFIX}-P2`, `${PREFIX}-W1`].sort(),
    );
  });
});

describe('Case B: one listing -> multiple variant SKUs (task §84)', () => {
  it('creates a listing with black + blue variants in one submit', async () => {
    const listing = await client.post<{
      skus: Array<{ offerId: string; platformSkuId: string | null }>;
    }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-P3`,
      title: 'variants',
      skuVariants: [
        { skuId: skuBlack, platformSkuId: 'V-BLK-SKU', offerId: 'V-BLK' },
        { skuId: skuBlue, platformSkuId: 'V-BLU-SKU', offerId: 'V-BLU' },
      ],
    });
    expect(listing.body.data.skus).toHaveLength(2);
    expect(listing.body.data.skus.map((sku) => sku.offerId)).toEqual(['V-BLK', 'V-BLU']);
    expect(listing.body.data.skus.map((sku) => sku.platformSkuId)).toEqual([
      'V-BLK-SKU',
      'V-BLU-SKU',
    ]);
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

describe('Case C: same platform SKU id in two stores, store-scoped resolution (task §84)', () => {
  it('allows the same identifier string under different stores and resolves per store', async () => {
    // store A already has P1SKU -> black; create store B listing with the SAME
    // platform SKU string -> blue.
    const listing = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeB,
      platformProductId: `${PREFIX}-B1`,
      skuVariants: [{ skuId: skuBlue, platformSkuId: `${PREFIX}-P1SKU` }],
    });
    expect(listing.body.success).toBe(true);

    const inA = await client.get<{ internalSkuCode: string }>(
      `/api/v1/listings/resolve?storeId=${storeA}&platformSkuId=${PREFIX}-P1SKU`,
    );
    expect(inA.body.data.internalSkuCode).toMatch(/SKU\d{6}/);

    const inB = await client.get<{ internalSkuCode: string }>(
      `/api/v1/listings/resolve?storeId=${storeB}&platformSkuId=${PREFIX}-P1SKU`,
    );
    expect(inB.body.data.internalSkuCode).toMatch(/SKU\d{6}/);
    expect(inB.body.data.internalSkuCode).not.toBe(inA.body.data.internalSkuCode);
  });

  it('fails with LISTING_SKU_RESOLVE_FAILED for unknown identifiers', async () => {
    const failed = await client.get(
      `/api/v1/listings/resolve?storeId=${storeA}&platformSkuId=GHOST`,
    );
    expect(failed.status).toBe(404);
    expect(failed.body.error?.code).toBe('LISTING_SKU_RESOLVE_FAILED');
  });

  // Decision 0016 closes the same door on the EDIT path: identifiers may be
  // replaced, but never erased down to an unresolvable row.
  it('refuses to erase the last resolution identifier of an existing mapping', async () => {
    const store = await client.post<{ id: string }>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-ERASE`,
      name: 'ERASE',
    });
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      nameZh: `${PREFIX} ERASE`,
    });
    const listing = await client.post<{
      id: string;
      skus: Array<{ id: string }>;
    }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: store.body.data.id,
      platformProductId: `${PREFIX}-ERASE`,
      skuVariants: [{ skuId: sku.body.data.id, platformSkuId: `${PREFIX}-ERASE-SKU` }],
    });
    const listingId = listing.body.data.id;
    const mappingId = listing.body.data.skus[0]?.id ?? '';

    const erased = await client.patch(`/api/v1/listings/${listingId}/skus/${mappingId}`, {
      platformSkuId: null,
    });
    expect(erased.status).toBe(422);
    expect(erased.body.error?.code).toBe('LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED');

    // Replacing it (not erasing) stays allowed.
    const replaced = await client.patch(`/api/v1/listings/${listingId}/skus/${mappingId}`, {
      platformSkuId: `${PREFIX}-ERASE-SKU-2`,
    });
    expect(replaced.status).toBe(200);
    const resolved = await client.get<{ internalSkuId: string }>(
      `/api/v1/listings/resolve?storeId=${store.body.data.id}&platformSkuId=${PREFIX}-ERASE-SKU-2`,
    );
    expect(resolved.body.data.internalSkuId).toBe(sku.body.data.id);
  });

  // Decision 0016 acceptance: operators DO rename offer ids on the platform.
  // Resolution must be unaffected by that.
  it('keeps resolving a listing after its offer id is changed', async () => {
    const listing = await client.post<{
      id: string;
      skus: Array<{ id: string; offerId: string | null }>;
    }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-RENAMED`,
      skuVariants: [
        { skuId: skuBlue, platformSkuId: `${PREFIX}-RENAME-SKU`, offerId: `${PREFIX}-OLD-OFFER` },
      ],
    });
    const mappingId = listing.body.data.skus[0]?.id ?? '';

    const before = await client.get<{ internalSkuId: string; matchedOfferId: null }>(
      `/api/v1/listings/resolve?storeId=${storeA}&platformSkuId=${PREFIX}-RENAME-SKU`,
    );
    expect(before.body.data.internalSkuId).toBe(skuBlue);
    expect(before.body.data.matchedOfferId).toBeNull();

    // The platform-side rename (what Listing Sync would upsert).
    const renamed = await client.patch(
      `/api/v1/listings/${listing.body.data.id}/skus/${mappingId}`,
      { offerId: `${PREFIX}-NEW-OFFER` },
    );
    expect(renamed.status).toBe(200);

    const after = await client.get<{ internalSkuId: string }>(
      `/api/v1/listings/resolve?storeId=${storeA}&platformSkuId=${PREFIX}-RENAME-SKU`,
    );
    expect(after.body.data.internalSkuId).toBe(skuBlue);

    // ...and the OLD offer is no longer an identifier at all: the field is not
    // even part of the request contract any more (Decision 0016 removed it).
    const byOldOffer = await client.get(
      `/api/v1/listings/resolve?storeId=${storeA}&offerId=${PREFIX}-OLD-OFFER`,
    );
    expect(byOldOffer.status).toBe(400);
    expect(byOldOffer.body.error?.code).toBe('COMMON_VALIDATION_FAILED');
  });
});

describe('Case D: ambiguity within one store -> AMBIGUOUS (task §84)', () => {
  it('never takes the first row when multiple candidates match', async () => {
    // Store B second listing with the same platform SKU id -> two candidates.
    const listing = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeB,
      platformProductId: `${PREFIX}-B2`,
      skuVariants: [{ skuId: skuBlack, platformSkuId: `${PREFIX}-P1SKU` }],
    });
    expect(listing.body.success).toBe(true);

    const ambiguous = await client.get(
      `/api/v1/listings/resolve?storeId=${storeB}&platformSkuId=${PREFIX}-P1SKU`,
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

describe('keyword search spans variant identifiers and internal SKU code', () => {
  let storeK = '';
  let offerId = '';
  let platformSkuId = '';
  let sellerSku = '';
  let skuCode = '';

  beforeAll(async () => {
    // Dedicated store + SKU: keeps the shared fixtures' counts untouched.
    const store = await client.post<{ id: string }>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-K`,
      name: 'K',
    });
    storeK = store.body.data.id;
    const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
      nameZh: `${PREFIX} 搜索黑`,
    });
    skuCode = sku.body.data.skuCode;
    offerId = `${PREFIX}-KWOFF`;
    platformSkuId = `${PREFIX}-KWSKU`;
    sellerSku = `${PREFIX}-KWSELLER`;
    const listing = await client.post<{ id: string }>('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeK,
      platformProductId: `${PREFIX}-KWPROD`,
      skuVariants: [{ skuId: sku.body.data.id, platformSkuId, sellerSku, offerId }],
    });
    expect(listing.body.success).toBe(true);
  });

  async function hitBy(keyword: string): Promise<boolean> {
    // The exception center deep-links with keyword only (no storeId).
    const rows = await client.get<Array<{ platformProductId: string }>>(
      `/api/v1/listings?keyword=${encodeURIComponent(keyword)}&pageSize=100`,
    );
    expect(rows.body.success).toBe(true);
    return rows.body.data.some((row) => row.platformProductId === `${PREFIX}-KWPROD`);
  }

  it('matches the variant offer_id (exception center deep link)', async () => {
    expect(await hitBy(offerId)).toBe(true);
  });

  it('matches the variant platform_sku_id', async () => {
    expect(await hitBy(platformSkuId)).toBe(true);
  });

  it('matches the variant seller_sku', async () => {
    expect(await hitBy(sellerSku)).toBe(true);
  });

  it('matches the mapped internal SKU code', async () => {
    expect(skuCode).not.toBe('');
    expect(await hitBy(skuCode)).toBe(true);
  });

  it('does not match unrelated keywords', async () => {
    expect(await hitBy(`${PREFIX}-NO-SUCH-IDENTIFIER`)).toBe(false);
  });
});
