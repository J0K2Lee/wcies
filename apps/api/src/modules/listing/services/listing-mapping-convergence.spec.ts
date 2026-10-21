import { describe, expect, it, vi } from 'vitest';
import { ListingService } from './listing.service';
import { ListingRepository, MappingRowWithRefs } from '../repositories/listing.repository';
import { ListingDetailDto } from '../dto/listing.dto';
import { PlatformListingEntity } from '../entities/platform-listing.entity';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

/**
 * 映射写入 → 订单行收敛（2026-10-20 bug 修复）。
 *
 * 现实来源：订单先摄入（SKU 未建档 → 行 mapping FAILED + 映射异常），
 * 之后通过 Excel 导入 / 手工新增映射 / 重新启用链接把变体映射建好，
 * 但只有「绑定已同步 UNMAPPED 变体」的路径会触发订单行批量收敛，其余
 * 路径必须等人工逐单「重试映射」。这里锁定所有写入路径都收敛。
 */

const OPERATOR = { userId: null, username: 'tester' };

function makeMapping(overrides: Partial<PlatformListingSkuEntity> = {}): PlatformListingSkuEntity {
  return {
    id: 'mapping-1',
    listingId: 'listing-1',
    skuId: 'sku-1',
    mappingStatus: 'MAPPED',
    platformSkuId: 'PS1',
    sellerSku: 'SELL-1',
    offerId: null,
    status: 'ACTIVE',
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeListing(overrides: Partial<PlatformListingEntity> = {}): PlatformListingEntity {
  return {
    id: 'listing-1',
    platformId: 'platform-1',
    storeId: 'store-1',
    platformProductId: 'P1',
    title: null,
    url: null,
    status: 'ACTIVE',
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PlatformListingEntity;
}

function build() {
  const repository = {
    findMappingByListingAndSku: vi.fn(async (): Promise<PlatformListingSkuEntity | null> => null),
    findUnmappedVariantByIdentifiers: vi.fn(
      async (): Promise<PlatformListingSkuEntity | null> => null,
    ),
    updateMapping: vi.fn(async (): Promise<void> => undefined),
    insertMapping: vi.fn(
      async (row: Partial<PlatformListingSkuEntity>): Promise<PlatformListingSkuEntity> =>
        makeMapping(row),
    ),
    findMappingById: vi.fn(async (_id: string): Promise<PlatformListingSkuEntity | null> =>
      makeMapping(),
    ),
    findListingById: vi.fn(async (): Promise<PlatformListingEntity | null> => makeListing()),
    updateListing: vi.fn(async (): Promise<void> => undefined),
    listMappingsByListingId: vi.fn(async (): Promise<MappingRowWithRefs[]> => []),
  };
  const skuService = {
    getEntityById: vi.fn(async () => ({ id: 'sku-1', skuCode: 'SKU000001', nameZh: '名称' })),
  };
  const operationLog = { record: vi.fn(async () => undefined) };
  const orderIngestion = { retryFailedMappingForVariant: vi.fn(async () => undefined) };
  const service = new ListingService(
    repository as unknown as ListingRepository,
    {} as never,
    {} as never,
    skuService as never,
    operationLog as never,
    orderIngestion as never,
  );
  return { service, repository, orderIngestion, skuService };
}

describe('ListingService mapping-write convergence', () => {
  it('Excel 导入绑定已同步变体后收敛订单行', async () => {
    const { service, repository, orderIngestion } = build();
    repository.findUnmappedVariantByIdentifiers.mockResolvedValueOnce(
      makeMapping({ mappingStatus: 'UNMAPPED', skuId: null }),
    );

    await service.addMappingForImport(
      { listingId: 'listing-1', skuId: 'sku-1', platformSkuId: 'PS1', sellerSku: 'SELL-1' },
      OPERATOR,
    );

    expect(orderIngestion.retryFailedMappingForVariant).toHaveBeenCalledWith(
      { storeId: 'store-1', platformSkuId: 'PS1', sellerSku: 'SELL-1' },
      OPERATOR,
    );
  });

  it('Excel 导入新建映射后同样收敛订单行', async () => {
    const { service, repository, orderIngestion } = build();
    repository.findMappingById.mockResolvedValueOnce(
      makeMapping({ platformSkuId: 'PS2', sellerSku: null }),
    );

    await service.addMappingForImport(
      { listingId: 'listing-1', skuId: 'sku-1', platformSkuId: 'PS2', sellerSku: null },
      OPERATOR,
    );

    expect(orderIngestion.retryFailedMappingForVariant).toHaveBeenCalledWith(
      { storeId: 'store-1', platformSkuId: 'PS2', sellerSku: null },
      OPERATOR,
    );
  });

  it('重复映射（已存在同 SKU 映射）不触发收敛', async () => {
    const { service, repository, orderIngestion } = build();
    repository.findMappingByListingAndSku.mockResolvedValueOnce(makeMapping());

    await service.addMappingForImport(
      { listingId: 'listing-1', skuId: 'sku-1', platformSkuId: 'PS1' },
      OPERATOR,
    );

    expect(orderIngestion.retryFailedMappingForVariant).not.toHaveBeenCalled();
  });

  it('重新启用链接后逐个已映射变体收敛（链接非 ACTIVE 曾使行不可解析）', async () => {
    const { service, repository, orderIngestion } = build();
    repository.findListingById.mockResolvedValueOnce(makeListing({ status: 'INACTIVE' }));
    repository.listMappingsByListingId.mockResolvedValueOnce([
      { mapping: makeMapping(), skuCode: 'SKU000001', skuName: '名称' },
      {
        mapping: makeMapping({ id: 'mapping-2', platformSkuId: 'PS2' }),
        skuCode: 'SKU000002',
        skuName: '名称2',
      },
      {
        mapping: makeMapping({ id: 'mapping-3', mappingStatus: 'UNMAPPED', skuId: null }),
        skuCode: null,
        skuName: null,
      },
    ]);
    vi.spyOn(service, 'getDetail').mockResolvedValue({} as ListingDetailDto);
    // retryOrderLinesAfterMappingRepair 重新读取映射与链接。
    repository.findMappingById.mockImplementation(async (id: string) =>
      makeMapping({ id, listingId: 'listing-1' }),
    );

    await service.setStatus('listing-1', 'ACTIVE', OPERATOR);

    // 两行 MAPPED 各收敛一次，UNMAPPED 行不收敛。
    expect(orderIngestion.retryFailedMappingForVariant).toHaveBeenCalledTimes(2);
  });

  it('启用已 ACTIVE 的链接不重复收敛', async () => {
    const { service, repository, orderIngestion } = build();
    repository.findListingById.mockResolvedValueOnce(makeListing({ status: 'ACTIVE' }));
    vi.spyOn(service, 'getDetail').mockResolvedValue({} as ListingDetailDto);

    await service.setStatus('listing-1', 'ACTIVE', OPERATOR);

    expect(orderIngestion.retryFailedMappingForVariant).not.toHaveBeenCalled();
  });
});
