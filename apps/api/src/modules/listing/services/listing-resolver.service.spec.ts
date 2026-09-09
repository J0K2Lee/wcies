import { describe, expect, it, vi } from 'vitest';
import { ListingResolverService } from './listing-resolver.service';
import {
  ListingSkuResolveAmbiguousError,
  ListingSkuResolveFailedError,
} from '../errors/listing-errors';
import { ListingRepository, ResolveCandidate } from '../repositories/listing.repository';
import { SkuService } from '../../product/services/sku.service';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

function makeMapping(id: string, skuId: string, offerId: string | null): PlatformListingSkuEntity {
  return {
    id,
    listingId: 'listing-1',
    skuId,
    platformSkuId: null,
    sellerSku: null,
    offerId,
    mappingStatus: 'MAPPED',
    status: 'ACTIVE',
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService(candidates: PlatformListingSkuEntity[]) {
  const findResolveCandidates = vi.fn().mockImplementation((input: { storeId: string }) =>
    Promise.resolve(
      candidates.map((mapping): ResolveCandidate => ({
        mapping,
        listingId: mapping.listingId,
        storeId: input.storeId,
      })),
    ),
  );
  const repository = { findResolveCandidates } as unknown as ListingRepository;
  // 'gone' simulates a mapping whose internal SKU was hard-deleted.
  const getEntityById = vi
    .fn()
    .mockImplementation((id: string) =>
      Promise.resolve(id === 'gone' ? null : { id, skuCode: `SKU-${id}`, nameZh: 'x' }),
    );
  const skuService = { getEntityById } as unknown as SkuService;
  return { service: new ListingResolverService(repository, skuService), findResolveCandidates };
}

describe('ListingResolverService (task §51-§54: order-safety boundary)', () => {
  it('returns the single match within the store scope', async () => {
    const { service, findResolveCandidates } = buildService([makeMapping('m1', 'sku-1', 'ABC')]);
    const result = await service.resolveInternalSku({ storeId: 'store-A', offerId: 'ABC' });
    expect(result.internalSkuId).toBe('sku-1');
    expect(result.matchedOfferId).toBe('ABC');
    // Store scoping is structural: the repository always receives storeId.
    expect(findResolveCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-A', offerId: 'ABC' }),
    );
  });

  it('fails with LISTING_SKU_RESOLVE_FAILED when nothing matches', async () => {
    const { service } = buildService([]);
    await expect(
      service.resolveInternalSku({ storeId: 'store-A', offerId: 'NOPE' }),
    ).rejects.toMatchObject({ code: 'LISTING_SKU_RESOLVE_FAILED' });
  });

  it('fails when no identifier is provided at all', async () => {
    const { service } = buildService([makeMapping('m1', 'sku-1', 'ABC')]);
    await expect(service.resolveInternalSku({ storeId: 'store-A' })).rejects.toMatchObject({
      code: 'LISTING_SKU_RESOLVE_FAILED',
    });
  });

  it('returns LISTING_SKU_RESOLVE_AMBIGUOUS on multiple candidates - never the first row', async () => {
    const { service } = buildService([
      makeMapping('m1', 'sku-1', 'ABC'),
      makeMapping('m2', 'sku-2', 'ABC'),
    ]);
    const error = await service
      .resolveInternalSku({ storeId: 'store-A', offerId: 'ABC' })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ListingSkuResolveAmbiguousError);
    expect((error as ListingSkuResolveAmbiguousError).details['candidateIds']).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('treats blank identifiers as absent', async () => {
    const { service } = buildService([makeMapping('m1', 'sku-1', 'ABC')]);
    const result = await service.resolveInternalSku({
      storeId: 'store-A',
      offerId: '  ',
      sellerSku: 'S1',
    });
    expect(result.matchedSellerSku).toBeNull();
  });

  it('propagates failure when the mapped internal SKU vanished', async () => {
    const { service } = buildService([makeMapping('m1', 'gone', 'ABC')]);
    await expect(
      service.resolveInternalSku({ storeId: 'store-A', offerId: 'ABC' }),
    ).rejects.toBeInstanceOf(ListingSkuResolveFailedError);
  });
});
