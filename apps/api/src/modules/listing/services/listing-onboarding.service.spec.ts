import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { ListingOnboardingService } from './listing-onboarding.service';
import { ListingRepository } from '../repositories/listing.repository';
import { SkuService } from '../../product/services/sku.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { ListingService } from './listing.service';
import { PlatformCategoryMappingRepository } from '../repositories/platform-category-mapping.repository';
import { SkuImageImportService } from '../../product/services/sku-image-import.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { PlatformListingEntity } from '../entities/platform-listing.entity';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

/**
 * V1 onboarding unit tests: lock-first transaction shape, direct SKU
 * creation (no product layer, D2/D3/D5), remember-mapping in the same
 * transaction, and post-commit side effects. DB-level atomicity and FOR
 * UPDATE serialization are proven by the Sprint 8.5 integration spec
 * against real PostgreSQL.
 */

const operator = { userId: null, username: 'tester' };

function makeListing(overrides: Partial<PlatformListingEntity> = {}): PlatformListingEntity {
  return {
    id: 'listing-1',
    platformId: 'plat-1',
    storeId: 'store-1',
    platformProductId: 'P100',
    title: 'Тестовый товар',
    url: null,
    status: 'ACTIVE',
    rawData: null,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMapping(overrides: Partial<PlatformListingSkuEntity> = {}): PlatformListingSkuEntity {
  return {
    id: 'mapping-1',
    listingId: 'listing-1',
    skuId: null,
    mappingStatus: 'UNMAPPED',
    platformSkuId: 'psku-1',
    offerId: 'offer-1',
    sellerSku: null,
    status: 'ACTIVE',
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BuildOptions {
  listing?: PlatformListingEntity | null;
  mapping?: PlatformListingSkuEntity | null;
  /** Row seen by the IN-TRANSACTION lock (defaults to `mapping`). */
  lockedMapping?: PlatformListingSkuEntity | null;
}

function buildService(overrides?: BuildOptions) {
  const invocationOrder: string[] = [];
  const listing =
    overrides?.listing === undefined ? makeListing() : (overrides.listing as PlatformListingEntity);
  const mapping =
    overrides?.mapping === undefined
      ? makeMapping()
      : (overrides.mapping as PlatformListingSkuEntity);
  const lockedMapping = overrides?.lockedMapping === undefined ? mapping : overrides.lockedMapping;

  const repository = {
    findListingById: vi.fn().mockResolvedValue(listing),
    findMappingById: vi.fn().mockResolvedValue(mapping),
    lockMappingByIdInTx: vi.fn(async () => {
      invocationOrder.push('lock');
      return lockedMapping;
    }),
  } as unknown as ListingRepository;

  const skuService = {
    createForOnboardingInTx: vi.fn(async () => {
      invocationOrder.push('sku');
      return { id: 'sku-1', skuCode: 'SKU000012002', nameZh: 'Тестовый товар' };
    }),
  } as unknown as SkuService;

  const barcodeService = {
    generateInternalInTx: vi.fn(async () => {
      invocationOrder.push('barcode');
      return { id: 'bc-1', barcode: '000042' };
    }),
  } as unknown as BarcodeService;

  const listingService = {
    mapUnmappedSkuInTx: vi.fn(async () => {
      invocationOrder.push('mapping');
      return makeMapping({ skuId: 'sku-1', mappingStatus: 'MAPPED' });
    }),
  } as unknown as ListingService;

  const categoryMappingRepository = {
    insertIgnoreInTx: vi.fn(async () => {
      invocationOrder.push('remember');
      return true;
    }),
  } as unknown as PlatformCategoryMappingRepository;

  const skuImageImport = {
    scheduleFromOnboard: vi.fn(async () => true),
  } as unknown as SkuImageImportService;

  const operationLog = {
    record: vi.fn(
      async (_entry: Parameters<OperationLogService['record']>[0]): Promise<void> => undefined,
    ),
  };

  const txManager = {} as EntityManager;
  const transaction = vi.fn(async (callback: (manager: EntityManager) => Promise<unknown>) =>
    callback(txManager),
  );
  const dataSource = { transaction } as unknown as DataSource;

  const service = new ListingOnboardingService(
    dataSource,
    repository,
    skuService,
    barcodeService,
    listingService,
    categoryMappingRepository,
    skuImageImport,
    operationLog as unknown as OperationLogService,
  );
  return {
    service,
    repository,
    skuService,
    barcodeService,
    listingService,
    categoryMappingRepository,
    skuImageImport,
    operationLog,
    transaction,
    invocationOrder,
  };
}

describe('ListingOnboardingService (V1: direct SKU onboarding)', () => {
  it('locks the mapping row FIRST, then sku -> barcode -> mapping in ONE transaction', async () => {
    const ctx = buildService();
    const result = await ctx.service.onboard('listing-1', 'mapping-1', {}, operator);

    expect(ctx.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.invocationOrder).toEqual(['lock', 'sku', 'barcode', 'mapping']);
    expect(ctx.repository.lockMappingByIdInTx).toHaveBeenCalledWith(expect.anything(), 'mapping-1');
    expect(ctx.skuService.createForOnboardingInTx).toHaveBeenCalledWith(expect.anything(), {
      nameZh: 'Тестовый товар',
      brandId: null,
      categoryId: null,
      weightG: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      latestPurchasePrice: null,
    });
    expect(result.sku.skuCode).toBe('SKU000012002');
    expect(result.barcode).toBe('000042');
    expect(result.mappingStatus).toBe('MAPPED');
    // The response no longer carries any product surface (D6).
    expect(result).not.toHaveProperty('product');
    expect(result).not.toHaveProperty('productCreated');
  });

  it('re-checks UNMAPPED under the lock - a concurrent double submit gets the same 409', async () => {
    const ctx = buildService({
      mapping: makeMapping(),
      lockedMapping: makeMapping({ skuId: 'other-sku', mappingStatus: 'MAPPED' }),
    });
    await expect(ctx.service.onboard('listing-1', 'mapping-1', {}, operator)).rejects.toMatchObject(
      { code: 'LISTING_SKU_MAPPING_INVALID_STATE' },
    );
    // Nothing was built inside the transaction.
    expect(ctx.skuService.createForOnboardingInTx).not.toHaveBeenCalled();
    expect(ctx.operationLog.record).not.toHaveBeenCalled();
  });

  it('passes brand/category to the SKU create, dims + purchase price through (T3c/T4/T5/R1, D5)', async () => {
    const ctx = buildService();
    await ctx.service.onboard(
      'listing-1',
      'mapping-1',
      {
        brandId: 'brand-1',
        categoryId: 'cat-3',
        weightG: 700,
        lengthMm: 300,
        widthMm: 220,
        heightMm: 40,
        latestPurchasePrice: 88.5,
      },
      operator,
    );
    expect(ctx.skuService.createForOnboardingInTx).toHaveBeenCalledWith(expect.anything(), {
      nameZh: 'Тестовый товар',
      brandId: 'brand-1',
      categoryId: 'cat-3',
      weightG: 700,
      lengthMm: 300,
      widthMm: 220,
      heightMm: 40,
      latestPurchasePrice: 88.5,
    });
  });

  it('writes the remember-mapping row in the same transaction (T3c)', async () => {
    const ctx = buildService({
      mapping: makeMapping({
        rawData: { description_category_id: 62573858, type_id: 92952 },
      }),
      lockedMapping: makeMapping({
        rawData: { description_category_id: 62573858, type_id: 92952 },
      }),
    });
    await ctx.service.onboard(
      'listing-1',
      'mapping-1',
      { categoryId: 'internal-cat-1', rememberCategoryMapping: true },
      operator,
    );
    expect(ctx.categoryMappingRepository.insertIgnoreInTx).toHaveBeenCalledWith(expect.anything(), {
      platformId: 'plat-1',
      externalCategoryId: '62573858',
      externalTypeId: '92952',
      internalCategoryId: 'internal-cat-1',
      source: 'ONBOARD',
      createdBy: null,
    });
    expect(ctx.invocationOrder).toContain('remember');
  });

  it('skips remember-mapping when disabled or keys are absent', async () => {
    const absent = buildService();
    await absent.service.onboard(
      'listing-1',
      'mapping-1',
      { categoryId: 'internal-cat-1' },
      operator,
    );
    expect(absent.categoryMappingRepository.insertIgnoreInTx).not.toHaveBeenCalled();

    const disabled = buildService({
      mapping: makeMapping({
        rawData: { description_category_id: 62573858, type_id: 92952 },
      }),
      lockedMapping: makeMapping({
        rawData: { description_category_id: 62573858, type_id: 92952 },
      }),
    });
    await disabled.service.onboard(
      'listing-1',
      'mapping-1',
      { categoryId: 'internal-cat-1', rememberCategoryMapping: false },
      operator,
    );
    expect(disabled.categoryMappingRepository.insertIgnoreInTx).not.toHaveBeenCalled();
  });

  it('schedules the CDN image import AFTER commit (T6)', async () => {
    const ctx = buildService({
      mapping: makeMapping({
        rawData: { primary_image: 'https://cdn/img1.jpg', color_image: 'https://cdn/color.jpg' },
      }),
      lockedMapping: makeMapping({
        rawData: { primary_image: 'https://cdn/img1.jpg', color_image: 'https://cdn/color.jpg' },
      }),
    });
    await ctx.service.onboard('listing-1', 'mapping-1', {}, operator);
    // color_image wins per the planning (§T6.2).
    expect(ctx.skuImageImport.scheduleFromOnboard).toHaveBeenCalledWith(
      'sku-1',
      'https://cdn/color.jpg',
    );
  });

  it('requires a name when neither input nor listing title provides one', async () => {
    const ctx = buildService({ listing: makeListing({ title: null }) });
    await expect(ctx.service.onboard('listing-1', 'mapping-1', {}, operator)).rejects.toMatchObject(
      { code: 'LISTING_ONBOARD_NAME_REQUIRED' },
    );
    expect(ctx.skuService.createForOnboardingInTx).not.toHaveBeenCalled();
  });

  it('skips barcode generation when generateBarcode is false', async () => {
    const ctx = buildService();
    const result = await ctx.service.onboard(
      'listing-1',
      'mapping-1',
      { generateBarcode: false },
      operator,
    );
    expect(ctx.barcodeService.generateInternalInTx).not.toHaveBeenCalled();
    expect(result.barcode).toBeNull();
  });

  it('writes audit entries only AFTER the commit (sku + barcode + map)', async () => {
    const ctx = buildService();
    await ctx.service.onboard('listing-1', 'mapping-1', {}, operator);
    const actions = vi.mocked(ctx.operationLog.record).mock.calls.map((call) => call[0].action);
    expect(actions).toEqual(['CREATE', 'CREATE', 'MAP']);
  });
});
