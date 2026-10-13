import { describe, expect, it, vi } from 'vitest';
import {
  SkuDimensionsInvalidError,
  SkuInUseError,
  SkuCodeAlreadyExistsError,
} from '../errors/sku-errors';
import { SkuService, assertDimensionsConsistent, computeVolumeMm3, toNumeric } from './sku.service';
import { SkuRepository } from '../repositories/sku.repository';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { CatalogService } from '../../catalog/catalog.service';
import { SkuEntity } from '../entities/sku.entity';

const operator = { userId: 'user-1', username: 'tester' };

function makeSku(overrides: Partial<SkuEntity> = {}): SkuEntity {
  return {
    id: 'sku-1',
    skuCode: 'SKU000012002',
    nameZh: 'VK87 MAX V2 黑色',
    nameRu: null,
    categoryId: null,
    brandId: null,
    model: null,
    color: null,
    size: null,
    weightG: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    volumeMm3: null,
    purchaseUrl: null,
    latestPurchasePrice: null,
    movingAverageCost: null,
    costCurrency: 'CNY',
    serialTracking: false,
    status: 'ACTIVE',
    remark: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SkuEntity;
}

function buildService(options?: {
  brand?: { id: string; name: string } | null;
  category?: { id: string; nameZh: string; level: number } | null;
  existingByCode?: SkuEntity | null;
}) {
  const inserted: Array<Partial<SkuEntity>> = [];
  const repository = {
    insert: vi.fn(async (sku: Partial<SkuEntity>) => {
      inserted.push(sku);
      return makeSku(sku);
    }),
    findByCode: vi.fn(async () => options?.existingByCode ?? null),
    findById: vi.fn(async () => makeSku(inserted[0] ?? {})),
    update: vi.fn(async () => undefined),
    countReferences: vi.fn(async () => [{ table: 'sku_barcodes', count: 0 }]),
    countReferencesIn: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
    deleteWithCascade: vi.fn(async () => undefined),
    listWithAggregates: vi.fn(async () => ({ rows: [], total: 0 })),
  } as unknown as SkuRepository;

  const businessCode = {
    nextSkuCodeGlobal: vi.fn(async () => 'SKU000012002'),
  } as unknown as BusinessCodeService;

  const operationLog = {
    record: vi.fn(async () => undefined),
  } as unknown as OperationLogService;

  const objectStorage = {
    getSignedUrl: vi.fn(async () => 'https://signed.example/img.png'),
  } as unknown as ObjectStorageService;

  const catalogService = {
    findBrandEntityById: vi.fn(async () =>
      options?.brand === undefined ? { id: 'brand-1', name: 'VK' } : options.brand,
    ),
    findCategoryEntityById: vi.fn(async () =>
      options?.category === undefined
        ? { id: 'cat-3', nameZh: '机械键盘', level: 3 }
        : options.category,
    ),
  } as unknown as CatalogService;

  const service = new SkuService(
    repository,
    objectStorage,
    businessCode,
    operationLog,
    catalogService,
  );
  return { service, repository, businessCode, operationLog, catalogService, inserted };
}

describe('toNumeric (cleared InputNumber must not become "null" in SQL)', () => {
  it('serializes finite numbers for numeric columns', () => {
    expect(toNumeric(0)).toBe('0');
    expect(toNumeric(950)).toBe('950');
    expect(toNumeric(299.5)).toBe('299.5');
  });

  it('maps null/undefined to SQL NULL (the SKU-create failure of 2026-09-11)', () => {
    // antd InputNumber sends null when the user clears the field. Treating it
    // like a value produced the literal string "null", which Postgres rejected
    // with `invalid input syntax for type numeric`, surfacing to the user as an
    // opaque "Database error" on a perfectly valid form submission.
    expect(toNumeric(null)).toBeNull();
    expect(toNumeric(undefined)).toBeNull();
  });

  it('maps non-finite values to SQL NULL rather than letting them reach the driver', () => {
    expect(toNumeric(Number.NaN)).toBeNull();
    expect(toNumeric(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumeric(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe('computeVolumeMm3 (task §23: volume is backend-computed; integer mm)', () => {
  it('computes length x width x height', () => {
    expect(computeVolumeMm3(355, 122, 34)).toBe(1_472_540);
    expect(computeVolumeMm3(100, 100, 100)).toBe(1_000_000);
  });

  it('returns null unless all three dimensions exist', () => {
    expect(computeVolumeMm3(null, 100, 100)).toBeNull();
    expect(computeVolumeMm3(100, null, null)).toBeNull();
    expect(computeVolumeMm3(null, null, null)).toBeNull();
  });
});

describe('assertDimensionsConsistent (all-or-none)', () => {
  it('accepts complete or empty dimension sets', () => {
    expect(() => assertDimensionsConsistent(1, 2, 3)).not.toThrow();
    expect(() => assertDimensionsConsistent(null, null, null)).not.toThrow();
    expect(() => assertDimensionsConsistent(undefined, undefined, undefined)).not.toThrow();
  });

  it('rejects partial dimension sets', () => {
    expect(() => assertDimensionsConsistent(1, null, null)).toThrow(SkuDimensionsInvalidError);
    expect(() => assertDimensionsConsistent(1, 2, null)).toThrow(SkuDimensionsInvalidError);
    expect(() => assertDimensionsConsistent(null, 2, 3)).toThrow(SkuDimensionsInvalidError);
  });

  it('treats undefined merges as absent (update flows)', () => {
    expect(() => assertDimensionsConsistent(undefined, 2, 3)).toThrow(SkuDimensionsInvalidError);
  });
});

describe('SkuService.create (V1: direct SKU creation, no product layer)', () => {
  it('auto-codes from the global sequence and lands ACTIVE (D2/D3)', async () => {
    const ctx = buildService();
    const created = await ctx.service.create({ nameZh: 'VK87 MAX V2 黑色' }, operator);

    expect(ctx.businessCode.nextSkuCodeGlobal).toHaveBeenCalledTimes(1);
    expect(ctx.inserted[0]?.skuCode).toBe('SKU000012002');
    expect(ctx.inserted[0]?.status).toBe('ACTIVE');
    // No productId anywhere in the insert (the column is gone from the flow).
    expect(ctx.inserted[0]).not.toHaveProperty('productId');
    expect(created.skuCode).toBe('SKU000012002');
    expect(ctx.operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'SKU', action: 'CREATE' }),
    );
  });

  it('writes the validated brand/category onto the SKU (D5) and returns their names', async () => {
    const ctx = buildService();
    const created = await ctx.service.create(
      { nameZh: 'VK87 MAX V2 黑色', brandId: 'brand-1', categoryId: 'cat-3' },
      operator,
    );

    expect(ctx.catalogService.findBrandEntityById).toHaveBeenCalledWith('brand-1');
    expect(ctx.catalogService.findCategoryEntityById).toHaveBeenCalledWith('cat-3');
    expect(ctx.inserted[0]?.brandId).toBe('brand-1');
    expect(ctx.inserted[0]?.categoryId).toBe('cat-3');
    expect(created.brandId).toBe('brand-1');
    expect(created.brandName).toBe('VK');
    expect(created.categoryId).toBe('cat-3');
    expect(created.categoryName).toBe('机械键盘');
    // No product fields in the response contract.
    expect(created).not.toHaveProperty('productId');
    expect(created).not.toHaveProperty('productCode');
    expect(created).not.toHaveProperty('productName');
  });

  it('keeps brand/category optional (null when omitted)', async () => {
    const ctx = buildService();
    const created = await ctx.service.create({ nameZh: '无品牌无分类' }, operator);
    expect(created.brandId).toBeNull();
    expect(created.categoryId).toBeNull();
    expect(ctx.inserted[0]?.brandId).toBeNull();
    expect(ctx.inserted[0]?.categoryId).toBeNull();
  });

  it('rejects an unknown brand with BRAND_NOT_FOUND', async () => {
    const ctx = buildService({ brand: null });
    await expect(
      ctx.service.create({ nameZh: 'x', brandId: 'missing-brand' }, operator),
    ).rejects.toMatchObject({ code: 'BRAND_NOT_FOUND', httpStatus: 404 });
    expect(ctx.repository.insert).not.toHaveBeenCalled();
  });

  it('rejects an unknown category with CATEGORY_NOT_FOUND', async () => {
    const ctx = buildService({ category: null });
    await expect(
      ctx.service.create({ nameZh: 'x', categoryId: 'missing-cat' }, operator),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND', httpStatus: 404 });
    expect(ctx.repository.insert).not.toHaveBeenCalled();
  });

  it('rejects a non-level-3 category with CATEGORY_LEVEL_INVALID (decision 0005)', async () => {
    const ctx = buildService({ category: { id: 'cat-2', nameZh: '键盘', level: 2 } });
    await expect(
      ctx.service.create({ nameZh: 'x', categoryId: 'cat-2' }, operator),
    ).rejects.toMatchObject({ code: 'CATEGORY_LEVEL_INVALID', httpStatus: 422 });
    expect(ctx.repository.insert).not.toHaveBeenCalled();
  });

  it('rejects a duplicate explicit sku_code with SKU_CODE_ALREADY_EXISTS', async () => {
    const ctx = buildService({ existingByCode: makeSku({ skuCode: 'SKU000012002' }) });
    await expect(
      ctx.service.create({ nameZh: 'x', skuCode: 'SKU000012002' }, operator),
    ).rejects.toThrow(SkuCodeAlreadyExistsError);
    expect(ctx.repository.insert).not.toHaveBeenCalled();
  });
});

describe('SkuService.update (V1: category/brand editable, null clears)', () => {
  it('clears brand/category when explicitly null', async () => {
    const ctx = buildService();
    const updated = await ctx.service.update(
      'sku-1',
      { brandId: null, categoryId: null },
      operator,
    );
    expect(ctx.repository.update).toHaveBeenCalledWith(
      'sku-1',
      expect.objectContaining({ brandId: null, categoryId: null }),
    );
    expect(updated.brandId).toBeNull();
  });

  it('validates a new category before writing (level 3)', async () => {
    const ctx = buildService({ category: { id: 'cat-2', nameZh: '键盘', level: 2 } });
    await expect(
      ctx.service.update('sku-1', { categoryId: 'cat-2' }, operator),
    ).rejects.toMatchObject({ code: 'CATEGORY_LEVEL_INVALID' });
    expect(ctx.repository.update).not.toHaveBeenCalled();
  });
});

describe('SkuService.createForOnboardingInTx (V1: listing quick onboarding, D2/D3/D5)', () => {
  function buildTxService(options?: {
    brand?: { id: string; name: string } | null;
    category?: { id: string; nameZh: string; level: number } | null;
  }) {
    const saved: Array<Record<string, unknown>> = [];
    const repository = {} as SkuRepository;
    const manager = {
      getRepository: vi.fn(() => ({
        create: vi.fn((row: Record<string, unknown>) => {
          saved.push(row);
          return row;
        }),
        save: vi.fn(async (row: Record<string, unknown>) => row),
      })),
    };
    const businessCode = {
      nextSkuCodeGlobal: vi.fn(async () => 'SKU000012002'),
    } as unknown as BusinessCodeService;
    const operationLog = { record: vi.fn(async () => undefined) } as unknown as OperationLogService;
    const objectStorage = {} as ObjectStorageService;
    const catalogService = {
      findBrandEntityById: vi.fn(async () =>
        options?.brand === undefined ? { id: 'brand-1', name: 'VK' } : options.brand,
      ),
      findCategoryEntityById: vi.fn(async () =>
        options?.category === undefined
          ? { id: 'cat-3', nameZh: '机械键盘', level: 3 }
          : options.category,
      ),
    } as unknown as CatalogService;
    const service = new SkuService(
      repository,
      objectStorage,
      businessCode,
      operationLog,
      catalogService,
    );
    return { service, manager, businessCode, saved };
  }

  it('creates an ACTIVE SKU with the global code and the given brand/category', async () => {
    const ctx = buildTxService();
    const created = await ctx.service.createForOnboardingInTx(ctx.manager as never, {
      nameZh: 'VK87 MAX V2 黑色',
      brandId: 'brand-1',
      categoryId: 'cat-3',
    });

    expect(ctx.businessCode.nextSkuCodeGlobal).toHaveBeenCalledWith(ctx.manager);
    expect(ctx.saved[0]?.status).toBe('ACTIVE');
    expect(ctx.saved[0]?.skuCode).toBe('SKU000012002');
    expect(ctx.saved[0]?.brandId).toBe('brand-1');
    expect(ctx.saved[0]?.categoryId).toBe('cat-3');
    expect(ctx.saved[0]).not.toHaveProperty('productId');
    expect(created.skuCode).toBe('SKU000012002');
  });

  it('validates the category level (422 CATEGORY_LEVEL_INVALID on a level-2 node)', async () => {
    const ctx = buildTxService({ category: { id: 'cat-2', nameZh: '键盘', level: 2 } });
    await expect(
      ctx.service.createForOnboardingInTx(ctx.manager as never, {
        nameZh: 'x',
        categoryId: 'cat-2',
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_LEVEL_INVALID' });
    expect(ctx.saved.length).toBe(0);
  });

  it('validates brand existence (404 BRAND_NOT_FOUND)', async () => {
    const ctx = buildTxService({ brand: null });
    await expect(
      ctx.service.createForOnboardingInTx(ctx.manager as never, {
        nameZh: 'x',
        brandId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'BRAND_NOT_FOUND' });
    expect(ctx.saved.length).toBe(0);
  });
});

describe('SkuService.remove (zero-reference policy, decision 0003)', () => {
  it('hard-deletes an unreferenced SKU', async () => {
    const ctx = buildService();
    await ctx.service.remove('sku-1', operator);
    expect(ctx.repository.delete).toHaveBeenCalledWith('sku-1');
    expect(ctx.operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE' }),
    );
  });

  it('refuses when any table still references the SKU (SKU_IN_USE)', async () => {
    const ctx = buildService();
    vi.mocked(ctx.repository.countReferences).mockResolvedValue([
      { table: 'sku_barcodes', count: 0 },
      { table: 'order_items', count: 2 },
    ]);
    await expect(ctx.service.remove('sku-1', operator)).rejects.toThrow(SkuInUseError);
    expect(ctx.repository.delete).not.toHaveBeenCalled();
  });
});
