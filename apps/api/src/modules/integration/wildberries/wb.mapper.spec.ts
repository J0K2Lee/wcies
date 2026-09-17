import { describe, expect, it } from 'vitest';
import {
  mapCardToListing,
  mapFbsOrderToOrder,
  mapStatsRowToOrder,
  wbCancelledOf,
  wbStageOf,
  WbMappingError,
} from './wb.mapper';
import { WbCard, WbStatsOrderRow, WbV3Order } from './types/api.types';

/**
 * WB mapper unit tests: status-vocabulary mapping, identifier rules
 * (Decision 0016: barcodes -> platformSkuId, article -> sellerSku) and
 * malformed-shape rejection.
 */

describe('wbStageOf / wbCancelledOf (docs §3a vocabulary)', () => {
  it('maps the verified wbStatus values onto logistics stages', () => {
    expect(wbStageOf('waiting')).toBe('AWAITING_SHIPMENT');
    expect(wbStageOf('sorted')).toBe('AWAITING_SHIPMENT');
    expect(wbStageOf('accepted_by_carrier')).toBe('IN_TRANSIT');
    expect(wbStageOf('sent_to_carrier')).toBe('IN_TRANSIT');
    expect(wbStageOf('ready_for_pickup')).toBe('IN_TRANSIT');
    expect(wbStageOf('sold')).toBe('DELIVERED');
    expect(wbStageOf('canceled')).toBe('CANCELLED');
    expect(wbStageOf('canceled_by_client')).toBe('CANCELLED');
    expect(wbStageOf('defect')).toBe('CANCELLED');
  });

  it('leaves ambiguous / unknown values unclassified instead of guessing', () => {
    expect(wbStageOf('postponed_delivery')).toBeNull();
    expect(wbStageOf('some_future_status')).toBeNull();
    expect(wbStageOf(null)).toBeNull();
  });

  it('derives cancellation from supplierStatus or the wbStatus cancel family', () => {
    expect(wbCancelledOf({ supplierStatus: 'cancel' })).toBe(true);
    expect(wbCancelledOf({ supplierStatus: 'new', wbStatus: 'canceled_by_client' })).toBe(true);
    expect(wbCancelledOf({ supplierStatus: 'new', wbStatus: 'sold' })).toBe(false);
    expect(wbCancelledOf({})).toBe(false);
  });
});

describe('mapCardToListing', () => {
  it('emits one resolvable SKU row per size barcode', () => {
    const card: WbCard = {
      nmID: 123456,
      vendorCode: 'SKU-A',
      title: 'Тестовая карточка',
      sizes: [
        { chrtID: 11, techSize: 'S', skus: [20301, 20302] },
        { chrtID: 12, techSize: 'M', skus: [20303] },
      ],
    };
    const listing = mapCardToListing(card);
    expect(listing.platformProductId).toBe('123456');
    expect(listing.platformStatus).toBe('LISTED');
    expect(listing.skus.map((sku) => sku.platformSkuId)).toEqual(['20301', '20302', '20303']);
    expect(listing.skus.every((sku) => sku.sellerSku === 'SKU-A' && sku.offerId === 'SKU-A')).toBe(
      true,
    );
  });

  it('keeps barcode-less sizes visible with a null platformSkuId', () => {
    const card: WbCard = { nmID: 1, vendorCode: 'SKU-B', sizes: [{ chrtID: 1, techSize: '0' }] };
    const listing = mapCardToListing(card);
    expect(listing.skus).toHaveLength(1);
    expect(listing.skus[0]?.platformSkuId).toBeNull();
    expect(listing.skus[0]?.sellerSku).toBe('SKU-B');
  });

  it('rejects a card without nmID', () => {
    expect(() => mapCardToListing({ vendorCode: 'X' } as WbCard)).toThrow(WbMappingError);
  });
});

describe('mapFbsOrderToOrder (marketplace v3)', () => {
  const base: WbV3Order = {
    id: 987654,
    article: 'SKU-A',
    skus: [20301],
    nmId: 123456,
    finalPrice: 1500.5,
    currencyCode: 'RUB',
    createdAt: '2026-09-10T08:00:00+03:00',
    supplierStatus: 'new',
    wbStatus: 'waiting',
  };

  it('maps identity, resolution keys and the single-unit line', () => {
    const order = mapFbsOrderToOrder(base);
    expect(order.platformOrderId).toBe('987654');
    expect(order.platformStatus).toBe('waiting');
    expect(order.platformStage).toBe('AWAITING_SHIPMENT');
    expect(order.platformCancelled).toBe(false);
    expect(order.fulfillmentMode).toBe('FBS');
    expect(order.currency).toBe('RUB');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      platformSkuId: '20301',
      offerId: 'SKU-A',
      sellerSku: 'SKU-A',
      quantity: '1',
      unitPrice: '1500.50',
    });
  });

  it('falls back to supplierStatus for stage/status when wbStatus is absent', () => {
    const order = mapFbsOrderToOrder({ ...base, wbStatus: undefined, supplierStatus: 'confirm' });
    expect(order.platformStatus).toBe('confirm');
    expect(order.platformStage).toBe('AWAITING_SHIPMENT');
  });

  it('treats supplierStatus cancel as a platform cancellation', () => {
    const order = mapFbsOrderToOrder({ ...base, supplierStatus: 'cancel' });
    expect(order.platformCancelled).toBe(true);
    expect(order.platformStage).toBe('CANCELLED');
  });

  it('rejects rows without the business key or seller article', () => {
    expect(() => mapFbsOrderToOrder({ ...base, id: undefined } as unknown as WbV3Order)).toThrow(
      WbMappingError,
    );
    expect(() => mapFbsOrderToOrder({ ...base, article: '' })).toThrow(WbMappingError);
    expect(() => mapFbsOrderToOrder({ ...base, createdAt: 'nope' })).toThrow(WbMappingError);
  });
});

describe('mapStatsRowToOrder (statistics DBW rows)', () => {
  const row: WbStatsOrderRow = {
    date: '2026-09-10T10:00:00+03:00',
    lastChangeDate: '2026-09-11T09:30:00+03:00',
    supplierArticle: 'SKU-A',
    nmId: 123456,
    barcode: '20301',
    priceWithDisc: 1200,
    finishedPrice: 1200,
    isCancel: false,
    srid: 'srid-abc-1',
  };

  it('keys the order on srid with FBW fulfillment', () => {
    const order = mapStatsRowToOrder(row);
    expect(order.platformOrderId).toBe('srid-abc-1');
    expect(order.fulfillmentMode).toBe('FBW');
    expect(order.platformCancelled).toBe(false);
    expect(order.platformStage).toBeNull(); // weak fact: no logistics machine
    expect(order.items[0]).toMatchObject({
      platformSkuId: '20301',
      sellerSku: 'SKU-A',
      quantity: '1',
      unitPrice: '1200.00',
    });
  });

  it('maps isCancel to the cancelled stage', () => {
    const order = mapStatsRowToOrder({ ...row, isCancel: true });
    expect(order.platformCancelled).toBe(true);
    expect(order.platformStage).toBe('CANCELLED');
    expect(order.platformStatus).toBe('canceled');
  });

  it('rejects rows without srid', () => {
    expect(() => mapStatsRowToOrder({ ...row, srid: undefined })).toThrow(WbMappingError);
  });
});
