import { describe, expect, it, vi } from 'vitest';
import { PlatformListingRaw } from '@wcies/platform-contracts';
import { ListingVariantBackfillService } from './listing-variant-backfill.service';
import { ListingRepository } from '../repositories/listing.repository';
import { ListingService } from './listing.service';
import { StoreService } from '../../store/services/store.service';
import { PlatformService } from '../../platform/platform.service';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

const OPERATOR = { userId: null, username: 'tester' };

const STORE = {
  id: 'store-1',
  status: 'ACTIVE',
  platformId: 'platform-1',
  storeCode: 'ON-002',
};
const PLATFORM = { id: 'platform-1', code: 'OZON' };

const PLATFORM_RAW: PlatformListingRaw = {
  platformProductId: '3706007459',
  title: 'KASIER 标配',
  url: null,
  platformStatus: 'LISTED',
  skus: [
    {
      platformSkuId: '6040898074',
      offerId: 'KASIER标配【4.4mm插头】',
      sellerSku: null,
      rawData: { sku: 6040898074 },
    },
  ],
  rawData: {},
};

type FetchVariant = (
  context: unknown,
  identifiers: {
    platformSkuId?: string | null;
    offerId?: string | null;
    platformProductId?: string | null;
  },
) => Promise<PlatformListingRaw | null>;

function build(overrides: {
  local?: { listingId: string; variantId: string } | null;
  /** 省略 = 平台适配器没有定向读取能力。 */
  fetchVariant?: FetchVariant;
  credentialPayload?: Record<string, unknown> | null;
  platformSkuVariant?: { id: string } | null;
  sellerSkuVariant?: { id: string } | null;
}) {
  const fetchVariant = overrides.fetchVariant ?? vi.fn<FetchVariant>();
  const repository = {
    findUnmappedVariantByStoreAndIdentifiers: vi.fn().mockResolvedValue(overrides.local ?? null),
    findListingByStoreAndProductId: vi.fn().mockResolvedValue({ id: 'listing-1' }),
    findActiveMappingByListingAndPlatformSkuId: vi
      .fn()
      .mockResolvedValue(overrides.platformSkuVariant ?? null),
    findActiveMappingByListingAndSellerSku: vi
      .fn()
      .mockResolvedValue(overrides.sellerSkuVariant ?? null),
  } as unknown as ListingRepository;
  const listingService = {
    applyPlatformListing: vi.fn().mockResolvedValue('CREATED'),
  } as unknown as ListingService;
  const storeService = {
    getEntityById: vi.fn().mockResolvedValue(STORE),
  } as unknown as StoreService;
  const platformService = {
    getEntityById: vi.fn().mockResolvedValue(PLATFORM),
  } as unknown as PlatformService;
  const credentialService = {
    getDecryptedActivePayload: vi
      .fn()
      .mockResolvedValue(
        overrides.credentialPayload === undefined
          ? { clientId: '1', apiKey: 'k' }
          : overrides.credentialPayload,
      ),
  } as unknown as PlatformCredentialService;
  const adapter =
    overrides.fetchVariant === undefined
      ? ({ platformCode: 'OZON' } as const)
      : ({ platformCode: 'OZON', fetchListingVariant: overrides.fetchVariant } as const);
  const registry = {
    has: vi.fn().mockReturnValue(true),
    getAdapter: vi.fn().mockReturnValue(adapter),
  } as unknown as PlatformAdapterRegistry;
  const operationLog = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as OperationLogService;
  const logger = { warn: vi.fn(), log: vi.fn(), info: vi.fn() } as unknown as AppLoggerService;

  const service = new ListingVariantBackfillService(
    repository,
    listingService,
    storeService,
    platformService,
    credentialService,
    registry,
    operationLog,
    logger,
  );
  return { service, repository, listingService, fetchVariant, operationLog };
}

describe('ListingVariantBackfillService.ensure', () => {
  it('本地已有 UNMAPPED 变体时零平台调用（重复点击不再打接口）', async () => {
    const fetchVariant = vi.fn<FetchVariant>().mockResolvedValue(PLATFORM_RAW);
    const { service, listingService } = build({
      local: { listingId: 'listing-local', variantId: 'variant-local' },
      fetchVariant,
    });

    const outcome = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );

    expect(outcome).toEqual({
      resolved: true,
      listingId: 'listing-local',
      variantId: 'variant-local',
      source: 'LOCAL',
      reason: null,
    });
    expect(fetchVariant).not.toHaveBeenCalled();
    expect(listingService.applyPlatformListing).not.toHaveBeenCalled();
  });

  it('平台定向读取命中：落库为 UNMAPPED 变体并返回 listingId', async () => {
    const fetchVariant = vi.fn<FetchVariant>().mockResolvedValue(PLATFORM_RAW);
    const { service, listingService } = build({
      fetchVariant,
      platformSkuVariant: { id: 'variant-1' },
    });

    const outcome = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );

    expect(outcome).toMatchObject({
      resolved: true,
      listingId: 'listing-1',
      variantId: 'variant-1',
      source: 'PLATFORM',
      reason: null,
    });
    expect(listingService.applyPlatformListing).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1', platformProductId: '3706007459' }),
    );
    expect(fetchVariant).toHaveBeenCalledTimes(1);
  });

  it('平台查不到时返回 NOT_FOUND，并在负缓存期内不再调用平台', async () => {
    const fetchVariant = vi.fn<FetchVariant>().mockResolvedValue(null);
    const { service } = build({ fetchVariant });

    const first = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );
    const second = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );

    expect(first).toMatchObject({ resolved: false, reason: 'NOT_FOUND' });
    expect(second).toMatchObject({ resolved: false, reason: 'NOT_FOUND' });
    expect(fetchVariant).toHaveBeenCalledTimes(1);
  });

  it('适配器没有定向读取能力时返回 UNSUPPORTED（界面据此走订单事实兜底）', async () => {
    const { service, listingService } = build({});

    const outcome = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );

    expect(outcome).toMatchObject({ resolved: false, reason: 'UNSUPPORTED' });
    expect(listingService.applyPlatformListing).not.toHaveBeenCalled();
  });

  it('平台接口失败返回 REFRESH_FAILED，且不写入负缓存（下次点击会再试）', async () => {
    const fetchVariant = vi.fn<FetchVariant>().mockRejectedValue(new Error('429'));
    const { service } = build({ fetchVariant });

    const first = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );
    const second = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );

    expect(first).toMatchObject({ resolved: false, reason: 'REFRESH_FAILED' });
    expect(second).toMatchObject({ resolved: false, reason: 'REFRESH_FAILED' });
    expect(fetchVariant).toHaveBeenCalledTimes(2);
  });

  it('ORDER_FACTS 兜底：没有 platformSkuId 时按 sellerSku 建链（Yandex 式订单行）', async () => {
    const { service, listingService, repository, operationLog } = build({
      sellerSkuVariant: { id: 'variant-seller' },
    });

    const outcome = await service.ensure(
      {
        storeId: 'store-1',
        platformProductId: 'prod-1',
        sellerSku: 'ART-001',
        offerId: 'ART-001',
        source: 'ORDER_FACTS',
      },
      OPERATOR,
    );

    expect(outcome).toMatchObject({
      resolved: true,
      listingId: 'listing-1',
      variantId: 'variant-seller',
      source: 'ORDER_FACTS',
    });
    expect(listingService.applyPlatformListing).toHaveBeenCalledWith(
      expect.objectContaining({ platformProductId: 'prod-1', allowSellerSkuKeyed: true }),
    );
    expect(repository.findActiveMappingByListingAndSellerSku).toHaveBeenCalledWith(
      'listing-1',
      'ART-001',
    );
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BACKFILL_CREATE' }),
    );
  });

  it('ORDER_FACTS 缺少商品 ID 时返回 MISSING_IDENTIFIERS（不凭空建链接）', async () => {
    const { service, listingService } = build({});

    const outcome = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'ORDER_FACTS' },
      OPERATOR,
    );

    expect(outcome).toMatchObject({ resolved: false, reason: 'MISSING_IDENTIFIERS' });
    expect(listingService.applyPlatformListing).not.toHaveBeenCalled();
  });

  it('店铺没有 MAIN_API 凭证时返回 REFRESH_FAILED，不抛出（界面仍可走兜底）', async () => {
    const fetchVariant = vi.fn<FetchVariant>().mockResolvedValue(PLATFORM_RAW);
    const { service } = build({ fetchVariant, credentialPayload: null });

    const outcome = await service.ensure(
      { storeId: 'store-1', platformSkuId: '6040898074', source: 'PLATFORM' },
      OPERATOR,
    );

    expect(outcome).toMatchObject({ resolved: false, reason: 'REFRESH_FAILED' });
    expect(fetchVariant).not.toHaveBeenCalled();
  });
});
