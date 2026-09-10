import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 1 master-data acceptance against real PostgreSQL + MinIO:
 * platforms, stores, credentials, catalog, products, SKUs, barcodes, images
 * (task §78-§82, §85).
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3105';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3105', REDIS_URL: 'redis://localhost:6379/4' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
});

interface IdDto {
  id: string;
}

describe('platforms (task §6/§7)', () => {
  it('seeds OZON / WB / YANDEX', async () => {
    const { body } = await client.get<Array<{ code: string }>>('/api/v1/platforms');
    const codes = body.data.map((platform) => platform.code).sort();
    expect(codes).toEqual(['OZON', 'WB', 'YANDEX']);
  });
});

describe('stores + credentials (task §8-§12, §82)', () => {
  let ozonPlatformId = '';
  let wbPlatformId = '';
  let storeA = '';

  it('creates stores on platforms', async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    ozonPlatformId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    wbPlatformId = platforms.body.data.find((platform) => platform.code === 'WB')?.id ?? '';

    const created = await client.post<IdDto>('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-OZ-A`,
      name: `${PREFIX} OZON A`,
      defaultCurrency: 'RUB',
    });
    expect(created.body.success).toBe(true);
    storeA = created.body.data.id;

    const wbCreated = await client.post<IdDto>('/api/v1/stores', {
      platformId: wbPlatformId,
      storeCode: `${PREFIX}-OZ-A`, // SAME code, DIFFERENT platform -> allowed
      name: `${PREFIX} WB`,
    });
    expect(wbCreated.body.success).toBe(true);
  });

  it('rejects the same store_code twice on one platform (task §82)', async () => {
    const duplicate = await client.post('/api/v1/stores', {
      platformId: ozonPlatformId,
      storeCode: `${PREFIX}-OZ-A`,
      name: 'dup',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.success).toBe(false);
  });

  it('encrypts credentials and never leaks the payload (task §82)', async () => {
    const secret = `it-secret-${PREFIX}-SUPERSECRET`;
    const created = await client.post<IdDto>(`/api/v1/stores/${storeA}/credentials`, {
      credentialType: 'MAIN_API',
      payload: { apiKey: secret, clientId: '42' },
    });
    expect(created.body.success).toBe(true);

    const raw = JSON.stringify(created.body);
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('encryptedPayload');

    const list = await client.get<Array<{ configured: boolean }>>(
      `/api/v1/stores/${storeA}/credentials`,
    );
    expect(list.body.data[0]?.configured).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(secret);
  });

  it('lists stores with credential + binding counts (no N+1 shape)', async () => {
    const list = await client.get<
      Array<{ storeCode: string; credentialConfigured: boolean; bindingCount: number }>
    >(`/api/v1/stores?keyword=${PREFIX}`);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    for (const store of list.body.data) {
      expect(typeof store.credentialConfigured).toBe('boolean');
      expect(typeof store.bindingCount).toBe('number');
    }
  });
});

describe('catalog (task §13/§14)', () => {
  it('creates brands and a 2-level category tree', async () => {
    const brand = await client.post<IdDto>('/api/v1/brands', {
      code: `${PREFIX}-BRAND`,
      nameZh: `${PREFIX} 测试品牌`,
    });
    expect(brand.body.success).toBe(true);

    const root = await client.post<IdDto>('/api/v1/categories', {
      code: `${PREFIX}-3C`,
      nameZh: '3C',
    });
    const child = await client.post<IdDto>('/api/v1/categories', {
      parentId: root.body.data.id,
      code: `${PREFIX}-KBD`,
      nameZh: '键盘',
    });
    expect(child.body.success).toBe(true);

    const tree =
      await client.get<Array<{ code: string; children: Array<{ code: string }> }>>(
        '/api/v1/categories',
      );
    const node = tree.body.data.find((category) => category.code === `${PREFIX}-3C`);
    expect(node?.children.map((leaf) => leaf.code)).toEqual([`${PREFIX}-KBD`]);
  });
});

describe('products + skus (task §78/§79)', () => {
  let productId = '';
  let categoryId = '';
  let brandId = '';

  it('creates a product with auto code PRD%06d (task §16)', async () => {
    const tree =
      await client.get<
        Array<{ id: string; code: string; children: Array<{ id: string; code: string }> }>
      >('/api/v1/categories');
    categoryId =
      tree.body.data.find((category) => category.code === `${PREFIX}-3C`)?.children[0]?.id ?? '';
    const brands = await client.get<Array<{ id: string; code: string }>>(
      `/api/v1/brands?keyword=${PREFIX}`,
    );
    brandId = brands.body.data[0]?.id ?? '';

    const created = await client.post<IdDto & { productCode: string; status: string }>(
      '/api/v1/products',
      {
        nameZh: `${PREFIX} VK87 MAX V2`,
        nameRu: 'VK87 MAX V2',
        categoryId,
        brandId,
      },
    );
    expect(created.body.data.productCode).toMatch(/^PRD\d{6}$/);
    expect(created.body.data.status).toBe('DRAFT');
    productId = created.body.data.id;
  });

  it('rejects duplicate product_code (task §78)', async () => {
    const duplicate = await client.post('/api/v1/products', {
      productCode: `${PREFIX}-DUP`,
      nameZh: 'x',
    });
    const first = await client.post<IdDto & { productCode: string }>('/api/v1/products', {
      productCode: `${PREFIX}-DUP`,
      nameZh: 'x1',
    });
    void duplicate;
    const second = await client.post('/api/v1/products', {
      productCode: `${PREFIX}-DUP`,
      nameZh: 'x2',
    });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('PRODUCT_CODE_ALREADY_EXISTS');
    void first;
  });

  it('creates SKUs with auto codes and backend-computed volume (task §79)', async () => {
    const black = await client.post<
      IdDto & { skuCode: string; volumeMm3: number; serialTracking: boolean }
    >('/api/v1/skus', {
      productId,
      nameZh: `${PREFIX} 黑色`,
      color: '黑色',
      weightG: 950,
      lengthMm: 355,
      widthMm: 122,
      heightMm: 34,
      latestPurchasePrice: 299,
      serialTracking: true,
    });
    expect(black.body.data.skuCode).toMatch(/^SKU\d{6}$/);
    expect(black.body.data.volumeMm3).toBe(355 * 122 * 34);
    expect(black.body.data.serialTracking).toBe(true);

    const blue = await client.post<IdDto & { skuCode: string }>('/api/v1/skus', {
      productId,
      nameZh: `${PREFIX} 蓝色`,
      color: '蓝色',
    });
    expect(blue.body.success).toBe(true);
  });

  it('rejects partial dimensions (volume must stay computable)', async () => {
    const bad = await client.post('/api/v1/skus', {
      productId,
      nameZh: 'broken',
      lengthMm: 100,
    });
    expect(bad.status).toBe(422);
  });

  it('rejects non-integer millimeter dimensions (DTO validation)', async () => {
    const bad = await client.post('/api/v1/skus', {
      productId,
      nameZh: 'broken-float',
      lengthMm: 100.5,
      widthMm: 50,
      heightMm: 30,
    });
    expect(bad.status).toBe(400);
  });

  it('updates a SKU and recomputes volume (task §23)', async () => {
    const skus = await client.get<Array<{ id: string; nameZh: string; volumeMm3: number }>>(
      `/api/v1/skus?productId=${productId}&sortBy=skuCode&sortOrder=asc`,
    );
    const black = skus.body.data.find((sku) => sku.nameZh === `${PREFIX} 黑色`);
    expect(black).toBeDefined();
    const updated = await client.patch<{ volumeMm3: number }>(`/api/v1/skus/${black?.id}`, {
      lengthMm: 400,
      widthMm: 100,
      heightMm: 100,
    });
    expect(updated.body.data.volumeMm3).toBe(4_000_000);
  });

  it('activates the product and shows SKU count in list (task §64)', async () => {
    await client.post(`/api/v1/products/${productId}/activate`);
    const list = await client.get<Array<{ id: string; skuCount: number; status: string }>>(
      `/api/v1/products?keyword=${encodeURIComponent(PREFIX)}`,
    );
    const row = list.body.data.find((product) => product.id === productId);
    expect(row?.skuCount).toBe(2);
    expect(row?.status).toBe('ACTIVE');
  });
});

describe('barcodes (task §80)', () => {
  let skuId = '';

  beforeAll(async () => {
    const skus = await client.get<Array<{ id: string; nameZh: string }>>(
      `/api/v1/skus?keyword=${encodeURIComponent(PREFIX)}`,
    );
    skuId = skus.body.data.find((sku) => sku.nameZh === `${PREFIX} 黑色`)?.id ?? '';
  });

  it('allows multiple barcodes per SKU; first becomes primary', async () => {
    const first = await client.post<{ isPrimary: boolean }>(`/api/v1/skus/${skuId}/barcodes`, {
      barcode: `697${PREFIX}0001`,
      barcodeType: 'EAN',
    });
    expect(first.body.data.isPrimary).toBe(true);

    const second = await client.post<{ isPrimary: boolean }>(`/api/v1/skus/${skuId}/barcodes`, {
      barcode: `697${PREFIX}0002`,
      barcodeType: 'EAN',
    });
    expect(second.body.data.isPrimary).toBe(false);
  });

  it('rejects a barcode already bound to another SKU (global unique)', async () => {
    const bad = await client.post('/api/v1/skus/00000000-0000-0000-0000-000000000001/barcodes', {
      barcode: `697${PREFIX}0001`,
      barcodeType: 'EAN',
    });
    expect(bad.status).toBe(404); // unknown sku
    const products = await client.get<Array<{ id: string }>>(
      `/api/v1/products?keyword=${encodeURIComponent(PREFIX)}`,
    );
    const productId = products.body.data[0]?.id ?? '';
    const other = await client.post<{ id: string }>('/api/v1/skus', {
      productId,
      nameZh: `${PREFIX} other`,
    });
    const conflict = await client.post(`/api/v1/skus/${other.body.data.id}/barcodes`, {
      barcode: `697${PREFIX}0001`,
      barcodeType: 'EAN',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe('SKU_BARCODE_ALREADY_EXISTS');
  });

  it('keeps at most one primary per SKU (DB partial index, task §80)', async () => {
    // Switching primary demotes the old one atomically.
    const barcodes = await client.get<Array<{ id: string; barcode: string; isPrimary: boolean }>>(
      `/api/v1/skus/${skuId}/barcodes`,
    );
    const secondBarcode = barcodes.body.data.find((barcode) => barcode.barcode.endsWith('0002'));
    await client.patch(`/api/v1/skus/${skuId}/barcodes/${secondBarcode?.id}`, { isPrimary: true });
    const after = await client.get<Array<{ isPrimary: boolean }>>(`/api/v1/skus/${skuId}/barcodes`);
    expect(after.body.data.filter((barcode) => barcode.isPrimary)).toHaveLength(1);
  });
});

describe('sku images (task §85)', () => {
  it('uploads to MinIO, returns a readable signed URL; rejects non-images', async () => {
    const skus = await client.get<Array<{ id: string; nameZh: string }>>(
      `/api/v1/skus?keyword=${encodeURIComponent(PREFIX)}`,
    );
    const skuId = skus.body.data.find((sku) => sku.nameZh === `${PREFIX} 黑色`)?.id ?? '';

    // 1x1 transparent PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploaded = await client.upload<{ url: string; isPrimary: boolean; objectKey?: string }>(
      `/api/v1/skus/${skuId}/images`,
      { name: 'pixel.png', type: 'image/png', buffer: png },
    );
    expect(uploaded.body.success).toBe(true);
    expect(uploaded.body.data.isPrimary).toBe(true);

    const imageResponse = await fetch(uploaded.body.data.url);
    expect(imageResponse.status).toBe(200);
    expect((await imageResponse.arrayBuffer()).byteLength).toBe(png.length);

    const invalid = await client.upload(`/api/v1/skus/${skuId}/images`, {
      name: 'evil.txt',
      type: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error?.code).toBe('FILE_INVALID_TYPE');
  });
});
