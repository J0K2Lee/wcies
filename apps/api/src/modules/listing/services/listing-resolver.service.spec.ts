import { describe, expect, it, vi } from 'vitest';
import { ListingResolverService } from './listing-resolver.service';
import {
  ListingSkuResolveAmbiguousError,
  ListingSkuResolveFailedError,
} from '../errors/listing-errors';
import { ListingRepository, ResolveCandidate } from '../repositories/listing.repository';
import { SkuService } from '../../product/services/sku.service';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

function makeMapping(
  id: string,
  skuId: string,
  platformSkuId: string | null,
  sellerSku: string | null = null,
  offerId: string | null = null,
): PlatformListingSkuEntity {
  return {
    id,
    listingId: 'listing-1',
    skuId,
    platformSkuId,
    sellerSku,
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
    const { service, findResolveCandidates } = buildService([
      makeMapping('m1', 'sku-1', 'PS1', null, 'ABC'),
    ]);
    const result = await service.resolveInternalSku({ storeId: 'store-A', platformSkuId: 'PS1' });
    expect(result.internalSkuId).toBe('sku-1');
    expect(result.matchedPlatformSkuId).toBe('PS1');
    // Store scoping is structural: the repository always receives storeId.
    expect(findResolveCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-A', platformSkuId: 'PS1' }),
    );
  });

  it('resolves by seller SKU (the second and last resolution identifier)', async () => {
    const { service } = buildService([makeMapping('m1', 'sku-1', null, 'SELL-1')]);
    const result = await service.resolveInternalSku({ storeId: 'store-A', sellerSku: 'SELL-1' });
    expect(result.matchedSellerSku).toBe('SELL-1');
  });

  // Decision 0016: the platform lets operators edit offer_id, so it is not a
  // resolution identifier any more. A query carrying only an offer must fail
  // exactly like an empty query - never resolve against a stale identifier.
  it('never resolves by offer id', async () => {
    const { service, findResolveCandidates } = buildService([
      makeMapping('m1', 'sku-1', null, null, 'OFF-ONLY'),
    ]);
    // Passed as a variable - exactly how a legacy caller still calls it.
    const offerOnlyQuery = { storeId: 'store-A', offerId: 'OFF-ONLY' };
    await expect(service.resolveInternalSku(offerOnlyQuery)).rejects.toMatchObject({
      code: 'LISTING_SKU_RESOLVE_FAILED',
      details: { reason: 'NO_IDENTIFIER_PROVIDED' },
    });
    // The identifier was not even forwarded to the store-scoped query.
    expect(findResolveCandidates).not.toHaveBeenCalled();
  });

  it('keeps matchedOfferId on the response, always null (client compatibility)', async () => {
    const { service } = buildService([makeMapping('m1', 'sku-1', 'PS1', null, 'ABC')]);
    const result = await service.resolveInternalSku({ storeId: 'store-A', platformSkuId: 'PS1' });
    expect(result.matchedPlatformSkuId).toBe('PS1');
    expect(result.matchedOfferId).toBeNull();
  });

  it('fails with LISTING_SKU_RESOLVE_FAILED when nothing matches', async () => {
    const { service } = buildService([]);
    await expect(
      service.resolveInternalSku({ storeId: 'store-A', platformSkuId: 'NOPE' }),
    ).rejects.toMatchObject({ code: 'LISTING_SKU_RESOLVE_FAILED' });
  });

  it('fails when no identifier is provided at all', async () => {
    const { service } = buildService([makeMapping('m1', 'sku-1', 'PS1')]);
    await expect(service.resolveInternalSku({ storeId: 'store-A' })).rejects.toMatchObject({
      code: 'LISTING_SKU_RESOLVE_FAILED',
    });
  });

  it('returns LISTING_SKU_RESOLVE_AMBIGUOUS on multiple candidates - never the first row', async () => {
    const { service } = buildService([
      makeMapping('m1', 'sku-1', 'PS1'),
      makeMapping('m2', 'sku-2', 'PS1'),
    ]);
    const error = await service
      .resolveInternalSku({ storeId: 'store-A', platformSkuId: 'PS1' })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ListingSkuResolveAmbiguousError);
    expect((error as ListingSkuResolveAmbiguousError).details['candidateIds']).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('treats blank identifiers as absent and trims the rest', async () => {
    const { service, findResolveCandidates } = buildService([
      makeMapping('m1', 'sku-1', null, 'S1'),
    ]);
    await service.resolveInternalSku({
      storeId: 'store-A',
      platformSkuId: '  ',
      sellerSku: ' S1 ',
    });
    expect(findResolveCandidates).toHaveBeenCalledWith({
      storeId: 'store-A',
      platformSkuId: undefined,
      sellerSku: 'S1',
    });
  });

  it('propagates failure when the mapped internal SKU vanished', async () => {
    const { service } = buildService([makeMapping('m1', 'gone', 'PS1')]);
    await expect(
      service.resolveInternalSku({ storeId: 'store-A', platformSkuId: 'PS1' }),
    ).rejects.toBeInstanceOf(ListingSkuResolveFailedError);
  });
});
