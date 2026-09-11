/**
 * Sprint 1 acceptance seed (task §87-§91).
 *
 * Idempotent: every insert is existence-checked / ON CONFLICT DO NOTHING so
 * `pnpm seed:sprint1` can run repeatedly against the dev database without
 * creating duplicates (duplicate mappings would make the resolver ambiguous).
 *   - Brand VALKYRIE + 3C category tree
 *   - 11 stores: OZON x8, WB x1, Yandex x2 (dev placeholder data, no real
 *     credentials)
 *   - Shenzhen SELF warehouse (5 racks x 4 levels) + OZON FBO platform wh
 *   - OZON-A bindings: RFBS -> SZ01 and FBO -> platform warehouse
 *   - VALKYRIE VK87 MAX V2 with black/blue SKUs, 69-codes, price
 *   - Multi-listing acceptance: VK87 black on OZON-A x2 + WB-A x1
 *
 * Dev-only (AGENTS.md §93): refuses to run in production.
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: ['../../.env', '.env'] });

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-sprint1 must never run against production.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is not set.');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const log = (message: string) => console.log(`[seed-sprint1] ${message}`);
  try {
    await client.query('BEGIN');

    // ---- Brand + categories ----
    await client.query(
      `INSERT INTO brands (code, name, name_zh, name_en) VALUES ('VALKYRIE', 'VALKYRIE', 'VALKYRIE', 'Valkyrie')
       ON CONFLICT (code) DO NOTHING`,
    );
    const rootCategory = await client.query<{ id: string }>(
      `INSERT INTO categories (code, name_zh, level, sort_order) VALUES ('3C', '3C数码', 1, 0)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
    );
    let rootCategoryId = rootCategory.rows[0]?.id;
    if (rootCategoryId === undefined) {
      rootCategoryId = (
        await client.query<{ id: string }>(`SELECT id FROM categories WHERE code = '3C'`)
      ).rows[0]?.id;
    }
    for (const [code, name, sort] of [
      ['KEYBOARD', '键盘', 1],
      ['MOUSE', '鼠标', 2],
      ['HEADSET', '耳机', 3],
    ] as const) {
      await client.query(
        `INSERT INTO categories (parent_id, code, name_zh, level, sort_order) VALUES ($1, $2, $3, 2, $4)
         ON CONFLICT (code) DO NOTHING`,
        [rootCategoryId, code, name, sort],
      );
    }
    log('brand + categories ready');

    // ---- 11 stores (task §88) ----
    const platformIds = await client.query<{ code: string; id: string }>(
      'SELECT code, id FROM platforms',
    );
    const platformIdOf = (code: string): string => {
      const found = platformIds.rows.find((row) => row.code === code);
      if (found === undefined) {
        throw new Error(`platform ${code} missing - run migrations first`);
      }
      return found.id;
    };
    const storeSeeds: Array<{ platform: string; code: string; name: string }> = [];
    for (let i = 0; i < 8; i += 1) {
      storeSeeds.push({
        platform: 'OZON',
        code: `OZON-${String.fromCharCode(65 + i)}`,
        name: `OZON 店铺 ${String.fromCharCode(65 + i)}（开发占位）`,
      });
    }
    storeSeeds.push({ platform: 'WB', code: 'WB-A', name: 'Wildberries 店铺 A（开发占位）' });
    storeSeeds.push({ platform: 'YANDEX', code: 'YANDEX-A', name: 'Yandex 店铺 A（开发占位）' });
    storeSeeds.push({ platform: 'YANDEX', code: 'YANDEX-B', name: 'Yandex 店铺 B（开发占位）' });
    for (const store of storeSeeds) {
      await client.query(
        `INSERT INTO stores (platform_id, store_code, name, default_currency, status)
         VALUES ($1, $2, $3, 'RUB', 'ACTIVE')
         ON CONFLICT (platform_id, store_code) DO NOTHING`,
        [platformIdOf(store.platform), store.code, store.name],
      );
    }
    log(`stores ready (${storeSeeds.length} = 8 OZON + 1 WB + 2 Yandex)`);

    const storeId = async (code: string): Promise<string> => {
      const row = await client.query<{ id: string }>(
        'SELECT id FROM stores WHERE store_code = $1',
        [code],
      );
      const id = row.rows[0]?.id;
      if (id === undefined) {
        throw new Error(`store ${code} missing`);
      }
      return id;
    };

    // ---- Warehouses + bins (task §89) ----
    await client.query(
      `INSERT INTO warehouses (warehouse_code, name, warehouse_type, country_code, province, city, address)
       VALUES ('SZ01', '深圳自管仓', 'SELF', 'CN', '广东', '深圳', '深圳市宝安区（开发占位）')
       ON CONFLICT (warehouse_code) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO warehouses (warehouse_code, name, warehouse_type, country_code)
       VALUES ('OZON-FBO-RU', 'OZON FBO 平台仓（示例）', 'PLATFORM', 'RU')
       ON CONFLICT (warehouse_code) DO NOTHING`,
    );
    const szId = (
      await client.query<{ id: string }>(`SELECT id FROM warehouses WHERE warehouse_code = 'SZ01'`)
    ).rows[0]?.id as string;
    const fboId = (
      await client.query<{ id: string }>(
        `SELECT id FROM warehouses WHERE warehouse_code = 'OZON-FBO-RU'`,
      )
    ).rows[0]?.id as string;

    // Decision 0010: bin code is `{warehouseCode}-{rack}-{level}` with the
    // rack zero-padded to two digits, and barcode === bin_code.
    for (let rack = 1; rack <= 5; rack += 1) {
      for (let level = 1; level <= 4; level += 1) {
        const rackCode = `A${String(rack).padStart(2, '0')}`;
        const levelCode = `${level}`;
        const binCode = `SZ01-${rackCode}-${levelCode}`;
        await client.query(
          `INSERT INTO warehouse_bins (id, warehouse_id, bin_code, zone, rack, level, barcode)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (warehouse_id, bin_code) DO NOTHING`,
          [randomUUID(), szId, binCode, 'A', rackCode, levelCode, binCode],
        );
      }
    }
    log('SZ01 bins ready (zone A, 5 racks x 4 levels = 20)');

    // ---- Bindings (task §90): guard against duplicates manually (no DB
    // unique constraint by design - same pair may exist with other modes) ----
    const ozonAId = await storeId('OZON-A');
    const bindingExists = async (
      storeId_: string,
      warehouseId: string,
      mode: string,
    ): Promise<boolean> => {
      const found = await client.query(
        `SELECT 1 FROM store_warehouse_bindings
          WHERE store_id = $1 AND warehouse_id = $2 AND fulfillment_mode = $3`,
        [storeId_, warehouseId, mode],
      );
      return found.rowCount !== null && found.rowCount > 0;
    };
    if (!(await bindingExists(ozonAId, szId, 'OZON_RFBS'))) {
      await client.query(
        `INSERT INTO store_warehouse_bindings
           (store_id, warehouse_id, fulfillment_mode, platform_warehouse_id, is_inventory_push_enabled)
         VALUES ($1, $2, 'OZON_RFBS', '123456', true)`,
        [ozonAId, szId],
      );
    }
    if (!(await bindingExists(ozonAId, fboId, 'OZON_FBO'))) {
      await client.query(
        `INSERT INTO store_warehouse_bindings (store_id, warehouse_id, fulfillment_mode)
         VALUES ($1, $2, 'OZON_FBO')`,
        [ozonAId, fboId],
      );
    }
    log('OZON-A bindings ready (RFBS->SZ01, FBO->platform warehouse)');

    // ---- Product + SKUs + barcodes (task §87) ----
    const brandId = (
      await client.query<{ id: string }>(`SELECT id FROM brands WHERE code = 'VALKYRIE'`)
    ).rows[0]?.id as string;
    const keyboardId = (
      await client.query<{ id: string }>(`SELECT id FROM categories WHERE code = 'KEYBOARD'`)
    ).rows[0]?.id as string;

    let productId = (
      await client.query<{ id: string }>(`SELECT id FROM products WHERE product_code = 'PRD-VK87'`)
    ).rows[0]?.id;
    if (productId === undefined) {
      // code_seq comes from the product scope so it can never collide with
      // future auto-generated PN codes (decision 0001/0002).
      const codeSeq = (
        await client.query<{ next_value: string }>(
          `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
           VALUES ('product', 1, now())
           ON CONFLICT (scope_key)
           DO UPDATE SET next_value = business_code_sequences.next_value + 1, updated_at = now()
           RETURNING next_value`,
        )
      ).rows[0]?.next_value as string;
      productId = (
        await client.query<{ id: string }>(
          `INSERT INTO products (product_code, code_seq, name_zh, name_ru, category_id, brand_id, status)
           VALUES ('PRD-VK87', $1, 'VALKYRIE VK87 MAX V2 机械键盘', 'Клавиатура VALKYRIE VK87 MAX V2', $2, $3, 'ACTIVE')
           RETURNING id`,
          [Number(codeSeq), keyboardId, brandId],
        )
      ).rows[0]?.id;
    }

    const skuSeeds = [
      { code: 'VK87-BLK', name: 'VK87 MAX V2 黑色', color: '黑色', barcode: '6971234560001' },
      { code: 'VK87-BLU', name: 'VK87 MAX V2 蓝色', color: '蓝色', barcode: '6971234560002' },
    ] as const;
    const skuIdOf = new Map<string, string>();
    for (const sku of skuSeeds) {
      let skuId = (
        await client.query<{ id: string }>('SELECT id FROM skus WHERE sku_code = $1', [sku.code])
      ).rows[0]?.id;
      if (skuId === undefined) {
        skuId = (
          await client.query<{ id: string }>(
            `INSERT INTO skus (product_id, sku_code, name_zh, model, color, weight_g,
               length_mm, width_mm, height_mm, volume_mm3, latest_purchase_price, cost_currency, status)
             VALUES ($1, $2, $3, 'VK87MAX', $4, 950, 355, 122, 34, 1472540, 299, 'CNY', 'ACTIVE')
             RETURNING id`,
            [productId, sku.code, sku.name, sku.color],
          )
        ).rows[0]?.id;
      }
      skuIdOf.set(sku.code, skuId as string);
      await client.query(
        `INSERT INTO sku_barcodes (sku_id, barcode, barcode_type, is_primary)
         VALUES ($1, $2, 'EAN', true) ON CONFLICT (barcode) DO NOTHING`,
        [skuId, sku.barcode],
      );
    }
    log('VK87 product + 2 SKUs + 69-codes ready');

    // ---- Multi-listing acceptance (task §91) ----
    const blackSkuId = skuIdOf.get('VK87-BLK') as string;
    const wbAId = await storeId('WB-A');
    const listingSeeds = [
      {
        platform: 'OZON',
        storeId: ozonAId,
        ppid: 'VK87-LISTING-1',
        title: 'VK87 MAX V2 机械键盘（链接1）',
        offer: 'VK87-OFF-1',
      },
      {
        platform: 'OZON',
        storeId: ozonAId,
        ppid: 'VK87-LISTING-2',
        title: 'VK87 MAX V2 机械键盘（链接2）',
        offer: 'VK87-OFF-2',
      },
      {
        platform: 'WB',
        storeId: wbAId,
        ppid: 'VK87-WB-1',
        title: 'VK87 MAX V2（WB）',
        offer: 'VK87-WB-OFF-1',
      },
    ];
    for (const listing of listingSeeds) {
      let listingId = (
        await client.query<{ id: string }>(
          'SELECT id FROM platform_listings WHERE store_id = $1 AND platform_product_id = $2',
          [listing.storeId, listing.ppid],
        )
      ).rows[0]?.id;
      if (listingId === undefined) {
        listingId = (
          await client.query<{ id: string }>(
            `INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [platformIdOf(listing.platform), listing.storeId, listing.ppid, listing.title],
          )
        ).rows[0]?.id;
      }
      const mappingExists = await client.query(
        'SELECT 1 FROM platform_listing_skus WHERE listing_id = $1 AND sku_id = $2',
        [listingId, blackSkuId],
      );
      if (mappingExists.rowCount === 0) {
        await client.query(
          `INSERT INTO platform_listing_skus (listing_id, sku_id, offer_id) VALUES ($1, $2, $3)`,
          [listingId, blackSkuId, listing.offer],
        );
      }
    }
    log('multi-listing ready (VK87-BLK on OZON-A x2 + WB-A x1)');

    await client.query('COMMIT');
    log('done');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed-sprint1 failed:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
