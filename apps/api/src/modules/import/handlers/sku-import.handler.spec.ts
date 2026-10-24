import { describe, expect, it, vi } from 'vitest';
import { SkuImportHandler } from './sku-import.handler';
import { SkuService } from '../../product/services/sku.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { CatalogService } from '../../catalog/catalog.service';

/**
 * V1 T6: SKU import handler - name_zh is the required SKU name (the product
 * columns are gone); brand/category are optional exact-name matches whose
 * misses surface as row errors (never an auto-create).
 */

const operator = { userId: null, username: 'tester' };

function buildHandler(options?: {
  brand?: { id: string; name: string } | null;
  category?: { id: string; nameZh: string; level: number } | null;
}) {
  const skuService = {
    create: vi.fn(async () => ({ id: 'sku-1', skuCode: 'SKU000012002' })),
    getEntityByCode: vi.fn(async () => null),
  } as unknown as SkuService;
  const barcodeService = {
    findByBarcode: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'bc-1' })),
  } as unknown as BarcodeService;
  const catalogService = {
    findBrandByName: vi.fn(async () =>
      options?.brand === undefined ? { id: 'brand-1', name: 'VK' } : options.brand,
    ),
    findCategoryByNameZh: vi.fn(async () =>
      options?.category === undefined
        ? { id: 'cat-3', nameZh: '机械键盘', level: 3 }
        : options.category,
    ),
  } as unknown as CatalogService;
  const handler = new SkuImportHandler(skuService, barcodeService, catalogService);
  return { handler, skuService, barcodeService, catalogService };
}

describe('SkuImportHandler.validate (V1: no product columns)', () => {
  it('requires name_zh (the SKU name) - REQUIRED_FIELD_MISSING row error', async () => {
    const { handler } = buildHandler();
    const { validRows, errors } = await handler.validate([
      { rowNumber: 2, cells: { model: 'VK87' } },
    ]);
    expect(validRows).toHaveLength(0);
    expect(errors).toEqual([
      expect.objectContaining({
        row: 2,
        field: 'name_zh',
        code: 'REQUIRED_FIELD_MISSING',
      }),
    ]);
  });

  it('rejects an unknown brand name with BRAND_NOT_FOUND (no auto-create)', async () => {
    const { handler } = buildHandler({ brand: null });
    const { validRows, errors } = await handler.validate([
      { rowNumber: 2, cells: { name_zh: 'SKU A', brand: '不存在的品牌' } },
    ]);
    expect(validRows).toHaveLength(0);
    expect(errors).toEqual([
      expect.objectContaining({ row: 2, field: 'brand', code: 'BRAND_NOT_FOUND' }),
    ]);
  });

  it('rejects an unknown category name with CATEGORY_NOT_FOUND', async () => {
    const { handler } = buildHandler({ category: null });
    const { validRows, errors } = await handler.validate([
      { rowNumber: 2, cells: { name_zh: 'SKU A', category: '不存在的分类' } },
    ]);
    expect(validRows).toHaveLength(0);
    expect(errors).toEqual([
      expect.objectContaining({ row: 2, field: 'category', code: 'CATEGORY_NOT_FOUND' }),
    ]);
  });

  it('rejects a matched non-level-3 category with CATEGORY_LEVEL_INVALID', async () => {
    const { handler } = buildHandler({ category: { id: 'cat-2', nameZh: '键盘', level: 2 } });
    const { validRows, errors } = await handler.validate([
      { rowNumber: 2, cells: { name_zh: 'SKU A', category: '键盘' } },
    ]);
    expect(validRows).toHaveLength(0);
    expect(errors).toEqual([
      expect.objectContaining({ row: 2, field: 'category', code: 'CATEGORY_LEVEL_INVALID' }),
    ]);
  });

  it('resolves matched brand/category names into ids on the valid row', async () => {
    const { handler } = buildHandler();
    const { validRows, errors } = await handler.validate([
      {
        rowNumber: 2,
        cells: { name_zh: 'SKU A', brand: 'VK', category: '机械键盘' },
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(validRows).toHaveLength(1);
    expect(validRows[0]?.data).toMatchObject({
      nameZh: 'SKU A',
      brandId: 'brand-1',
      categoryId: 'cat-3',
    });
  });

  it('rejects an invalid 69 barcode at validation time (same rule as the API)', async () => {
    // 上传校验若放过非法校验位，确认阶段才逐行失败：validRows 变成谎报
    //（2026-10-24 实证 91 有效行 → 只导入 1 行）。
    const { handler } = buildHandler();
    const { validRows, errors } = await handler.validate([
      { rowNumber: 2, cells: { name_zh: 'SKU A', barcode: '6901234567890', barcode_type: 'EAN' } },
      { rowNumber: 3, cells: { name_zh: 'SKU B', barcode: '6901234567892', barcode_type: 'EAN' } },
    ]);
    expect(validRows.map((row) => row.rowNumber)).toEqual([3]);
    expect(errors).toEqual([
      expect.objectContaining({ row: 2, field: 'barcode', code: 'SKU_BARCODE_INVALID_EAN13' }),
    ]);
  });

  it('accepts a row without brand/category (both stay null)', async () => {
    const { handler } = buildHandler();
    const { validRows, errors } = await handler.validate([
      { rowNumber: 2, cells: { name_zh: 'SKU A' } },
    ]);
    expect(errors).toHaveLength(0);
    expect(validRows[0]?.data).toMatchObject({ brandId: null, categoryId: null });
  });
});

describe('SkuImportHandler.importRow (V1: direct SKU creation)', () => {
  it('passes the resolved brand/category to the SKU create and adds the barcode', async () => {
    const { handler, skuService, barcodeService } = buildHandler();
    await handler.importRow(
      {
        skuCode: null,
        nameZh: 'SKU A',
        nameRu: null,
        model: null,
        color: null,
        size: null,
        weightG: null,
        lengthMm: null,
        widthMm: null,
        heightMm: null,
        latestPurchasePrice: null,
        barcode: '6901234567890',
        barcodeType: 'EAN',
        serialTracking: false,
        brandId: 'brand-1',
        categoryId: 'cat-3',
      },
      operator,
      { jobId: 'job-1', rowNumber: 2 },
    );
    expect(skuService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nameZh: 'SKU A',
        brandId: 'brand-1',
        categoryId: 'cat-3',
        skuCode: undefined,
      }),
      operator,
    );
    expect(barcodeService.create).toHaveBeenCalledWith(
      'sku-1',
      { barcode: '6901234567890', barcodeType: 'EAN' },
      operator,
    );
  });
});
