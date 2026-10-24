import { describe, expect, it } from 'vitest';
import {
  extractYandexOfferImageUrl,
  mapOfferMappingToListing,
  mapOrderToOrder,
  mapReturnToReturn,
  mapWebhookPayload,
  pickShowcaseUrl,
  yxFulfillmentModeOf,
  yxStageOf,
  YandexMappingError,
} from './yandex.mapper';
import { YxOrder, YxOfferMapping, YxReturnItem } from './types/api.types';

/**
 * Yandex mapper unit tests: status/substatus vocabulary, programType
 * fulfillment facts, identifier rules (offerId feeds sellerSku - Decision
 * 0016) and webhook notification classification.
 */

describe('yxStageOf (docs §3 vocabulary)', () => {
  it('maps the verified status set onto logistics stages', () => {
    expect(yxStageOf('PLACING', null)).toBe('AWAITING_SHIPMENT');
    expect(yxStageOf('RESERVED', null)).toBe('AWAITING_SHIPMENT');
    expect(yxStageOf('UNPAID', null)).toBe('AWAITING_SHIPMENT');
    expect(yxStageOf('PROCESSING', 'READY_TO_SHIP')).toBe('AWAITING_SHIPMENT');
    expect(yxStageOf('PROCESSING', 'SHIPPED')).toBe('IN_TRANSIT');
    expect(yxStageOf('DELIVERY', null)).toBe('IN_TRANSIT');
    expect(yxStageOf('PICKUP', null)).toBe('IN_TRANSIT');
    expect(yxStageOf('DELIVERED', null)).toBe('DELIVERED');
    expect(yxStageOf('RETURNED', null)).toBe('DELIVERED');
    expect(yxStageOf('CANCELLED', 'USER_NOT_PAID')).toBe('CANCELLED');
  });

  it('leaves ambiguous statuses unclassified instead of guessing', () => {
    expect(yxStageOf('PENDING', null)).toBeNull();
    expect(yxStageOf('UNKNOWN', null)).toBeNull();
    expect(yxStageOf(null, null)).toBeNull();
  });
});

describe('yxFulfillmentModeOf (programType fact)', () => {
  it('maps FBY to external fulfillment and FBS/DBS to seller fulfillment', () => {
    expect(yxFulfillmentModeOf('FBY')).toBe('FBY');
    expect(yxFulfillmentModeOf('FBS')).toBe('FBS');
    expect(yxFulfillmentModeOf('DBS')).toBe('FBS');
  });

  it('refuses to guess unverified programs', () => {
    expect(yxFulfillmentModeOf('EXPRESS')).toBeNull();
    expect(yxFulfillmentModeOf('LAAS')).toBeNull();
    expect(yxFulfillmentModeOf(undefined)).toBeNull();
  });
});

describe('mapOrderToOrder', () => {
  const base: YxOrder = {
    orderId: 5510001,
    campaignId: 1001,
    programType: 'FBS',
    status: 'PROCESSING',
    substatus: 'READY_TO_SHIP',
    creationDate: '2026-09-16T09:30:00Z',
    updateDate: '2026-09-16T10:00:00Z',
    items: [
      { offerId: 'SKU-A', count: 2 },
      { offerId: 'SKU-B', count: 1 },
    ],
    delivery: { type: 'DELIVERY', shipment: { shipmentDate: '2026-09-18T18:00:00Z' } },
  };

  it('maps identity, fulfillment fact and sellerSku-based lines', () => {
    const order = mapOrderToOrder(base);
    expect(order.platformOrderId).toBe('5510001');
    expect(order.platformStatus).toBe('PROCESSING');
    expect(order.platformStage).toBe('AWAITING_SHIPMENT');
    expect(order.platformCancelled).toBe(false);
    expect(order.fulfillmentMode).toBe('FBS');
    expect(order.shipmentDeadline?.toISOString()).toBe('2026-09-18T18:00:00.000Z');
    expect(order.items).toHaveLength(2);
    expect(order.items[0]).toMatchObject({
      platformSkuId: null,
      offerId: 'SKU-A',
      sellerSku: 'SKU-A',
      quantity: '2',
      unitPrice: null,
    });
    // 没有 prices 时币种也保持 null（不猜）
    expect(order.currency).toBeNull();
  });

  it('单价 = payment + cashback（官方口径），subsidy 是卖家奖励不计入', () => {
    const order = mapOrderToOrder({
      ...base,
      prices: {
        payment: { value: 711, currencyId: 'RUR' },
        subsidy: { value: 2928, currencyId: 'RUR' },
        cashback: { value: 5661, currencyId: 'RUR' },
      },
      items: [
        {
          offerId: 'SKU-A',
          count: 1,
          prices: {
            payment: { value: 711, currencyId: 'RUR' },
            subsidy: { value: 2928, currencyId: 'RUR' },
            cashback: { value: 5661, currencyId: 'RUR' },
          },
        },
      ],
    });
    // 711 + 5661 = 6372（RUB）；subsidy 2928 不参与
    expect(order.items[0]?.unitPrice).toBe('6372.00');
    // Yandex 用历史码 RUR，统一成 ISO 字母码
    expect(order.currency).toBe('RUB');
  });

  it('没有 cashback 时单价就是 payment；订单级 prices 也可提供币种', () => {
    const order = mapOrderToOrder({
      ...base,
      prices: { payment: { value: 2723, currencyId: 'RUR' } },
      items: [
        { offerId: 'SKU-A', count: 1, prices: { payment: { value: 2723, currencyId: 'RUR' } } },
      ],
    });
    expect(order.items[0]?.unitPrice).toBe('2723.00');
    expect(order.currency).toBe('RUB');
  });

  it('treats CANCELLED as platform cancellation', () => {
    const order = mapOrderToOrder({ ...base, status: 'CANCELLED', substatus: 'USER_NOT_PAID' });
    expect(order.platformCancelled).toBe(true);
    expect(order.platformStage).toBe('CANCELLED');
  });

  it('rejects orders without the business key / status / items', () => {
    expect(() => mapOrderToOrder({ ...base, orderId: undefined })).toThrow(YandexMappingError);
    expect(() => mapOrderToOrder({ ...base, status: undefined })).toThrow(YandexMappingError);
    expect(() => mapOrderToOrder({ ...base, items: [] })).toThrow(YandexMappingError);
    expect(() =>
      mapOrderToOrder({
        ...base,
        items: [{ count: 1 }],
      }),
    ).toThrow(YandexMappingError);
  });
});

describe('mapOrderToOrder tracking (2026-10-22 运单号回填)', () => {
  const base = {
    orderId: 12345,
    status: 'DELIVERY',
    creationDate: '2026-10-01T10:00:00Z',
    items: [{ offerId: 'SKU-A', count: 1 }],
  };

  it('reads delivery.tracks[].trackCode as the platform waybill', () => {
    const mapped = mapOrderToOrder({
      ...base,
      delivery: { tracks: [{ trackCode: 'YX-TRACK-1' }, { trackCode: 'YX-TRACK-2' }] },
    });
    expect(mapped.platformTrackingNo).toBe('YX-TRACK-1');
  });

  it('falls back to the cargo-place barcode for FBS (面单上的「номер грузоместа」)', () => {
    // 真实面单（2026-10-23）：номер заказа 63259683777 / номер грузоместа 63259683777-1
    const mapped = mapOrderToOrder({
      ...base,
      orderId: 63259683777,
      delivery: { boxesLayout: [{ boxId: 1, barcode: '63259683777-1' }] },
    });
    expect(mapped.platformTrackingNo).toBe('63259683777-1');
  });

  it('prefers the DBS track code over the box barcode', () => {
    const mapped = mapOrderToOrder({
      ...base,
      delivery: {
        tracks: [{ trackCode: 'DBS-TRACK-9' }],
        boxesLayout: [{ boxId: 1, barcode: '1-1' }],
      },
    });
    expect(mapped.platformTrackingNo).toBe('DBS-TRACK-9');
  });

  it('stays null when neither tracks nor a usable box barcode exist', () => {
    expect(mapOrderToOrder({ ...base }).platformTrackingNo).toBeNull();
    expect(
      mapOrderToOrder({ ...base, delivery: { tracks: [{ trackCode: '   ' }] } }).platformTrackingNo,
    ).toBeNull();
    expect(
      mapOrderToOrder({ ...base, delivery: { boxesLayout: [{ boxId: 1, barcode: '  ' }] } })
        .platformTrackingNo,
    ).toBeNull();
  });
});

describe('mapOfferMappingToListing', () => {
  it('uses marketSku as platform identity and campaign publish state', () => {
    const entry: YxOfferMapping = {
      offer: {
        offerId: 'SKU-A',
        name: 'Тестовый товар',
        campaigns: [{ campaignId: 1001, status: 'PUBLISHED' }],
      },
      mapping: { marketSku: 987654, marketCategoryName: 'Test' },
    };
    const listing = mapOfferMappingToListing(entry, '1001');
    expect(listing.platformProductId).toBe('987654');
    expect(listing.platformStatus).toBe('PUBLISHED');
    expect(listing.skus[0]).toMatchObject({
      platformSkuId: '987654',
      offerId: 'SKU-A',
      sellerSku: 'SKU-A',
    });
  });

  it('keeps the platform showcase URL as listing.url (2026-10-22 商品链接修复)', () => {
    const withB2c = mapOfferMappingToListing(
      {
        offer: { offerId: 'SKU-A', name: 'Товар' },
        mapping: { marketSku: 6087881269 },
        showcaseUrls: [
          { showcaseType: 'B2B', showcaseUrl: 'https://market.yandex.ru/card/x/1' },
          {
            showcaseType: 'B2C',
            showcaseUrl: 'https://market.yandex.ru/card/slug/5817028070?businessId=193261685',
          },
        ],
      },
      '1001',
    );
    expect(withB2c.url).toBe('https://market.yandex.ru/card/slug/5817028070?businessId=193261685');

    const withoutShowcase = mapOfferMappingToListing(
      { offer: { offerId: 'SKU-A' }, mapping: { marketSku: 6087881269 } },
      '1001',
    );
    // 绝不拿 marketSku 拼卡片地址：拼出来的链接对部分卡片会 404。
    expect(withoutShowcase.url).toBeNull();
  });

  it('falls back to offerId identity for unmapped offers', () => {
    const entry: YxOfferMapping = { offer: { offerId: 'SKU-RAW' } };
    const listing = mapOfferMappingToListing(entry, '1001');
    expect(listing.platformProductId).toBe('SKU-RAW');
    expect(listing.skus[0]?.platformSkuId).toBeNull();
    expect(listing.skus[0]?.sellerSku).toBe('SKU-RAW');
  });

  it('rejects entries without an offerId', () => {
    expect(() => mapOfferMappingToListing({ offer: {} }, '1001')).toThrow(YandexMappingError);
  });

  it('normalizes weightDimensions into product_attributes (cm/kg, depth = length)', () => {
    const entry: YxOfferMapping = {
      offer: {
        offerId: 'SKU-A',
        weightDimensions: { length: 65.55, width: 50.7, height: 20, weight: 1.001 },
      },
      mapping: { marketSku: 987654 },
    };
    const listing = mapOfferMappingToListing(entry, '1001');
    expect(listing.skus[0]?.rawData['product_attributes']).toEqual({
      dimension_unit: 'cm',
      depth: 65.55,
      width: 50.7,
      height: 20,
      weight_unit: 'kg',
      weight: 1.001,
    });
  });

  it('omits product_attributes when weightDimensions is absent', () => {
    const entry: YxOfferMapping = {
      offer: { offerId: 'SKU-A' },
      mapping: { marketSku: 987654 },
    };
    const listing = mapOfferMappingToListing(entry, '1001');
    expect(listing.skus[0]?.rawData).toEqual({ marketSku: 987654 });
  });

  it('drops partial dimensions but keeps weight (all-or-none volume)', () => {
    const entry: YxOfferMapping = {
      offer: { offerId: 'SKU-A', weightDimensions: { width: 50, weight: 0.15 } },
    };
    const listing = mapOfferMappingToListing(entry, '1001');
    expect(listing.skus[0]?.rawData['product_attributes']).toEqual({
      weight_unit: 'kg',
      weight: 0.15,
    });
  });

  it('treats non-positive dimension values as absent junk', () => {
    const entry: YxOfferMapping = {
      offer: {
        offerId: 'SKU-A',
        weightDimensions: { length: 10, width: 0, height: 5, weight: -1 },
      },
    };
    const listing = mapOfferMappingToListing(entry, '1001');
    expect(listing.skus[0]?.rawData['product_attributes']).toBeUndefined();
  });
});

describe('pickShowcaseUrl', () => {
  it('prefers the B2C showcase', () => {
    expect(
      pickShowcaseUrl([
        { showcaseType: 'B2B', showcaseUrl: 'https://b2b' },
        { showcaseType: 'B2C', showcaseUrl: 'https://b2c' },
      ]),
    ).toBe('https://b2c');
  });

  it('falls back to the first usable entry, ignoring blanks', () => {
    expect(
      pickShowcaseUrl([
        { showcaseType: 'B2C', showcaseUrl: '   ' },
        { showcaseType: 'B2B', showcaseUrl: 'https://b2b' },
      ]),
    ).toBe('https://b2b');
  });

  it('returns null when nothing usable is present', () => {
    expect(pickShowcaseUrl(undefined)).toBeNull();
    expect(pickShowcaseUrl([])).toBeNull();
    expect(pickShowcaseUrl([{ showcaseType: 'B2C' }])).toBeNull();
  });
});

describe('mapReturnToReturn', () => {
  it('maps the return facts with tolerant degradation', () => {
    const item: YxReturnItem = {
      id: 90001,
      orderId: 5510001,
      refundStatus: 'REFUNDED',
      shipmentStatus: 'READY_FOR_REFUND',
      createdAt: '2026-09-17T00:00:00Z',
      items: [{ marketSku: 987654, shopSku: 'SKU-A', count: 1 }],
    };
    const record = mapReturnToReturn(item);
    expect(record.platformReturnId).toBe('90001');
    expect(record.platformOrderId).toBe('5510001');
    expect(record.state).toBe('READY_FOR_REFUND');
    expect(record.refundState).toBe('REFUNDED');
    expect(record.platformSkuId).toBe('987654');
    expect(record.offerId).toBe('SKU-A');
  });

  it('rejects records without an id', () => {
    expect(() => mapReturnToReturn({ refundStatus: 'REFUNDED' })).toThrow(YandexMappingError);
  });
});

describe('mapWebhookPayload (docs §4 vocabulary)', () => {
  it('classifies order events with the orderId hint', () => {
    const events = mapWebhookPayload({
      notificationType: 'ORDER_STATUS_UPDATED',
      campaignId: 1001,
      orderId: 5510001,
      status: 'PROCESSING',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('POSTING_STATE_CHANGED');
    expect(events[0]?.platformOrderIds).toEqual(['5510001']);
  });

  it('maps creation / cancellation to their contract types', () => {
    expect(mapWebhookPayload({ notificationType: 'ORDER_CREATED', orderId: 1 })[0]?.eventType).toBe(
      'NEW_POSTING',
    );
    expect(
      mapWebhookPayload({ notificationType: 'ORDER_CANCELLED', orderId: 1 })[0]?.eventType,
    ).toBe('POSTING_CANCELLED');
  });

  it('records PING and return events without order actions', () => {
    expect(mapWebhookPayload({ notificationType: 'PING' })[0]?.eventType).toBe('PING');
    const returnEvent = mapWebhookPayload({
      notificationType: 'ORDER_RETURN_CREATED',
      campaignId: 1001,
      orderId: 5,
    })[0];
    expect(returnEvent?.eventType).toBe('UNKNOWN');
    expect(returnEvent?.platformOrderIds).toEqual([]);
  });

  it('rejects payloads without notificationType', () => {
    expect(() => mapWebhookPayload({ orderId: 1 })).toThrow(YandexMappingError);
    expect(() => mapWebhookPayload('nope')).toThrow(YandexMappingError);
  });
});

describe('extractYandexOfferImageUrl (ERP 建议#2, vendored spec verified)', () => {
  it('takes the FIRST pictures entry as the primary image', () => {
    expect(
      extractYandexOfferImageUrl({
        offer: { pictures: ['https://img.example/primary.jpg', 'https://img.example/extra.jpg'] },
        mapping: { marketSku: 123 },
      }),
    ).toBe('https://img.example/primary.jpg');
  });

  it('trims and skips blank entries', () => {
    expect(
      extractYandexOfferImageUrl({ offer: { pictures: ['  ', 'https://img.example/a.jpg'] } }),
    ).toBe('https://img.example/a.jpg');
  });

  it('returns null for missing/malformed payloads without throwing', () => {
    expect(extractYandexOfferImageUrl(null)).toBeNull();
    expect(extractYandexOfferImageUrl('nope')).toBeNull();
    expect(extractYandexOfferImageUrl({})).toBeNull();
    expect(extractYandexOfferImageUrl({ offer: {} })).toBeNull();
    expect(extractYandexOfferImageUrl({ offer: { pictures: null } })).toBeNull();
    expect(extractYandexOfferImageUrl({ offer: { pictures: [] } })).toBeNull();
    expect(extractYandexOfferImageUrl({ offer: { pictures: [42] } })).toBeNull();
  });
});
