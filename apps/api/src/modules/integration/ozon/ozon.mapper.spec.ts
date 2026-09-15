import { describe, expect, it } from 'vitest';
import {
  mapPostingToOrder,
  mapProductToListing,
  mapRfbsReturn,
  mapWebhookPayload,
  webhookSellerId,
  buildPushAck,
  OzonMappingError,
} from './ozon.mapper';
import {
  OzonFbsPosting,
  OzonPostingProduct,
  OzonProductInfoItem,
  OzonProductListItem,
  OzonRfbsReturn,
} from './types/api.types';

/**
 * OzonMapper unit tests (task §5/§50): OZON -> WCIES field mapping and
 * malformed-response rejection (never `as any` through bad data).
 */

const LIST_ITEM: OzonProductListItem = {
  product_id: 152987456,
  offer_id: 'VK87-BLK',
  archived: false,
};

const INFO: OzonProductInfoItem = {
  id: 152987456,
  name: 'VK87 MAX V2 механическая клавиатура',
  offer_id: 'VK87-BLK',
  sku: 987654321,
  is_archived: false,
};

describe('mapProductToListing', () => {
  it('maps product list + info into a listing with one platform SKU', () => {
    const listing = mapProductToListing(LIST_ITEM, INFO);
    expect(listing.platformProductId).toBe('152987456');
    expect(listing.title).toBe(INFO.name);
    expect(listing.skus).toHaveLength(1);
    expect(listing.skus[0]?.platformSkuId).toBe('987654321');
    expect(listing.skus[0]?.offerId).toBe('VK87-BLK');
    expect(listing.platformStatus).toBe('LISTED');
    // Raw data preservation (task §43): both sources survive verbatim.
    expect(listing.rawData['product_list_item']).toEqual(LIST_ITEM);
    expect(listing.rawData['product_info']).toEqual(INFO);
  });

  it('derives ARCHIVED status from archive flags', () => {
    expect(mapProductToListing(LIST_ITEM, { ...INFO, is_archived: true }).platformStatus).toBe(
      'ARCHIVED',
    );
    expect(mapProductToListing({ ...LIST_ITEM, archived: true }, undefined).platformStatus).toBe(
      'ARCHIVED',
    );
  });

  it('tolerates a missing info enrichment (name/sku become null)', () => {
    const listing = mapProductToListing(LIST_ITEM, undefined);
    expect(listing.title).toBeNull();
    expect(listing.skus[0]?.platformSkuId).toBeNull();
    expect(listing.platformStatus).toBe('LISTED');
  });

  // OZON returns sku: 0 for products with no SKU assigned yet. 25 such rows
  // were observed sharing the fake identifier "0", which would make a line
  // resolve ambiguously against all of them.
  it('treats a non-positive sku as absent instead of storing "0"', () => {
    const listing = mapProductToListing(LIST_ITEM, { ...INFO, sku: 0 });
    expect(listing.skus[0]?.platformSkuId).toBeNull();
    // The offer_id remains, so the row is still resolvable.
    expect(listing.skus[0]?.offerId).toBe(LIST_ITEM.offer_id);
  });

  it('rejects malformed items with PLATFORM_BAD_RESPONSE', () => {
    expect(() =>
      mapProductToListing({ offer_id: 'x' } as unknown as OzonProductListItem, INFO),
    ).toThrow(OzonMappingError);
    expect(() => mapProductToListing(LIST_ITEM, { ...INFO, id: 111 })).toThrow(
      /does not match product_id/,
    );
  });
});

const POSTING: OzonFbsPosting = {
  posting_number: '00077059-0001-1',
  order_id: 77059,
  order_number: '77059',
  status: 'awaiting_packaging',
  in_process_at: '2026-09-08T10:15:30.000Z',
  products: [
    {
      offer_id: 'VK87-BLK',
      sku: 987654321,
      quantity: 2,
      price: '4590.00',
      currency_code: 'RUB',
      name: 'VK87 MAX V2',
    },
  ],
};

describe('mapPostingToOrder', () => {
  it('maps a posting to NormalizedOrderInput-compatible fields', () => {
    const order = mapPostingToOrder(POSTING);
    expect(order.platformOrderId).toBe('00077059-0001-1');
    expect(order.platformStatus).toBe('awaiting_packaging');
    expect(order.fulfillmentMode).toBe('FBS');
    expect(order.orderedAt.toISOString()).toBe('2026-09-08T10:15:30.000Z');
    expect(order.currency).toBe('RUB');
    expect(order.items).toHaveLength(1);
    const item = order.items[0];
    expect(item?.platformSkuId).toBe('987654321');
    expect(item?.offerId).toBe('VK87-BLK');
    expect(item?.quantity).toBe('2');
    // Raw posting preserved verbatim (task §23).
    expect(order.rawData).toEqual(POSTING);
    expect(item?.rawData).toEqual(POSTING.products[0]);
  });

  it('rejects postings without posting_number / products / dates', () => {
    expect(() => mapPostingToOrder({ ...POSTING, posting_number: '' })).toThrow(OzonMappingError);
    expect(() => mapPostingToOrder({ ...POSTING, products: [] })).toThrow(/no products/);
    expect(() => mapPostingToOrder({ ...POSTING, in_process_at: 'not-a-date' })).toThrow(
      /unparseable/,
    );
  });

  it('rejects products with invalid quantity or missing sku', () => {
    const badQty: OzonFbsPosting = {
      ...POSTING,
      products: [{ ...POSTING.products[0], quantity: 0 }] as OzonPostingProduct[],
    };
    expect(() => mapPostingToOrder(badQty)).toThrow(/invalid quantity/);
    const first = POSTING.products[0] as OzonPostingProduct;
    const { sku: _omittedSku, ...productWithoutSku } = first;
    const badSku: OzonFbsPosting = {
      ...POSTING,
      products: [productWithoutSku as OzonPostingProduct],
    };
    expect(() => mapPostingToOrder(badSku)).toThrow(/sku/);
  });

  // Sprint 7 (task §8): shipment_date is a platform FACT that becomes the
  // structured orders.shipment_deadline. The official schema does not mark
  // it required - missing/invalid must degrade to null, never fail the sync.
  it('parses a valid shipment_date into shipmentDeadline', () => {
    const order = mapPostingToOrder({
      ...POSTING,
      shipment_date: '2026-09-15T18:00:00.000Z',
    });
    expect(order.shipmentDeadline?.toISOString()).toBe('2026-09-15T18:00:00.000Z');
  });

  it('maps a missing shipment_date to shipmentDeadline = null without throwing', () => {
    const order = mapPostingToOrder(POSTING);
    expect(order.shipmentDeadline).toBeNull();
    expect(() => mapPostingToOrder({ ...POSTING, shipment_date: null })).not.toThrow();
    expect(mapPostingToOrder({ ...POSTING, shipment_date: null }).shipmentDeadline).toBeNull();
  });

  it('maps an unparseable shipment_date to shipmentDeadline = null without throwing', () => {
    expect(() => mapPostingToOrder({ ...POSTING, shipment_date: 'not-a-date' })).not.toThrow();
    expect(
      mapPostingToOrder({ ...POSTING, shipment_date: 'not-a-date' }).shipmentDeadline,
    ).toBeNull();
  });

  // Dual-axis T1 (2026-09-15): normalized platform logistics stage. The
  // vocabulary was cross-checked word-by-word against the v3 English spec's
  // v3FbsPostingDetail.status description - see docs/integrations/ozon.md.
  it.each([
    ['awaiting_approve', 'AWAITING_SHIPMENT'],
    ['awaiting_packaging', 'AWAITING_SHIPMENT'],
    ['awaiting_registration', 'AWAITING_SHIPMENT'],
    ['awaiting_deliver', 'AWAITING_SHIPMENT'],
    ['delivering', 'IN_TRANSIT'],
    ['driver_pickup', 'IN_TRANSIT'],
    ['acceptance_in_progress', 'IN_TRANSIT'],
    ['delivered', 'DELIVERED'],
    ['cancelled', 'CANCELLED'],
  ])('maps Seller API status %s to stage %s', (status, stage) => {
    expect(mapPostingToOrder({ ...POSTING, status }).platformStage).toBe(stage);
  });

  it.each([
    ['arbitration'],
    ['client_arbitration'],
    ['not_accepted'],
    // Present in the v3 spec vocabulary but not yet classified by the frozen
    // mapping table - they stay null until a documented decision exists.
    ['awaiting_verification'],
    ['cancelled_from_split_pending'],
  ])('maps unclassified status %s to platformStage = null (no guessing)', (status) => {
    expect(mapPostingToOrder({ ...POSTING, status }).platformStage).toBeNull();
  });

  it('anchors IN_TRANSIT on the platform delivering_date', () => {
    const order = mapPostingToOrder({
      ...POSTING,
      status: 'delivering',
      delivering_date: '2026-09-14T08:00:00.000Z',
    });
    expect(order.platformStage).toBe('IN_TRANSIT');
    expect(order.platformStageChangedAt?.toISOString()).toBe('2026-09-14T08:00:00.000Z');
  });

  it('anchors DELIVERED on the platform fact_delivery_date', () => {
    const order = mapPostingToOrder({
      ...POSTING,
      status: 'delivered',
      fact_delivery_date: '2026-09-16T12:30:00.000Z',
    });
    expect(order.platformStage).toBe('DELIVERED');
    expect(order.platformStageChangedAt?.toISOString()).toBe('2026-09-16T12:30:00.000Z');
  });

  it('non-transit stages carry platformStageChangedAt = null', () => {
    const order = mapPostingToOrder({ ...POSTING, status: 'awaiting_deliver' });
    expect(order.platformStage).toBe('AWAITING_SHIPMENT');
    expect(order.platformStageChangedAt).toBeNull();
  });

  it('a missing or invalid delivering_date degrades to null without throwing', () => {
    const missing = mapPostingToOrder({ ...POSTING, status: 'delivering' });
    expect(missing.platformStage).toBe('IN_TRANSIT');
    expect(missing.platformStageChangedAt).toBeNull();
    const invalid = mapPostingToOrder({
      ...POSTING,
      status: 'delivering',
      delivering_date: 'not-a-date',
    });
    expect(invalid.platformStageChangedAt).toBeNull();
  });

  it('keeps the raw analytics_data delivery window verbatim in rawData', () => {
    const order = mapPostingToOrder({
      ...POSTING,
      status: 'delivering',
      analytics_data: {
        client_delivery_date_end: '2026-09-20T00:00:00Z',
        delivery_date_begin: '2026-09-18T00:00:00Z',
        delivery_date_end: '2026-09-20T00:00:00Z',
      },
    });
    expect(order.rawData['analytics_data']).toEqual({
      client_delivery_date_end: '2026-09-20T00:00:00Z',
      delivery_date_begin: '2026-09-18T00:00:00Z',
      delivery_date_end: '2026-09-20T00:00:00Z',
    });
  });
});

describe('mapRfbsReturn (dual-axis T5)', () => {
  const RFBS_RETURN = {
    return_id: 900001,
    return_number: 'R900001',
    posting_number: '00077059-0001-1',
    order_number: '77059',
    client_name: 'Ivan',
    created_at: '2026-09-14T09:00:00.000Z',
    state: {
      state: 'return_in_progress',
      state_name: 'Возврат в процессе',
      group_state: 'In_work',
      money_return_state_name: 'Оплачено',
    },
    product: { sku: 987654321, offer_id: 'VK87-BLK', name: 'VK87', price: 4590 },
  };

  it('maps an rFBS return into the normalized fact shape', () => {
    const result = mapRfbsReturn(RFBS_RETURN);
    expect(result.platformReturnId).toBe('R900001');
    expect(result.platformOrderId).toBe('00077059-0001-1');
    expect(result.state).toBe('return_in_progress');
    expect(result.refundState).toBe('Оплачено');
    expect(result.platformSkuId).toBe('987654321');
    expect(result.offerId).toBe('VK87-BLK');
    // rFBS return requests are per-unit (no quantity field in the schema).
    expect(result.quantity).toBe('1');
    expect(result.createdAt?.toISOString()).toBe('2026-09-14T09:00:00.000Z');
    expect(result.rawData).toEqual(RFBS_RETURN);
  });

  it('degrades missing optional facts to null instead of throwing (§49)', () => {
    const result = mapRfbsReturn({ return_number: 'R2' } as OzonRfbsReturn);
    expect(result.platformOrderId).toBeNull();
    expect(result.state).toBeNull();
    expect(result.refundState).toBeNull();
    expect(result.platformSkuId).toBeNull();
    expect(result.createdAt).toBeNull();
  });

  it('treats a non-positive product sku as absent (same guard as orders)', () => {
    const result = mapRfbsReturn({ ...RFBS_RETURN, product: { sku: 0 } });
    expect(result.platformSkuId).toBeNull();
  });

  it('rejects a record without return_number (business key)', () => {
    expect(() => mapRfbsReturn({ return_id: 1 } as unknown as OzonRfbsReturn)).toThrow(
      OzonMappingError,
    );
  });
});

describe('mapWebhookPayload', () => {
  it('classifies TYPE_NEW_POSTING and extracts the posting number', () => {
    const [event] = mapWebhookPayload({
      message_type: 'TYPE_NEW_POSTING',
      posting_number: '00077059-0001-1',
      seller_id: 111222333,
      warehouse_id: 2222,
    });
    expect(event?.eventType).toBe('NEW_POSTING');
    expect(event?.platformOrderIds).toEqual(['00077059-0001-1']);
    // OZON webhooks carry no event id (verified) -> hash dedup upstream.
    expect(event?.externalEventId).toBeNull();
  });

  it('classifies ping/state/item types and unknown types', () => {
    expect(mapWebhookPayload({ message_type: 'TYPE_PING' })[0]?.eventType).toBe('PING');
    expect(
      mapWebhookPayload({ message_type: 'TYPE_STATE_CHANGED', posting_number: 'P1' })[0]?.eventType,
    ).toBe('POSTING_STATE_CHANGED');
    expect(mapWebhookPayload({ message_type: 'TYPE_CREATE_ITEM' })[0]?.eventType).toBe(
      'ITEM_CHANGED',
    );
    expect(mapWebhookPayload({ message_type: 'TYPE_WAT' })[0]?.eventType).toBe('UNKNOWN');
  });

  it('rejects payloads without the message_type discriminator', () => {
    expect(() => mapWebhookPayload({ foo: 1 })).toThrow(OzonMappingError);
    expect(() => mapWebhookPayload('string')).toThrow(OzonMappingError);
  });

  it('exposes seller_id for webhook identity matching', () => {
    expect(webhookSellerId({ seller_id: 111222333 })).toBe('111222333');
    expect(webhookSellerId({ seller_id: '111222333' })).toBe('111222333');
    expect(webhookSellerId({})).toBeNull();
  });
});

describe('buildPushAck', () => {
  it('answers exactly the template the platform validates', () => {
    // {result:true} was rejected with WRONG_RESULT_TIME_FIELD (2026-09-14).
    const ack = buildPushAck(new Date('2026-09-14T15:30:00.000Z'));
    expect(ack).toEqual({
      version: '2.0',
      name: 'WCIES',
      time: '2026-09-14T15:30:00Z',
    });
    // Extra keys would risk WRONG_RESULT_FIELD - the body is the template.
    expect(Object.keys(ack).sort()).toEqual(['name', 'time', 'version']);
  });

  it('formats time without fractional seconds, matching the documented example', () => {
    expect(buildPushAck(new Date('2019-08-24T14:15:22.123Z')).time).toBe('2019-08-24T14:15:22Z');
  });

  it('reports processing start time in UTC, not local time', () => {
    const startedAt = new Date('2026-09-14T23:59:59.000Z');
    expect(buildPushAck(startedAt).time.endsWith('Z')).toBe(true);
    expect(new Date(buildPushAck(startedAt).time).getTime()).toBe(startedAt.getTime());
  });
});
