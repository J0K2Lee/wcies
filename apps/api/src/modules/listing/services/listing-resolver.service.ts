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
    offerId?: string;
  }): Promise<ResolveSkuResponseDto> {
    const identifiers = {
      platformSkuId: trimOrUndefined(input.platformSkuId),
      sellerSku: trimOrUndefined(input.sellerSku),
      offerId: trimOrUndefined(input.offerId),
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
      matchedOfferId: match.offerId,
      matchedSellerSku: match.sellerSku,
      matchedPlatformSkuId: match.platformSkuId,
    };
  }
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
