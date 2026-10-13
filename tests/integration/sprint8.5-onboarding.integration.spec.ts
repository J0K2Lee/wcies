import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 8.5 acceptance against real PostgreSQL + Redis + S3:
 * T1  concurrent double onboard - FOR UPDATE serializes, loser gets 409,
 *     zero orphan master data;
 * T2  multi-variant onboard - every variant builds its OWN SKU (V1: the
 *     product layer and its attach/split modes are gone, decision D5);
 * T3  category system - tree import (dry-run -> conflicts -> single-tx
 *     execute) + composite-key suggestion + remember-this-mapping;
 * T5  v4 attribute prefill (mm/g normalization) through onboard-context
 *     and into the created SKU.
 */
let api: ManagedProcess;
let worker: ManagedProcess;
const BASE = 'http://localhost:3117';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

let ozonPlatformId = '';
let storeId = '';

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3117', REDIS_URL: 'redis://localhost:6379/9' });
  worker = spawnApiEntry('worker.js', { PORT: '3117', REDIS_URL: 'redis://localhost:6379/9' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-S1`,
    name: `${PREFIX} Sprint85店`,
  });
  storeId = store.body.data.id;

  // The synthetic tree/mapping rows below are test-local platform data:
  // clear them so re-runs never hit the unique keys or stale mappings.
  await db.query('DELETE FROM platform_category_nodes WHERE platform_id = $1', [ozonPlatformId]);
  await db.query('DELETE FROM platform_category_mappings WHERE platform_id = $1', [ozonPlatformId]);
});

afterAll(async () => {
  await api.stop();
  await worker.stop();
  await db.end();
});

interface OnboardContextVariant {
  id: string;
  mappingStatus: string;
  descriptionCategoryId: string | null;
  descriptionTypeId: string | null;
  suggestedCategoryId: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  primaryImage: string | null;
  colorImage: string | null;
}

interface OnboardContext {
  listingId: string;
  title: string | null;
  variants: OnboardContextVariant[];
}

interface OnboardResultBody {
  sku: { id: string; skuCode: string };
  barcode: string | null;
}

/** Seeds a synced listing + N UNMAPPED variant rows, like Listing Sync would. */
async function seedListing(input: {
  platformProductId: string;
  title: string | null;
  variants: Array<{
    platformSkuId: string;
    offerId?: string;
    rawData?: Record<string, unknown> | null;
  }>;
}): Promise<{ listingId: string; mappingIds: string[] }> {
  const listing = await db.query<{ id: string }>(
    `INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title, url, status, raw_data)
     VALUES ($1, $2, $3, $4, NULL, 'ACTIVE', NULL)
     RETURNING id`,
    [ozonPlatformId, storeId, input.platformProductId, input.title],
  );
  const mappingIds: string[] = [];
  for (const variant of input.variants) {
    const mapping = await db.query<{ id: string }>(
      `INSERT INTO platform_listing_skus
         (listing_id, sku_id, mapping_status, platform_sku_id, offer_id, seller_sku, status, raw_data)
       VALUES ($1, NULL, 'UNMAPPED', $2, $3, NULL, 'ACTIVE', $4::jsonb)
       RETURNING id`,
      [
        listing.rows[0].id,
        variant.platformSkuId,
        variant.offerId ?? null,
        variant.rawData === undefined || variant.rawData === null
          ? null
          : JSON.stringify(variant.rawData),
      ],
    );
    mappingIds.push(mapping.rows[0].id);
  }
  return { listingId: listing.rows[0].id, mappingIds };
}

async function onboard(
  listingId: string,
  mappingId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: OnboardResultBody; code?: string }> {
  const response = await client.post<OnboardResultBody>(
    `/api/v1/listings/${listingId}/skus/${mappingId}/onboard`,
    body,
  );
  return {
    status: response.status,
    data: response.body.data,
    code: (response.body as { error?: { code?: string } }).error?.code,
  };
}

async function getOnboardContext(listingId: string): Promise<OnboardContext> {
  const response = await client.get<OnboardContext>(
    `/api/v1/listings/${listingId}/onboard-context`,
  );
  return response.body.data;
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (${sql}) t`,
    params,
  );
  return Number(rows.rows[0]?.cnt ?? 0);
}

describe('T1 concurrent double onboard (FOR UPDATE serialization)', () => {
  const ppid = `${PREFIX}-T1`;
  let seeded: { listingId: string; mappingIds: string[] };

  it('seeds one unmapped variant', async () => {
    seeded = await seedListing({
      platformProductId: ppid,
      title: `${PREFIX} 并发测试`,
      variants: [{ platformSkuId: `${PREFIX}-T1PS1`, offerId: `${PREFIX}-T1O1` }],
    });
  });

  it('two parallel onboards: exactly one 201, one 409, zero orphans', async () => {
    const [first, second] = await Promise.all([
      onboard(seeded.listingId, seeded.mappingIds[0]!, {}),
      onboard(seeded.listingId, seeded.mappingIds[0]!, {}),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.code).toBe('LISTING_SKU_MAPPING_INVALID_STATE');

    // Exactly ONE sku exists for this listing's onboarding - the loser
    // created nothing (no orphan master data).
    const winner = first.status === 201 ? first : second;
    expect(await countRows('SELECT 1 FROM skus WHERE id = $1', [winner.data.sku.id])).toBe(1);
    expect(
      await countRows(
        'SELECT 1 FROM platform_listing_skus WHERE listing_id = $1 AND sku_id IS NOT NULL',
        [seeded.listingId],
      ),
    ).toBe(1);
  });
});

describe('T2 multi-variant onboard (V1: every variant its own SKU)', () => {
  const ppid = `${PREFIX}-T2`;
  let seeded: { listingId: string; mappingIds: string[] };

  it('seeds three unmapped variants', async () => {
    seeded = await seedListing({
      platformProductId: ppid,
      title: `${PREFIX} 多变体`,
      variants: [
        { platformSkuId: `${PREFIX}-T2PS1`, offerId: `${PREFIX}-T2O1` },
        { platformSkuId: `${PREFIX}-T2PS2`, offerId: `${PREFIX}-T2O2` },
        { platformSkuId: `${PREFIX}-T2PS3`, offerId: `${PREFIX}-T2O3` },
      ],
    });
  });

  it('each variant builds its own SKU from the global sequence (no attach/split)', async () => {
    const v1 = await onboard(seeded.listingId, seeded.mappingIds[0]!, {});
    expect(v1.status).toBe(201);

    const v2 = await onboard(seeded.listingId, seeded.mappingIds[1]!, {});
    expect(v2.status).toBe(201);

    const v3 = await onboard(seeded.listingId, seeded.mappingIds[2]!, {});
    expect(v3.status).toBe(201);

    // Three DISTINCT SKUs, numbered consecutively by the single global scope
    // (decision D2) - no per-product derivation, no attach target.
    const codes = [v1.data.sku.skuCode, v2.data.sku.skuCode, v3.data.sku.skuCode];
    expect(new Set(codes).size).toBe(3);
    const numbers = codes.map((code) => Number(code.replace(/^SKU/, '')));
    expect(numbers[1]).toBe(numbers[0]! + 1);
    expect(numbers[2]).toBe(numbers[1]! + 1);

    // 3 SKUs, 3 MAPPED variants - no fission, no orphan.
    expect(
      await countRows(
        `SELECT 1 FROM skus s
         JOIN platform_listing_skus pls ON pls.sku_id = s.id
         WHERE pls.listing_id = $1`,
        [seeded.listingId],
      ),
    ).toBe(3);
  });
});

describe('T3 category system (tree import + composite-key mapping)', () => {
  it('seeds a small synthetic cached tree', async () => {
    await db.query(
      `INSERT INTO platform_category_nodes
         (platform_id, node_kind, external_category_id, external_type_id, parent_node_external_id,
          name_zh, name_ru, level, disabled, fetched_at)
       VALUES
         ($1, 'CATEGORY', 9001, NULL, NULL, $2, $3, 1, false, now()),
         ($1, 'CATEGORY', 9011, NULL, 9001, $4, $5, 2, false, now()),
         ($1, 'TYPE', 9011, 90999, 9011, $6, $7, 3, false, now()),
         ($1, 'CATEGORY', 9002, NULL, NULL, '已禁用类目', 'Отключено', 1, true, now())`,
      [
        ozonPlatformId,
        `${PREFIX} 儿童用品`,
        `${PREFIX}-Детские товары`,
        `${PREFIX} 积木玩具套装`,
        `${PREFIX}-Конструктор`,
        `${PREFIX} 积木`,
        `${PREFIX}-Конструктор-тип`,
      ],
    );
  });

  it('dry-run reports the plan without writing', async () => {
    const preview = await client.post<{
      stats: {
        toCreate: { level1: number; level2: number; level3: number };
        skippedDisabled: number;
      };
      conflicts: unknown[];
      previewTopLevels: Array<{ nameZh: string }>;
    }>('/api/v1/listings/category-import/preview', { platformId: ozonPlatformId });
    expect(preview.status).toBe(200);
    // The disabled root (and nothing under it) is skipped.
    expect(preview.body.data.stats.toCreate).toEqual({ level1: 1, level2: 1, level3: 1 });
    expect(preview.body.data.stats.skippedDisabled).toBe(1);
    expect(preview.body.data.conflicts).toHaveLength(0);
    expect(preview.body.data.previewTopLevels[0]?.nameZh).toBe(`${PREFIX} 儿童用品`);
    expect(
      await countRows('SELECT 1 FROM categories WHERE name_ru IN ($1, $2)', [
        `${PREFIX}-Детские товары`,
        `${PREFIX}-Конструктор`,
      ]),
    ).toBe(0);
  });

  it('execute refuses while a name_ru conflict exists (§89 no silent skip)', async () => {
    // Create an internal category whose name_ru exactly matches a candidate.
    const conflictCategory = await client.post<{ id: string }>('/api/v1/categories', {
      nameZh: `${PREFIX} 内部冲突分类`,
      nameRu: `${PREFIX}-Конструктор`,
    });
    expect(conflictCategory.status).toBe(201);

    const rejected = await client.post('/api/v1/listings/category-import/execute', {
      platformId: ozonPlatformId,
    });
    expect(rejected.status).toBe(409);
    expect((rejected.body as { error?: { code?: string } }).error?.code).toBe(
      'CATEGORY_IMPORT_CONFLICTS',
    );

    // Clean up: rename it away so the import can proceed.
    await client.patch(`/api/v1/categories/${conflictCategory.body.data.id}`, { nameRu: '旧名' });
  });

  it('execute creates the three levels + mapping rows in one transaction', async () => {
    const executed = await client.post<{
      created: { level1: number; level2: number; level3: number };
      mappingCount: number;
    }>('/api/v1/listings/category-import/execute', { platformId: ozonPlatformId });
    expect(executed.status).toBe(200);
    expect(executed.body.data.created).toEqual({ level1: 1, level2: 1, level3: 1 });
    expect(executed.body.data.mappingCount).toBe(1);

    const rows = await db.query<{
      id: string;
      name_zh: string;
      name_ru: string | null;
      level: number;
      parent_id: string | null;
    }>(
      `SELECT id, name_zh, name_ru, level, parent_id FROM categories
       WHERE name_ru IN ($1, $2, $3)`,
      [`${PREFIX}-Детские товары`, `${PREFIX}-Конструктор`, `${PREFIX}-Конструктор-тип`],
    );
    expect(rows.rows).toHaveLength(3);
    const byName = new Map(rows.rows.map((row) => [row.name_ru, row]));
    expect(byName.get(`${PREFIX}-Детские товары`)?.level).toBe(1);
    expect(byName.get(`${PREFIX}-Конструктор`)?.level).toBe(2);
    expect(byName.get(`${PREFIX}-Конструктор-тип`)?.level).toBe(3);
    expect(byName.get(`${PREFIX}-Конструктор-тип`)?.parent_id).toBe(
      byName.get(`${PREFIX}-Конструктор`)?.id,
    );
    expect(byName.get(`${PREFIX}-Конструктор`)?.parent_id).toBe(
      byName.get(`${PREFIX}-Детские товары`)?.id,
    );

    const mappings = await db.query<{ external_category_id: string; external_type_id: string }>(
      `SELECT external_category_id::text, external_type_id::text FROM platform_category_mappings
       WHERE platform_id = $1`,
      [ozonPlatformId],
    );
    expect(mappings.rows).toHaveLength(1);
    expect(mappings.rows[0]?.external_category_id).toBe('9011');
    expect(mappings.rows[0]?.external_type_id).toBe('90999');
  });

  it('onboard-context suggests the category by exact composite key', async () => {
    const seeded = await seedListing({
      platformProductId: `${PREFIX}-T3A`,
      title: `${PREFIX} 类目命中`,
      variants: [
        {
          platformSkuId: `${PREFIX}-T3APS1`,
          offerId: `${PREFIX}-T3AO1`,
          rawData: { description_category_id: 9011, type_id: 90999 },
        },
      ],
    });
    const context = await getOnboardContext(seeded.listingId);
    expect(context.variants[0]?.descriptionCategoryId).toBe('9011');
    expect(context.variants[0]?.descriptionTypeId).toBe('90999');
    expect(context.variants[0]?.suggestedCategoryId).not.toBeNull();
  });

  it('remember-this-mapping writes the row in the onboard transaction (ONBOARD source)', async () => {
    // New platform key NOT covered by the tree import.
    const seeded = await seedListing({
      platformProductId: `${PREFIX}-T3B`,
      title: `${PREFIX} 记住映射`,
      variants: [
        {
          platformSkuId: `${PREFIX}-T3BPS1`,
          offerId: `${PREFIX}-T3BO1`,
          rawData: { description_category_id: 8055, type_id: 7000 },
        },
      ],
    });
    // Pick a level-3 category created by this run's import.
    const level3 = await db.query<{ id: string }>(
      `SELECT id FROM categories WHERE level = 3 AND name_ru = $1 LIMIT 1`,
      [`${PREFIX}-Конструктор-тип`],
    );
    const categoryId = level3.rows[0]?.id ?? '';
    expect(categoryId).not.toBe('');

    const result = await onboard(seeded.listingId, seeded.mappingIds[0]!, {
      categoryId,
      rememberCategoryMapping: true,
    });
    expect(result.status).toBe(201);

    const mappingRow = await db.query<{ internal_category_id: string; source: string }>(
      `SELECT internal_category_id, source FROM platform_category_mappings
       WHERE platform_id = $1 AND external_category_id = 8055 AND external_type_id = 7000`,
      [ozonPlatformId],
    );
    expect(mappingRow.rows).toHaveLength(1);
    expect(mappingRow.rows[0]?.internal_category_id).toBe(categoryId);
    expect(mappingRow.rows[0]?.source).toBe('ONBOARD');

    // The next listing with the SAME platform keys auto-hits.
    const follower = await seedListing({
      platformProductId: `${PREFIX}-T3C`,
      title: `${PREFIX} 后续命中`,
      variants: [
        {
          platformSkuId: `${PREFIX}-T3CPS1`,
          offerId: `${PREFIX}-T3CO1`,
          rawData: { description_category_id: 8055, type_id: 7000 },
        },
      ],
    });
    const context = await getOnboardContext(follower.listingId);
    expect(context.variants[0]?.suggestedCategoryId).toBe(categoryId);
  });
});

describe('T5 v4 attribute prefill (mm/g normalization)', () => {
  it('exposes converted values through onboard-context and persists them on the SKU', async () => {
    const seeded = await seedListing({
      platformProductId: `${PREFIX}-T5`,
      title: `${PREFIX} 属性预填`,
      variants: [
        {
          platformSkuId: `${PREFIX}-T5PS1`,
          offerId: `${PREFIX}-T5O1`,
          rawData: {
            description_category_id: 9011,
            type_id: 90999,
            primary_image: 'https://cdn.example.invalid/img.jpg',
            product_attributes: {
              depth: 300,
              width: 220,
              height: 40,
              dimension_unit: 'mm',
              weight: 700,
              weight_unit: 'g',
            },
          },
        },
      ],
    });

    const context = await getOnboardContext(seeded.listingId);
    const variant = context.variants[0]!;
    expect(variant.weightG).toBe(700);
    expect(variant.lengthMm).toBe(300);
    expect(variant.widthMm).toBe(220);
    expect(variant.heightMm).toBe(40);
    // T6 preview: CDN direct link surfaced (transfer itself is async).
    expect(variant.primaryImage).toBe('https://cdn.example.invalid/img.jpg');

    // Onboard with the prefilled dims (editable pass-through).
    const result = await onboard(seeded.listingId, seeded.mappingIds[0]!, {
      weightG: 700,
      lengthMm: 300,
      widthMm: 220,
      heightMm: 40,
    });
    expect(result.status).toBe(201);
    const sku = await db.query<{
      weight_g: string | null;
      length_mm: number | null;
      width_mm: number | null;
      height_mm: number | null;
      volume_mm3: string | null;
    }>(
      `SELECT weight_g::text, length_mm, width_mm, height_mm, volume_mm3::text FROM skus WHERE id = $1`,
      [result.data.sku.id],
    );
    expect(Number(sku.rows[0]?.weight_g)).toBe(700);
    expect(sku.rows[0]?.length_mm).toBe(300);
    expect(Number(sku.rows[0]?.volume_mm3)).toBe(300 * 220 * 40);
  });
  it('normalizes cm -> mm and kg -> g (unit conversion is server-side)', async () => {
    const seeded = await seedListing({
      platformProductId: `${PREFIX}-T5U`,
      title: `${PREFIX} 单位换算`,
      variants: [
        {
          platformSkuId: `${PREFIX}-T5UPS1`,
          offerId: `${PREFIX}-T5UO1`,
          rawData: {
            product_attributes: {
              depth: 30,
              width: 22,
              height: 4,
              dimension_unit: 'cm',
              weight: 1,
              weight_unit: 'kg',
            },
          },
        },
      ],
    });
    const context = await getOnboardContext(seeded.listingId);
    expect(context.variants[0]?.lengthMm).toBe(300);
    expect(context.variants[0]?.widthMm).toBe(220);
    expect(context.variants[0]?.heightMm).toBe(40);
    expect(context.variants[0]?.weightG).toBe(1000);
  });
});

describe('T5b latest purchase price lands on the SKU (Sprint 8.5R1)', () => {
  it('stores the operator-entered price; omitted stays null', async () => {
    const seeded = await seedListing({
      platformProductId: `${PREFIX}-T5B`,
      title: `${PREFIX} 采购价`,
      variants: [{ platformSkuId: `${PREFIX}-T5BPS1` }, { platformSkuId: `${PREFIX}-T5BPS2` }],
    });

    const withPrice = await onboard(seeded.listingId, seeded.mappingIds[0]!, {
      skuNameZh: `${PREFIX} 采购价有`,
      latestPurchasePrice: 88.5,
    });
    expect(withPrice.status).toBe(201);
    const priced = await db.query<{ latest_purchase_price: string | null }>(
      'SELECT latest_purchase_price::text FROM skus WHERE id = $1',
      [withPrice.data.sku.id],
    );
    expect(Number(priced.rows[0]?.latest_purchase_price)).toBe(88.5);

    // The field is optional - an onboard without it keeps the column null
    // (master-data §4.3: the price is maintained by hand, never invented).
    const withoutPrice = await onboard(seeded.listingId, seeded.mappingIds[1]!, {
      skuNameZh: `${PREFIX} 采购价无`,
    });
    expect(withoutPrice.status).toBe(201);
    const unpriced = await db.query<{ latest_purchase_price: string | null }>(
      'SELECT latest_purchase_price::text FROM skus WHERE id = $1',
      [withoutPrice.data.sku.id],
    );
    expect(unpriced.rows[0]?.latest_purchase_price ?? null).toBeNull();
  });
});
