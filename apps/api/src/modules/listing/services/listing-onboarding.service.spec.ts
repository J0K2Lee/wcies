import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { ListingOnboardingService } from './listing-onboarding.service';
import { ListingRepository } from '../repositories/listing.repository';
import { ProductService } from '../../product/services/product.service';
import { SkuService } from '../../product/services/sku.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { ListingService } from './listing.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { PlatformListingEntity } from '../entities/platform-listing.entity';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

/**
 * Sprint 8 T1 orchestration unit tests: call order inside ONE transaction,
 * all-or-nothing failure semantics, and the UNMAPPED-only / name-fallback
 * guards. DB-level atomicity is TypeORM's transaction contract and is proven
 * by the Sprint 8 integration spec against real PostgreSQL.
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

function buildService(overrides?: {
  mapping?: PlatformListingSkuEntity | null;
  listing?: PlatformListingEntity | null;
}) {
  const invocationOrder: string[] = [];
  const repository = {
    findListingById: vi
      .fn()
      .mockResolvedValue(overrides?.listing === undefined ? makeListing() : overrides.listing),
    findMappingById: vi
      .fn()
      .mockResolvedValue(overrides?.mapping === undefined ? makeMapping() : overrides.mapping),
  } as unknown as ListingRepository;

  const productService = {
    createForOnboardingInTx: vi.fn(async () => {
      invocationOrder.push('product');
      return { id: 'prod-1', productCode: 'PN000001', nameZh: 'Тестовый товар' };
    }),
  } as unknown as ProductService;

  const skuService = {
    createForOnboardingInTx: vi.fn(async () => {
      invocationOrder.push('sku');
      return { id: 'sku-1', skuCode: 'SKU000001001', nameZh: 'Тестовый товар' };
    }),
  } as unknown as SkuService;

  const barcodeService = {
    generateInternalInTx: vi.fn(async () => {
      invocationOrder.push('barcode');
      return { id: 'bc-1', barcode: 'WCSKU00000001' };
    }),
  } as unknown as BarcodeService;

  const listingService = {
    mapUnmappedSkuInTx: vi.fn(async () => {
      invocationOrder.push('mapping');
      return makeMapping({ skuId: 'sku-1', mappingStatus: 'MAPPED' });
    }),
  } as unknown as ListingService;

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
    productService,
    skuService,
    barcodeService,
    listingService,
    operationLog as unknown as OperationLogService,
  );
  return {
    service,
    repository,
    productService,
    skuService,
    barcodeService,
    listingService,
    operationLog,
    transaction,
    invocationOrder,
  };
}

describe('ListingOnboardingService', () => {
  it('runs product -> sku -> barcode -> mapping in ONE transaction', async () => {
    const ctx = buildService();
    const result = await ctx.service.onboard('listing-1', 'mapping-1', {}, operator);

    expect(ctx.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.invocationOrder).toEqual(['product', 'sku', 'barcode', 'mapping']);
    expect(result.sku.skuCode).toBe('SKU000001001');
    expect(result.barcode).toBe('WCSKU00000001');
    expect(result.mappingStatus).toBe('MAPPED');
  });

  it('stops at the first failure - later steps never run (all-or-nothing)', async () => {
    const ctx = buildService();
    vi.mocked(ctx.skuService.createForOnboardingInTx).mockRejectedValueOnce(
      new Error('sku insert failed'),
    );
    await expect(ctx.service.onboard('listing-1', 'mapping-1', {}, operator)).rejects.toThrow(
      'sku insert failed',
    );
    expect(ctx.barcodeService.generateInternalInTx).not.toHaveBeenCalled();
    expect(ctx.listingService.mapUnmappedSkuInTx).not.toHaveBeenCalled();
    // No audit entries for a rolled-back attempt.
    expect(ctx.operationLog.record).not.toHaveBeenCalled();
  });

  it('rejects an already-mapped variant (quick-onboard is UNMAPPED-only)', async () => {
    const ctx = buildService({
      mapping: makeMapping({ skuId: 'existing-sku', mappingStatus: 'MAPPED' }),
    });
    await expect(ctx.service.onboard('listing-1', 'mapping-1', {}, operator)).rejects.toMatchObject(
      { code: 'LISTING_SKU_MAPPING_INVALID_STATE' },
    );
    expect(ctx.transaction).not.toHaveBeenCalled();
  });

  it('falls back to the listing title for names, and prefers explicit input', async () => {
    const ctx = buildService();
    await ctx.service.onboard('listing-1', 'mapping-1', {}, operator);
    expect(ctx.productService.createForOnboardingInTx).toHaveBeenCalledWith(
      expect.anything(),
      { nameZh: 'Тестовый товар' },
      operator,
    );

    await ctx.service.onboard(
      'listing-1',
      'mapping-1',
      {
        productNameZh: '自定义商品名',
        skuNameZh: '自定义SKU名',
      },
      operator,
    );
    expect(ctx.productService.createForOnboardingInTx).toHaveBeenLastCalledWith(
      expect.anything(),
      { nameZh: '自定义商品名' },
      operator,
    );
    expect(ctx.skuService.createForOnboardingInTx).toHaveBeenLastCalledWith(expect.anything(), {
      productId: 'prod-1',
      nameZh: '自定义SKU名',
    });
  });

  it('requires a name when neither input nor listing title provides one', async () => {
    const ctx = buildService({ listing: makeListing({ title: null }) });
    await expect(ctx.service.onboard('listing-1', 'mapping-1', {}, operator)).rejects.toMatchObject(
      { code: 'LISTING_ONBOARD_NAME_REQUIRED' },
    );
    expect(ctx.transaction).not.toHaveBeenCalled();
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

  it('writes audit entries only AFTER the commit, once per created entity', async () => {
    const ctx = buildService();
    await ctx.service.onboard('listing-1', 'mapping-1', {}, operator);
    const actions = vi.mocked(ctx.operationLog.record).mock.calls.map((call) => call[0].action);
    expect(actions).toEqual(['CREATE', 'CREATE', 'CREATE', 'MAP']);
  });
});
