import { Injectable } from '@nestjs/common';
import { SkuService } from '../../product/services/sku.service';
import {
  ListingSkuResolveAmbiguousError,
  ListingSkuResolveFailedError,
} from '../errors/listing-errors';
import { ListingRepository } from '../repositories/listing.repository';
import { ResolveSkuResponseDto } from '../dto/listing.dto';

/**
 * Store-scoped platform-SKU -> internal-SKU resolver (task §51-§54).
 *
 * Safety contract (order-sync boundary, AGENTS.md §26):
 * - resolution ALWAYS carries storeId; a global identifier lookup is
 *   architecturally impossible here (the repository enforces the scope);
 * - multiple matches within the same store raise
 *   LISTING_SKU_RESOLVE_AMBIGUOUS - "take the first row" is forbidden;
 * - no match raises LISTING_SKU_RESOLVE_FAILED.
 *
 * Decision 0016: identifiers are platform SKU id + seller SKU only. Offer id
 * is editable on the platform by operators, so it may never be the basis of
 * order resolution. `matchedOfferId` stays on the response (always null) so
 * existing clients keep their shape.
 */
@Injectable()
export class ListingResolverService {
  constructor(
    private readonly repository: ListingRepository,
    private readonly skuService: SkuService,
  ) {}

  async resolveInternalSku(input: {
    storeId: string;
    platformSkuId?: string;
    sellerSku?: string;
  }): Promise<ResolveSkuResponseDto> {
    const identifiers = {
      platformSkuId: trimOrUndefined(input.platformSkuId),
      sellerSku: trimOrUndefined(input.sellerSku),
    };
    const providedCount = Object.values(identifiers).filter((value) => value !== undefined).length;
    if (providedCount === 0) {
      throw new ListingSkuResolveFailedError(input.storeId, { reason: 'NO_IDENTIFIER_PROVIDED' });
    }

    const candidates = await this.repository.findResolveCandidates({
      storeId: input.storeId,
      ...identifiers,
    });

    if (candidates.length === 0) {
      throw new ListingSkuResolveFailedError(input.storeId, identifiers as Record<string, string>);
    }
    if (candidates.length > 1) {
      throw new ListingSkuResolveAmbiguousError(
        input.storeId,
        candidates.map((candidate) => candidate.mapping.id),
      );
    }

    const match = candidates[0]?.mapping;
    if (match === undefined) {
      throw new ListingSkuResolveFailedError(input.storeId, identifiers as Record<string, string>);
    }
    if (match.skuId === null || match.mappingStatus !== 'MAPPED') {
      // Defense in depth: the repository already filters these out.
      throw new ListingSkuResolveFailedError(input.storeId, identifiers as Record<string, string>);
    }
    const sku = await this.skuService.getEntityById(match.skuId);
    if (sku === null) {
      throw new ListingSkuResolveFailedError(input.storeId, identifiers as Record<string, string>);
    }

    return {
      listingId: match.listingId,
      listingSkuId: match.id,
      internalSkuId: sku.id,
      internalSkuCode: sku.skuCode,
      matchedOfferId: null,
      matchedSellerSku: match.sellerSku,
      matchedPlatformSkuId: match.platformSkuId,
    };
  }

  /**
   * 订单行 → 本店未映射变体（映射弹窗按订单行预选，2026-11-09）。
   * 与 resolveInternalSku 的区别：只找 UNMAPPED 行、返回 listing+variant 而不是 SKU。
   */
  async findUnmappedVariant(input: {
    storeId: string;
    platformSkuId?: string;
    sellerSku?: string;
    offerId?: string;
  }): Promise<{
    listingId: string;
    variantId: string;
    matchedBy: 'platformSkuId' | 'sellerSku' | 'offerId';
  } | null> {
    return this.repository.findUnmappedVariantByOrderIdentifiers(input);
  }
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
