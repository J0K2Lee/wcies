import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import ExcelJS from 'exceljs';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 8 acceptance against real PostgreSQL + Redis + S3:
 * T1 quick onboarding from an unmapped listing (one transaction),
 * T2 unmapped export -> fill -> LISTING_MAPPING import closed loop
 *    (synced rows get BOUND, not twinned),
 * T3 unmapped workbench counters + exception-first ordering.
 */
let api: ManagedProcess;
let worker: ManagedProcess;
const BASE = 'http://localhost:3118';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

let ozonPlatformId = '';
let storeId = '';

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3118', REDIS_URL: 'redis://localhost:6379/9' });
  worker = spawnApiEntry('worker.js', { PORT: '3118', REDIS_URL: 'redis://localhost:6379/9' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string; storeCode: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-S1`,
    name: `${PREFIX} Sprint8店`,
  });
  storeId = store.body.data.id;
});

afterAll(async () => {
  await api.stop();
  await worker.stop();
  await db.end();
});

/** Cell value -> plain text (rich text / formula aware). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const rich = value as { richText?: Array<{ text: string }> };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((part) => part.text).join('');
    }
    const formula = value as { result?: unknown };
    if (formula.result !== undefined && formula.result !== null) {
      return cellText(formula.result as ExcelJS.CellValue);
    }
    return '';
  }
  return String(value);
}

interface ListingRowDto {
  id: string;
  platformProductId: string;
  mappingStatus: string;
  hasOrderException: boolean;
}

interface ListingDetailDto {
  id: string;
  skus: Array<{
    id: string;
    mappingStatus: string;
    skuId: string | null;
    skuCode: string | null;
    platformSkuId: string | null;
    offerId: string | null;
  }>;
}

/** Seeds a synced listing + one UNMAPPED variant row, like Listing Sync would. */
async function seedUnmappedListing(input: {
  platformProductId: string;
  title: string | null;
  platformSkuId: string;
  offerId?: string;
}): Promise<{ listingId: string; mappingId: string }> {
  const listing = await db.query<{ id: string }>(
    `INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title, url, status, raw_data)
     VALUES ($1, $2, $3, $4, NULL, 'ACTIVE', NULL)
     RETURNING id`,
    [ozonPlatformId, storeId, input.platformProductId, input.title],
  );
  const mapping = await db.query<{ id: string }>(
    `INSERT INTO platform_listing_skus
       (listing_id, sku_id, mapping_status, platform_sku_id, offer_id, seller_sku, status, raw_data)
     VALUES ($1, NULL, 'UNMAPPED', $2, $3, NULL, 'ACTIVE', NULL)
     RETURNING id`,
    [listing.rows[0].id, input.platformSkuId, input.offerId ?? null],
  );
  return { listingId: listing.rows[0].id, mappingId: mapping.rows[0].id };
}

async function listingsPage(params: string): Promise<ListingRowDto[]> {
  const response = await client.get<ListingRowDto[]>(`/api/v1/listings?${params}`);
  return response.body.data;
}

describe('T1 quick onboarding (one transaction, no half-products)', () => {
  const ppid = `${PREFIX}-OB-1`;
  let seeded: { listingId: string; mappingId: string };

  it('seeds an unmapped synced listing', async () => {
    seeded = await seedUnmappedListing({
      platformProductId: ppid,
      title: `${PREFIX} 快捷建档测试品`,
      platformSkuId: `${PREFIX}-OBPS1`,
      offerId: `${PREFIX}-OBO1`,
    });
    const rows = await listingsPage(
      `storeId=${storeId}&mappingState=UNMAPPED&keyword=${encodeURIComponent(ppid)}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hasOrderException).toBe(false);
  });

  it('onboards Product + SKU + barcode + mapping in one action', async () => {
    const response = await client.post<{
      product: { productCode: string; nameZh: string };
      sku: { skuCode: string; nameZh: string };
      barcode: string | null;
      mappingStatus: string;
    }>(`/api/v1/listings/${seeded.listingId}/skus/${seeded.mappingId}/onboard`, {
      generateBarcode: true,
    });
    expect(response.status).toBe(201);
    const data = response.body.data;
    // Names defaulted from the listing title (planning §T1.2).
    expect(data.product.nameZh).toBe(`${PREFIX} 快捷建档测试品`);
    expect(data.sku.nameZh).toBe(`${PREFIX} 快捷建档测试品`);
    // Codes come from the centralized sequences - no new code rules (§6.6).
    expect(data.product.productCode).toMatch(/^PN\d{6,}$/);
    expect(data.sku.skuCode).toMatch(/^SKU\d{9,}$/);
    expect(data.barcode).toMatch(/^W\d{8}$/);
    expect(data.mappingStatus).toBe('MAPPED');

    // DB facts: product + sku + PRIMARY barcode, all visible.
    const product = await db.query<{ cnt: string }>(
      'SELECT COUNT(*)::text AS cnt FROM products WHERE product_code = $1',
      [data.product.productCode],
    );
    expect(product.rows[0].cnt).toBe('1');
    const sku = await db.query<{ cnt: string }>(
      'SELECT COUNT(*)::text AS cnt FROM skus WHERE sku_code = $1',
      [data.sku.skuCode],
    );
    expect(sku.rows[0].cnt).toBe('1');
    const barcode = await db.query<{ is_primary: boolean }>(
      'SELECT is_primary FROM sku_barcodes WHERE barcode = $1',
      [data.barcode],
    );
    expect(barcode.rows[0].is_primary).toBe(true);

    // The synced variant row itself is now MAPPED (no twin row).
    const detail = await client.get<ListingDetailDto>(`/api/v1/listings/${seeded.listingId}`);
    expect(detail.body.data.skus).toHaveLength(1);
    expect(detail.body.data.skus[0].mappingStatus).toBe('MAPPED');
    expect(detail.body.data.skus[0].skuCode).toBe(data.sku.skuCode);

    // Orders can resolve the new mapping store-scoped (by platform SKU id -
    // offer id is not a resolution identifier, decision 0016).
    const resolved = await client.get<{ internalSkuCode: string }>(
      `/api/v1/listings/resolve?storeId=${storeId}&platformSkuId=${encodeURIComponent(`${PREFIX}-OBPS1`)}`,
    );
    expect(resolved.body.data.internalSkuCode).toBe(data.sku.skuCode);
  });

  it('rejects a second onboard of the same variant (UNMAPPED-only)', async () => {
    const response = await client.post(
      `/api/v1/listings/${seeded.listingId}/skus/${seeded.mappingId}/onboard`,
      {},
    );
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe('LISTING_SKU_MAPPING_INVALID_STATE');
  });

  it('requires a name when the listing has no title and none is given', async () => {
    const noTitle = await seedUnmappedListing({
      platformProductId: `${PREFIX}-OB-2`,
      title: null,
      platformSkuId: `${PREFIX}-OBPS2`,
    });
    const response = await client.post(
      `/api/v1/listings/${noTitle.listingId}/skus/${noTitle.mappingId}/onboard`,
      {},
    );
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('LISTING_ONBOARD_NAME_REQUIRED');
    // Guard fired before any write: no product was created for it.
    const rows = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM platform_listing_skus WHERE id = $1 AND sku_id IS NULL`,
      [noTitle.mappingId],
    );
    expect(rows.rows[0].cnt).toBe('1');
  });
});

describe('T2 unmapped export -> fill -> import closed loop', () => {
  const ppidA = `${PREFIX}-EX-A`;
  const ppidB = `${PREFIX}-EX-B`;
  let exported: {
    objectKey: string;
    downloadUrl: string;
    rowCount: number;
  };
  let skuCodeForImport = '';

  it('exports unmapped variants column-identical to the import template', async () => {
    await seedUnmappedListing({
      platformProductId: ppidA,
      title: `${PREFIX} 导出A`,
      platformSkuId: `${PREFIX}-EXPS-A`,
      offerId: `${PREFIX}-EXO-A`,
    });
    await seedUnmappedListing({
      platformProductId: ppidB,
      title: `${PREFIX} 导出B`,
      platformSkuId: `${PREFIX}-EXPS-B`,
      offerId: `${PREFIX}-EXO-B`,
    });

    const response = await client.post<{
      objectKey: string;
      downloadUrl: string;
      rowCount: number;
    }>('/api/v1/listings/exports/unmapped', { storeId });
    expect(response.status).toBe(200);
    exported = response.body.data;
    expect(exported.rowCount).toBeGreaterThanOrEqual(2);

    // The signed URL actually downloads the workbook.
    const file = await fetch(exported.downloadUrl);
    expect(file.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      headers.push(cellText(cell.value));
    });
    expect(headers).toEqual([
      'platform',
      'store_code',
      'platform_product_id',
      'platform_sku_id',
      'seller_sku',
      'offer_id',
      'internal_sku_code',
      'title',
      'url',
    ]);

    const rows: Array<Record<string, string>> = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[headers[colNumber - 1]] = cellText(cell.value);
      });
      rows.push(cells);
    });
    const rowA = rows.find((r) => r['platform_product_id'] === ppidA);
    expect(rowA?.['platform']).toBe('OZON');
    expect(rowA?.['offer_id']).toBe(`${PREFIX}-EXO-A`);
    expect(rowA?.['title']).toBe(`${PREFIX} 导出A`);
    // The user-fillable column ships empty.
    for (const row of rows) {
      expect(row['internal_sku_code']).toBe('');
    }
  });

  it('serves downloadable import templates (SKU / LISTING_MAPPING)', async () => {
    for (const type of ['SKU', 'LISTING_MAPPING']) {
      const response = await fetch(`${BASE}/api/v1/imports/templates/${type}`, {
        headers: { cookie: client.cookieHeader() },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('.xlsx');
      const buffer = Buffer.from(await response.arrayBuffer());
      expect(buffer.length).toBeGreaterThan(1000);
    }
    const bad = await fetch(`${BASE}/api/v1/imports/templates/NOPE`, {
      headers: { cookie: client.cookieHeader() },
    });
    expect(bad.status).toBe(422);
  });

  it('imports the filled sheet and BINDS the synced rows (no twin rows)', async () => {
    // Create one internal SKU to map the exported rows onto.
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 闭环商品`,
    });
    const sku = await client.post<{ skuCode: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} 闭环SKU`,
    });
    skuCodeForImport = sku.body.data.skuCode;

    // Build the "filled" sheet from the export shape.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('LM');
    sheet.addRow([
      'platform',
      'store_code',
      'platform_product_id',
      'platform_sku_id',
      'seller_sku',
      'offer_id',
      'internal_sku_code',
      'title',
      'url',
    ]);
    sheet.addRow([
      'OZON',
      `${PREFIX}-S1`,
      ppidA,
      `${PREFIX}-EXPS-A`,
      '',
      `${PREFIX}-EXO-A`,
      skuCodeForImport,
      `${PREFIX} 导出A`,
      '',
    ]);
    sheet.addRow([
      'OZON',
      `${PREFIX}-S1`,
      ppidB,
      `${PREFIX}-EXPS-B`,
      '',
      `${PREFIX}-EXO-B`,
      skuCodeForImport,
      `${PREFIX} 导出B`,
      '',
    ]);

    const uploaded = await client.upload<{ id: string; status: string }>(
      `/api/v1/imports/upload?type=LISTING_MAPPING`,
      {
        name: 'sprint8-loop.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      },
    );
    expect(uploaded.body.data.status).toBe('VALIDATED');
    await client.post(`/api/v1/imports/${uploaded.body.data.id}/confirm`);

    let job: { status: string; importedRows: number } | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await client.get<{ status: string; importedRows: number }>(
        `/api/v1/imports/${uploaded.body.data.id}`,
      );
      job = poll.body.data;
      if (job.status === 'COMPLETED') break;
    }
    expect(job?.status).toBe('COMPLETED');
    expect(job?.importedRows).toBe(2);

    // The synced UNMAPPED rows were BOUND - still exactly one variant row per
    // listing, now MAPPED (no twin insert).
    for (const ppid of [ppidA, ppidB]) {
      const rows = await db.query<{ mapping_status: string; sku_code: string | null }>(
        `SELECT pls.mapping_status, skus.sku_code
         FROM platform_listing_skus pls
         INNER JOIN platform_listings pl ON pl.id = pls.listing_id
         LEFT JOIN skus ON skus.id = pls.sku_id
         WHERE pl.platform_product_id = $1 AND pl.store_id = $2`,
        [ppid, storeId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].mapping_status).toBe('MAPPED');
      expect(rows.rows[0].sku_code).toBe(skuCodeForImport);
    }

    // Mapped rows are not exported anymore (default excludes them).
    const reExport = await client.post<{ rowCount: number }>('/api/v1/listings/exports/unmapped', {
      storeId,
    });
    expect(reExport.body.data.rowCount).toBeLessThan(exported.rowCount);
  });
});

describe('T3 unmapped workbench (counters + exception-first order)', () => {
  it('reports mapped/unmapped counters', async () => {
    const stats = await client.get<{ mapped: number; unmapped: number }>(
      '/api/v1/listings/mapping-stats',
    );
    expect(stats.body.data.mapped).toBeGreaterThanOrEqual(2);
    expect(stats.body.data.unmapped).toBeGreaterThanOrEqual(1);
  });

  it('sorts listings hit by OPEN mapping-failed exceptions to the top', async () => {
    // A fresh unmapped listing that an order runs into.
    const hit = await seedUnmappedListing({
      platformProductId: `${PREFIX}-EXC-1`,
      title: `${PREFIX} 被订单撞上`,
      platformSkuId: `${PREFIX}-EXCPS1`,
      offerId: `${PREFIX}-EXCO1`,
    });
    // An unmapped listing with NO exception, deliberately NEWER than the hit
    // listing: plain createdAt-DESC ordering would place it FIRST, so the
    // exception priority is what must override it.
    const quiet = await seedUnmappedListing({
      platformProductId: `${PREFIX}-EXC-2`,
      title: `${PREFIX} 无异常`,
      platformSkuId: `${PREFIX}-EXCPS2`,
      offerId: `${PREFIX}-EXCO2`,
    });
    await db.query(
      `UPDATE platform_listings SET created_at = now() - interval '1 hour' WHERE id = $1`,
      [quiet.listingId],
    );
    await db.query(
      `UPDATE platform_listings SET created_at = now() - interval '2 hours' WHERE id = $1`,
      [hit.listingId],
    );

    // Ingest an order whose line cannot resolve -> FAILED + OPEN exception
    // pointing at the hit listing (store + platform_product_id).
    const ingest = await client.post<{ data?: { id?: string } }>('/api/v1/orders/ingest', {
      storeId,
      platformOrderId: `${PREFIX}-EXC-ORD`,
      platformStatus: 'awaiting_packaging',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      currency: 'RUB',
      items: [
        {
          platformProductId: `${PREFIX}-EXC-1`,
          platformSkuId: `${PREFIX}-EXCPS1`,
          quantity: '1',
        },
      ],
    });
    expect(ingest.status).toBe(200);

    const rows = await listingsPage(`storeId=${storeId}&mappingState=UNMAPPED&pageSize=100`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // The exception-hit listing sorts first and is flagged, even though the
    // quiet listing is newer by createdAt (default order would show it first).
    expect(rows[0].platformProductId).toBe(`${PREFIX}-EXC-1`);
    expect(rows[0].hasOrderException).toBe(true);
    const quietRow = rows.find((row) => row.platformProductId === `${PREFIX}-EXC-2`);
    expect(quietRow?.hasOrderException).toBe(false);
    expect(rows.indexOf(quietRow as ListingRowDto)).toBeGreaterThan(0);
  });
});
