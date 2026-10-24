import { describe, expect, it } from 'vitest';
import {
  extractWbCardImageUrl,
  isWbTestWebhookEvent,
  isWbWebhookSecretValid,
  mapCardToListing,
  mapFbsOrderToOrder,
  mapStatsRowToOrder,
  fulfillmentModeOfStatsRow,
  statsRowIngestPolicy,
  mapWebhookEnvelope,
  wbCancelledOf,
  wbStageOf,
  webhookEnvelopeSellerId,
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

  it('normalizes card dimensions into product_attributes on every size row (mm/kg)', () => {
    const card: WbCard = {
      nmID: 123456,
      vendorCode: 'SKU-A',
      dimensions: { length: 300, width: 200, height: 100, weightBrutto: 0.65 },
      sizes: [
        { chrtID: 11, techSize: 'S', skus: ['20301'] },
        { chrtID: 12, techSize: 'M', skus: ['20302'] },
      ],
    };
    const listing = mapCardToListing(card);
    expect(listing.skus).toHaveLength(2);
    for (const sku of listing.skus) {
      expect(sku.rawData['product_attributes']).toEqual({
        dimension_unit: 'mm',
        depth: 300,
        width: 200,
        height: 100,
        weight_unit: 'kg',
        weight: 0.65,
      });
    }
  });

  it('omits product_attributes when the card has no dimensions', () => {
    const card: WbCard = { nmID: 1, vendorCode: 'SKU-B', sizes: [{ chrtID: 1, skus: ['20301'] }] };
    const listing = mapCardToListing(card);
    expect(listing.skus[0]?.rawData['product_attributes']).toBeUndefined();
  });

  it('drops partial dimensions but keeps weight (all-or-none volume)', () => {
    const card: WbCard = {
      nmID: 2,
      vendorCode: 'SKU-C',
      dimensions: { width: 200, weightBrutto: 0.65 },
      sizes: [{ chrtID: 1, skus: ['20301'] }],
    };
    const listing = mapCardToListing(card);
    expect(listing.skus[0]?.rawData['product_attributes']).toEqual({
      weight_unit: 'kg',
      weight: 0.65,
    });
  });
});

describe('extractWbCardImageUrl (2026-10-22 订单行补图)', () => {
  it('prefers the c516x688 rendition of the first photo', () => {
    expect(
      extractWbCardImageUrl({
        photos: [
          {
            hq: 'https://cdn/1/hq.webp',
            big: 'https://cdn/1/big.webp',
            c516x688: 'https://cdn/1/c516x688.webp',
          },
        ],
      }),
    ).toBe('https://cdn/1/c516x688.webp');
  });

  it('falls back through the smaller renditions', () => {
    expect(extractWbCardImageUrl({ photos: [{ tm: 'https://cdn/1/tm.webp' }] })).toBe(
      'https://cdn/1/tm.webp',
    );
  });

  it('accepts a plain string entry', () => {
    expect(extractWbCardImageUrl({ photos: ['https://cdn/1/flat.webp'] })).toBe(
      'https://cdn/1/flat.webp',
    );
  });

  it('returns null when the card carries no usable photo (never guesses a CDN path)', () => {
    expect(extractWbCardImageUrl(null)).toBeNull();
    expect(extractWbCardImageUrl({})).toBeNull();
    expect(extractWbCardImageUrl({ photos: [] })).toBeNull();
    expect(extractWbCardImageUrl({ photos: [{ other: 1 }] })).toBeNull();
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

  it('v3 实际字段：price 以分计价、currencyCode 是 ISO 数字码（2026-10-24）', () => {
    const order = mapFbsOrderToOrder({
      ...base,
      finalPrice: undefined,
      salePrice: undefined,
      price: 587900,
      // 实测报文里 currencyCode 是数字
      currencyCode: 643,
    });
    expect(order.items[0]?.unitPrice).toBe('5879.00');
    expect(order.currency).toBe('RUB');
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

  it('keys the order on srid；平台仓按 FBW 且允许建单', () => {
    const order = mapStatsRowToOrder({ ...row, warehouseType: 'Склад WB' });
    expect(order.platformOrderId).toBe('srid-abc-1');
    expect(order.fulfillmentMode).toBe('FBW');
    // FBO 没有装配任务，报表是唯一来源 → 允许建单
    expect(order.ingestPolicy).toBe('CREATE_OR_UPDATE');
    expect(order.platformCancelled).toBe(false);
    expect(order.platformStage).toBeNull(); // weak fact: no logistics machine
    expect(order.items[0]).toMatchObject({
      platformSkuId: '20301',
      sellerSku: 'SKU-A',
      quantity: '1',
      unitPrice: '1200.00',
    });
  });

  /**
   * 2026-10-23 用户 bug：统计流水包含全部订单，卖家仓的 FBS 单被当成 FBW，
   * 于是同一张单出现「数字 id / FBS」与「srid / FBW」两条记录。
   */
  it('用卖家仓判定 FBS，并给出 rid 去重键', () => {
    const order = mapStatsRowToOrder({
      ...row,
      srid: 'eBH.i5bb6dba9b335bbce96ac43acba0842fc.0.0',
      warehouseType: 'Склад продавца',
    });
    expect(order.fulfillmentMode).toBe('FBS');
    // 卖家仓的作业事实源是 v3 装配任务：报表行只更新已有订单，绝不建单
    // （2026-10-24，实证会建出只有订单 UID 的幽灵单）。
    expect(order.ingestPolicy).toBe('UPDATE_ONLY');
    // srid 等于 FBS 任务流的 rid：同步时用它反查已有订单。
    expect(order.dedupeByRawField).toEqual({
      field: 'rid',
      value: 'eBH.i5bb6dba9b335bbce96ac43acba0842fc.0.0',
    });
  });

  it('仓库类型：平台仓→FBW，卖家仓→FBS，未知不猜', () => {
    expect(fulfillmentModeOfStatsRow({ ...row, warehouseType: 'Склад WB' })).toBe('FBW');
    expect(fulfillmentModeOfStatsRow({ ...row, warehouseType: 'Склад продавца' })).toBe('FBS');
    // 未知值不覆盖已有订单的履约方式（AGENTS §88）
    expect(fulfillmentModeOfStatsRow({ ...row })).toBeNull();
    expect(statsRowIngestPolicy({ ...row })).toBe('UPDATE_ONLY');
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

// ---------------------------------------------------------------------------
// Webhooks (docs verified 2026-09-18)
// ---------------------------------------------------------------------------

const DELIVERY = {
  sellerId: 'fb25c9e9-cae8-52db-b68e-736c1466a3f5',
  requestId: '839db129-458c-4604-8019-41f32571474e',
  events: [
    {
      id: '01951e00-d818-74bf-b0c0-b41479c0826e',
      time: '2025-02-21T00:35:26.389710263Z',
      test: false,
      type: 'card_changed',
      scope: 'content',
      idempotencyKey: '2f8c7ffd86ecebc828335d2ab4d643b9abc',
      payload: { nmID: 419929116, vendorCode: 'pro-59221854' },
    },
    {
      id: '01951e00-9999-74bf-b0c0-b41479c0826e',
      time: '2025-02-21T00:35:27Z',
      test: false,
      type: 'feedback_updated',
      scope: 'questionsandfeedback',
      idempotencyKey: 'aa74c0e-2',
    },
  ],
};

describe('mapWebhookEnvelope', () => {
  it('maps every envelope event to its own normalized event', () => {
    const events = mapWebhookEnvelope(DELIVERY);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: 'ITEM_CHANGED',
      externalEventId: '2f8c7ffd86ecebc828335d2ab4d643b9abc',
      platformOrderIds: [],
    });
    // payload keeps the INDIVIDUAL event object (per-event raw-event rows)
    expect(events[0]?.payload).toMatchObject({
      type: 'card_changed',
      payload: { nmID: 419929116 },
    });
    // unmapped catalog types record as UNKNOWN - never guessed
    expect(events[1]?.eventType).toBe('UNKNOWN');
  });

  it('prefers idempotencyKey, then id, then null (payload-hash dedup)', () => {
    const events = mapWebhookEnvelope({
      events: [
        { type: 'card_changed', idempotencyKey: 'k1', id: 'e1' },
        { type: 'card_changed', id: 'e2' },
        { type: 'card_changed' },
      ],
    });
    expect(events.map((event) => event.externalEventId)).toEqual(['k1', 'e2', null]);
  });

  it('classifies only card_changed; the rest of the catalog records as UNKNOWN', () => {
    const events = mapWebhookEnvelope({
      events: [
        { type: 'card_changed' },
        { type: 'card_creation_error' },
        { type: 'feedback_updated' },
        { type: 'report_generation_complete' },
        { type: 'some_future_type' },
      ],
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'ITEM_CHANGED',
      'UNKNOWN',
      'UNKNOWN',
      'UNKNOWN',
      'UNKNOWN',
    ]);
  });

  it('flags test events via the payload test field', () => {
    const events = mapWebhookEnvelope({
      events: [{ type: 'card_changed', test: true, idempotencyKey: 't1' }],
    });
    expect(isWbTestWebhookEvent(events[0]!)).toBe(true);
    expect(events[0]?.externalEventId).toBe('t1');
  });

  it('rejects non-envelope payloads', () => {
    expect(() => mapWebhookEnvelope('nope')).toThrow(WbMappingError);
    expect(() => mapWebhookEnvelope({ requestId: 'x' })).toThrow(WbMappingError);
    expect(() => mapWebhookEnvelope({ events: [{ noType: true }] })).toThrow(WbMappingError);
  });

  it('exposes the envelope seller id for audit context', () => {
    expect(webhookEnvelopeSellerId(DELIVERY)).toBe('fb25c9e9-cae8-52db-b68e-736c1466a3f5');
    expect(webhookEnvelopeSellerId(null)).toBeNull();
  });
});

describe('isWbWebhookSecretValid (Authorization header vs stored secret)', () => {
  const SECRET = 'whsec-6f1d2c9e0a';

  it('accepts only the exact secret', () => {
    expect(isWbWebhookSecretValid(SECRET, SECRET)).toBe(true);
    expect(isWbWebhookSecretValid('whsec-6f1d2c9e0b', SECRET)).toBe(false);
    expect(isWbWebhookSecretValid(`${SECRET}x`, SECRET)).toBe(false);
  });

  it('rejects missing material on either side', () => {
    expect(isWbWebhookSecretValid(null, SECRET)).toBe(false);
    expect(isWbWebhookSecretValid(undefined, SECRET)).toBe(false);
    expect(isWbWebhookSecretValid('', SECRET)).toBe(false);
    expect(isWbWebhookSecretValid(SECRET, null)).toBe(false);
    expect(isWbWebhookSecretValid(SECRET, '')).toBe(false);
  });
});
