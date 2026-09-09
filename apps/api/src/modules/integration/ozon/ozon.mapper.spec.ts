import { describe, expect, it } from 'vitest';
import {
  mapPostingToOrder,
  mapProductToListing,
  mapWebhookPayload,
  webhookSellerId,
  OzonMappingError,
} from './ozon.mapper';
import {
  OzonFbsPosting,
  OzonPostingProduct,
  OzonProductInfoItem,
  OzonProductListItem,
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
    const { sku: _omittedSku, ...productWithoutSku } = POSTING.products[0];
    const badSku: OzonFbsPosting = {
      ...POSTING,
      products: [productWithoutSku as OzonPostingProduct],
    };
    expect(() => mapPostingToOrder(badSku)).toThrow(/sku/);
  });
});

describe('mapWebhookPayload', () => {
  it('classifies TYPE_NEW_POSTING and extracts the posting number', () => {
    const [event] = mapWebhookPayload({
      message_type: 'TYPE_NEW_POSTING',
      posting_number: '00077059-0001-1',
      seller_id: 3636793,
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
    expect(webhookSellerId({ seller_id: 3636793 })).toBe('3636793');
    expect(webhookSellerId({ seller_id: '3636793' })).toBe('3636793');
    expect(webhookSellerId({})).toBeNull();
  });
});
