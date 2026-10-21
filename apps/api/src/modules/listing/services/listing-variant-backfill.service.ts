import { Injectable } from '@nestjs/common';
import { PlatformListingRaw, StoreContext } from '@wcies/platform-contracts';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { OperationLogService, OperatorContext } from '../../operation-log/operation-log.service';
import { PlatformService } from '../../platform/platform.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { StoreService } from '../../store/services/store.service';
import { ListingRepository } from '../repositories/listing.repository';
import { ListingService } from './listing.service';

export type EnsureVariantSource = 'PLATFORM' | 'ORDER_FACTS';
export type EnsureVariantReason =
  'NOT_FOUND' | 'UNSUPPORTED' | 'MISSING_IDENTIFIERS' | 'REFRESH_FAILED';

export interface EnsureVariantInput {
  storeId: string;
  platformProductId?: string | null;
  platformSkuId?: string | null;
  offerId?: string | null;
  sellerSku?: string | null;
  source: EnsureVariantSource;
}

export interface EnsureVariantOutcome {
  resolved: boolean;
  listingId: string | null;
  variantId: string | null;
  source: 'LOCAL' | 'PLATFORM' | 'ORDER_FACTS' | null;
  reason: EnsureVariantReason | null;
}

const MISS_TTL_MS = 10 * 60 * 1000;
const MISS_CACHE_MAX = 500;

/**
 * 订单行按需补链接（2026-10-20，用户决策：C 为主、B 兜底、A 可选）。
 *
 * 背景：映射弹窗只查本地链接镜像。平台侧新上架、而 listing sync 还没
 * walk 到的商品，订单行会一直「无法映射」，且两个按钮都无路可走。
 *
 * - `PLATFORM`（C）：按订单行自带的平台标识做一次定向读取，把平台事实
 *   落成 UNMAPPED 变体后返回 listingId。每次点击最多一次平台调用，本地
 *   已有变体时零调用；查不到的标识做 10 分钟负缓存，重复点击不再打接口。
 * - `ORDER_FACTS`（B）：平台不支持/接口失败/查不到时的兜底，用订单里已有
 *   的标识在本地补建链接与变体，零平台调用。数据来源在 raw_data 标记，
 *   由后续 listing sync 按平台事实校正。
 *
 * 两条路径都只补「链接 + UNMAPPED 变体」，绝不替人决定内部 SKU
 * （决策 0016 / orders.md §54）。
 */
@Injectable()
export class ListingVariantBackfillService {
  /** 平台侧「查不到」的短时负缓存（进程内，仅减少重复访问，不是业务事实）。 */
  private readonly missCache = new Map<string, number>();

  constructor(
    private readonly repository: ListingRepository,
    private readonly listingService: ListingService,
    private readonly storeService: StoreService,
    private readonly platformService: PlatformService,
    private readonly credentialService: PlatformCredentialService,
    private readonly registry: PlatformAdapterRegistry,
    private readonly operationLog: OperationLogService,
    private readonly logger: AppLoggerService,
  ) {}

  async ensure(
    input: EnsureVariantInput,
    operator: OperatorContext,
  ): Promise<EnsureVariantOutcome> {
    const store = await this.storeService.getEntityById(input.storeId);
    if (store === null || store.status !== 'ACTIVE') {
      throw new StoreNotFoundError(input.storeId);
    }
    const identifiers = {
      platformProductId: trimOrNull(input.platformProductId),
      platformSkuId: trimOrNull(input.platformSkuId),
      offerId: trimOrNull(input.offerId),
      sellerSku: trimOrNull(input.sellerSku),
    };

    // 本地优先：命中就不再访问平台（成功一次后，后续点击都走这里）。
    const local = await this.repository.findUnmappedVariantByStoreAndIdentifiers(input.storeId, {
      platformSkuId: identifiers.platformSkuId,
      sellerSku: identifiers.sellerSku,
    });
    if (local !== null) {
      return resolved(local.listingId, local.variantId, 'LOCAL');
    }

    if (input.source === 'ORDER_FACTS') {
      return this.createFromOrderFacts(input.storeId, identifiers, operator);
    }
    return this.pullFromPlatform(store, identifiers);
  }

  private async pullFromPlatform(
    store: NonNullable<Awaited<ReturnType<StoreService['getEntityById']>>>,
    identifiers: {
      platformProductId: string | null;
      platformSkuId: string | null;
      offerId: string | null;
      sellerSku: string | null;
    },
  ): Promise<EnsureVariantOutcome> {
    if (identifiers.platformSkuId === null && identifiers.offerId === null) {
      return unresolved('MISSING_IDENTIFIERS');
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    if (platform === null || !this.registry.has(platform.code)) {
      return unresolved('UNSUPPORTED');
    }
    const adapter = this.registry.getAdapter(platform.code);
    if (adapter.fetchListingVariant === undefined) {
      return unresolved('UNSUPPORTED');
    }
    const cacheKey = [
      store.id,
      identifiers.platformSkuId ?? '',
      identifiers.offerId ?? '',
      identifiers.sellerSku ?? '',
    ].join('|');
    const missedUntil = this.missCache.get(cacheKey);
    if (missedUntil !== undefined) {
      if (missedUntil > Date.now()) {
        return unresolved('NOT_FOUND');
      }
      this.missCache.delete(cacheKey);
    }

    const payload = await this.credentialService.getDecryptedActivePayload(store.id, 'MAIN_API');
    if (payload === null) {
      this.logger.warn('variant backfill skipped: store has no MAIN_API credential', {
        module: 'listing',
        storeId: store.id,
      });
      return unresolved('REFRESH_FAILED');
    }
    const context: StoreContext = {
      storeId: store.id,
      storeCode: store.storeCode,
      platform: adapter.platformCode,
      credential: payload,
    };
    let raw: PlatformListingRaw | null;
    try {
      raw = await adapter.fetchListingVariant(context, {
        platformSkuId: identifiers.platformSkuId,
        offerId: identifiers.offerId,
        platformProductId: identifiers.platformProductId,
      });
    } catch (error: unknown) {
      // 平台读失败不是「查不到」：不回负缓存，界面据此走 B 兜底。
      this.logger.warn('variant backfill platform read failed', {
        module: 'listing',
        storeId: store.id,
        platform: adapter.platformCode,
        code: errorCodeOf(error),
      });
      return unresolved('REFRESH_FAILED');
    }
    if (raw === null) {
      this.rememberMiss(cacheKey);
      return unresolved('NOT_FOUND');
    }

    await this.listingService.applyPlatformListing({
      storeId: store.id,
      platformProductId: raw.platformProductId,
      title: raw.title,
      url: raw.url,
      platformStatus: raw.platformStatus,
      skus: raw.skus.map((sku) => ({
        platformSkuId: sku.platformSkuId,
        offerId: sku.offerId,
        sellerSku: sku.sellerSku,
        rawData: sku.rawData,
      })),
      rawData: raw.rawData,
    });
    const found = await this.findVariant(store.id, raw.platformProductId, {
      platformSkuId: raw.skus[0]?.platformSkuId ?? identifiers.platformSkuId,
      sellerSku: raw.skus[0]?.sellerSku ?? identifiers.sellerSku,
    });
    if (found === null) {
      return unresolved('NOT_FOUND');
    }
    return resolved(found.listingId, found.variantId, 'PLATFORM');
  }

  /**
   * B 兜底：订单事实建链。平台没有可用的定向读取时，用订单行已有的
   * platformProductId / platformSkuId / sellerSku 在本地补一行，随后由
   * 正常的 SKU 映射/建档流程接手。不做任何平台猜测。
   */
  private async createFromOrderFacts(
    storeId: string,
    identifiers: {
      platformProductId: string | null;
      platformSkuId: string | null;
      offerId: string | null;
      sellerSku: string | null;
    },
    operator: OperatorContext,
  ): Promise<EnsureVariantOutcome> {
    const productId = identifiers.platformProductId;
    if (
      productId === null ||
      (identifiers.platformSkuId === null && identifiers.sellerSku === null)
    ) {
      return unresolved('MISSING_IDENTIFIERS');
    }
    await this.listingService.applyPlatformListing({
      storeId,
      platformProductId: productId,
      title: null,
      url: null,
      platformStatus: null,
      skus: [
        {
          platformSkuId: identifiers.platformSkuId,
          offerId: identifiers.offerId,
          sellerSku: identifiers.sellerSku,
          rawData: { source: 'ORDER_FACTS' },
        },
      ],
      rawData: { source: 'ORDER_FACTS', note: 'order-line backfill' },
      allowSellerSkuKeyed: true,
    });
    const listing = await this.repository.findListingByStoreAndProductId(storeId, productId);
    if (listing === null) {
      return unresolved('NOT_FOUND');
    }
    const variant =
      identifiers.platformSkuId !== null
        ? await this.repository.findActiveMappingByListingAndPlatformSkuId(
            listing.id,
            identifiers.platformSkuId,
          )
        : identifiers.sellerSku !== null
          ? await this.repository.findActiveMappingByListingAndSellerSku(
              listing.id,
              identifiers.sellerSku,
            )
          : null;
    if (variant === null) {
      return unresolved('MISSING_IDENTIFIERS');
    }
    await this.operationLog.record({
      entityType: 'PLATFORM_LISTING',
      entityId: listing.id,
      entityCode: productId,
      action: 'BACKFILL_CREATE',
      changes: {
        source: { from: null, to: 'ORDER_FACTS' },
        platformSkuId: { from: null, to: identifiers.platformSkuId },
        sellerSku: { from: null, to: identifiers.sellerSku },
      },
      operator,
    });
    return resolved(listing.id, variant.id, 'ORDER_FACTS');
  }

  private async findVariant(
    storeId: string,
    platformProductId: string,
    identifiers: { platformSkuId: string | null; sellerSku: string | null },
  ): Promise<{ listingId: string; variantId: string } | null> {
    const listing = await this.repository.findListingByStoreAndProductId(
      storeId,
      platformProductId,
    );
    if (listing === null) {
      return null;
    }
    const variant =
      identifiers.platformSkuId !== null
        ? await this.repository.findActiveMappingByListingAndPlatformSkuId(
            listing.id,
            identifiers.platformSkuId,
          )
        : identifiers.sellerSku !== null
          ? await this.repository.findActiveMappingByListingAndSellerSku(
              listing.id,
              identifiers.sellerSku,
            )
          : null;
    return variant === null ? null : { listingId: listing.id, variantId: variant.id };
  }

  private rememberMiss(key: string): void {
    if (this.missCache.size >= MISS_CACHE_MAX) {
      this.missCache.clear();
    }
    this.missCache.set(key, Date.now() + MISS_TTL_MS);
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function resolved(
  listingId: string,
  variantId: string,
  source: 'LOCAL' | 'PLATFORM' | 'ORDER_FACTS',
): EnsureVariantOutcome {
  return { resolved: true, listingId, variantId, source, reason: null };
}

function unresolved(reason: EnsureVariantReason): EnsureVariantOutcome {
  return { resolved: false, listingId: null, variantId: null, source: null, reason };
}

function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return 'UNKNOWN';
}
