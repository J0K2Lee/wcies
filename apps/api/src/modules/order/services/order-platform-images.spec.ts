import { describe, expect, it, vi } from 'vitest';
import { OrderService } from './order.service';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderSyncService } from '../../sync/services/order-sync.service';
import { PlatformOrderRaw } from '@wcies/platform-contracts';

function buildDetail(
  skuId: string | null,
  platformImageUrl: string | null,
  internal: string | null,
) {
  const listBySku = vi.fn().mockResolvedValue(internal ? [{ url: internal, isPrimary: true }] : []);
  const service: OrderService = Object.assign(
    Object.create(OrderService.prototype) as OrderService,
    {
      orderRepo: { findById: vi.fn().mockResolvedValue({ id: 'order', storeId: 'store' }) },
      itemRepo: {
        findByOrderIdWithSku: vi.fn().mockResolvedValue([
          {
            item: { id: 'item', skuId, platformImageUrl, reservationId: null },
            skuCode: '',
            skuName: '',
          },
        ]),
      },
      storeService: { getEntityWithPlatform: vi.fn().mockResolvedValue(null) },
      historyRepo: { listByOrderId: vi.fn().mockResolvedValue([]) },
      platformStatusHistoryRepo: { listByOrderId: vi.fn().mockResolvedValue([]) },
      interceptionPort: { listByOrderId: vi.fn().mockResolvedValue([]) },
      pickingState: { listTasksForOrder: vi.fn().mockResolvedValue([]) },
      exceptionService: { listByReference: vi.fn().mockResolvedValue([]) },
      procurementPort: { getProcurementStatesByOrderItemIds: vi.fn().mockResolvedValue({}) },
      skuImageService: { listBySku },
    },
  );
  return { service, listBySku };
}

describe('OrderService image authority', () => {
  it.each([
    [null, 'https://cdn.test/image', null, 'PLATFORM', 'https://cdn.test/image'],
    ['sku', 'https://cdn.test/image', 'signed-internal', 'INTERNAL', 'signed-internal'],
    ['sku', 'https://cdn.test/image', null, null, null],
    [null, null, null, null, null],
  ])(
    'detail image follows internal mapping (%s)',
    async (skuId, platform, internal, source, url) => {
      const { service, listBySku } = buildDetail(skuId, platform, internal);
      expect((await service.getDetail('order')).items[0]).toMatchObject({
        imageUrl: url,
        imageSource: source,
      });
      expect(listBySku).toHaveBeenCalledTimes(skuId === null ? 0 : 1);
    },
  );

  it('public save delegates a scoped batch and audits only changed rows', async () => {
    const savePlatformImages = vi.fn().mockResolvedValue(['item']);
    const record = vi.fn();
    const service: OrderService = Object.assign(
      Object.create(OrderService.prototype) as OrderService,
      {
        itemRepo: { savePlatformImages },
        operationLog: { record },
      },
    );
    const images = [{ orderItemId: 'item', imageUrl: 'https://cdn.test/image' }];
    expect(
      await service.savePlatformImages('store', images, { userId: null, username: 'sync' }),
    ).toBe(1);
    expect(savePlatformImages).toHaveBeenCalledWith('store', images);
    expect(record).toHaveBeenCalledOnce();
  });

  it('batch SQL guards store, unmapped state and missing image during concurrent mapping', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'item' }]);
    const repo: OrderItemRepository = Object.assign(
      Object.create(OrderItemRepository.prototype) as OrderItemRepository,
      {
        dataSource: { query },
      },
    );
    expect(
      await repo.savePlatformImages('store', [{ orderItemId: 'item', imageUrl: 'url' }]),
    ).toEqual(['item']);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('o.store_id = $1::uuid');
    expect(sql).toContain('i.sku_id IS NULL AND i.platform_image_url IS NULL');
    expect(await repo.savePlatformImages('store', [])).toEqual([]);
    expect(query).toHaveBeenCalledOnce();
  });
});

// Located in the allowed order spec directory; exercises the public sync seam.
describe('OrderSyncService best-effort platform images', () => {
  function build(rows = [{ id: 'item', orderId: 'order', platformSkuId: '123' }]) {
    const fetchProductImages = vi
      .fn()
      .mockResolvedValue(new Map([['123', 'https://cdn.test/image']]));
    const savePlatformImages = vi.fn().mockResolvedValue(1);
    const warn = vi.fn();
    const service: OrderSyncService = Object.assign(
      Object.create(OrderSyncService.prototype) as OrderSyncService,
      {
        contextService: {
          resolveSyncableStore: vi
            .fn()
            .mockResolvedValue({ store: { id: 'store' }, adapter: { fetchProductImages } }),
          buildStoreContext: vi.fn().mockResolvedValue({ storeId: 'store' }),
        },
        orderService: {
          listMissingPlatformImages: vi.fn().mockResolvedValue(rows),
          savePlatformImages,
        },
        ingestionService: {
          ingest: vi.fn().mockResolvedValue({ orderId: 'order', alreadyIngested: false }),
        },
        logger: { warn },
      },
    );
    return { service, fetchProductImages, savePlatformImages, warn };
  }
  const order: PlatformOrderRaw = {
    platformOrderId: 'posting',
    platformStatus: null,
    fulfillmentMode: null,
    orderedAt: new Date(),
    shipmentDeadline: null,
    currency: null,
    items: [],
    rawData: {},
  };
  it.each(['POLLING', 'WEBHOOK'] as const)('enriches after %s ingestion', async (source) => {
    const { service, fetchProductImages, savePlatformImages } = build();
    expect(await service.ingestPlatformOrders('store', [order], source)).toEqual({
      ingested: 1,
      duplicates: 0,
      failed: 0,
    });
    expect(fetchProductImages).toHaveBeenCalledWith({ storeId: 'store' }, ['123']);
    expect(savePlatformImages).toHaveBeenCalledWith(
      'store',
      [{ orderItemId: 'item', imageUrl: 'https://cdn.test/image' }],
      expect.anything(),
    );
  });
  it('all mapped/already imaged rows make zero platform calls', async () => {
    const { service, fetchProductImages } = build([]);
    await service.ingestPlatformOrders('store', [order], 'POLLING');
    expect(fetchProductImages).not.toHaveBeenCalled();
  });
  it('adapter errors warn without changing ingestion success', async () => {
    const { service, fetchProductImages, savePlatformImages, warn } = build();
    fetchProductImages.mockRejectedValue(new Error('sensitive upstream error'));
    expect(await service.ingestPlatformOrders('store', [order], 'WEBHOOK')).toEqual({
      ingested: 1,
      duplicates: 0,
      failed: 0,
    });
    expect(savePlatformImages).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
  });
  it('missing images warn and do not save nulls', async () => {
    const { service, fetchProductImages, savePlatformImages, warn } = build();
    fetchProductImages.mockResolvedValue(new Map());
    await service.enrichPlatformImages('store', 'order');
    expect(savePlatformImages).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
  it('dry run reads real adapter seam but never saves', async () => {
    const { service, savePlatformImages } = build();
    expect(await service.enrichPlatformImages('store', undefined, true)).toMatchObject({
      candidates: 1,
      wouldUpdate: 1,
      updated: 0,
      failed: false,
    });
    expect(savePlatformImages).not.toHaveBeenCalled();
  });
  it('save failures also never fail ingestion', async () => {
    const { service, savePlatformImages, warn } = build();
    savePlatformImages.mockRejectedValue(new Error('DB write failure'));
    expect(await service.ingestPlatformOrders('store', [order], 'POLLING')).toMatchObject({
      ingested: 1,
      failed: 0,
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});

// Yandex 订单行补图（2026-09-28，ERP 建议#2）：platformSkuId 落库为 null，
// 走 sellerSku -> 本店铺 Listing raw_data.offer.pictures 的纯 DB 反查。
describe('OrderSyncService Yandex order-row images', () => {
  function buildYandex(
    rows: Array<{
      id: string;
      orderId: string;
      platformSkuId: string | null;
      sellerSku: string | null;
    }>,
    media: Array<{ sellerSku: string; listingUrl: string | null; listingRawData: unknown }>,
  ) {
    const savePlatformImages = vi.fn().mockResolvedValue(rows.length);
    const findListingMedia = vi.fn().mockResolvedValue(media);
    const warn = vi.fn();
    const fetchProductImages = vi.fn();
    const service: OrderSyncService = Object.assign(
      Object.create(OrderSyncService.prototype) as OrderSyncService,
      {
        contextService: {
          resolveSyncableStore: vi.fn().mockResolvedValue({
            store: { id: 'store' },
            adapter: { fetchProductImages },
            platformCode: 'YANDEX',
          }),
          buildStoreContext: vi.fn(),
        },
        orderService: {
          listMissingPlatformImages: vi.fn().mockResolvedValue(rows),
          savePlatformImages,
        },
        listingService: { findListingMediaBySellerSkus: findListingMedia },
        ingestionService: {
          ingest: vi.fn().mockResolvedValue({ orderId: 'order', alreadyIngested: false }),
        },
        logger: { warn },
      },
    );
    return { service, savePlatformImages, findListingMedia, fetchProductImages, warn };
  }

  const yandexRow = { id: 'item', orderId: 'order', platformSkuId: null, sellerSku: 'offer-1' };

  it('resolves the primary picture from listing raw_data without platform API calls', async () => {
    const ctx = buildYandex(
      [yandexRow],
      [
        {
          sellerSku: 'offer-1',
          listingUrl: null,
          listingRawData: { offer: { pictures: ['https://img.example/a.jpg'] } },
        },
      ],
    );
    const result = await ctx.service.enrichPlatformImages('store', 'order');
    expect(ctx.findListingMedia).toHaveBeenCalledWith('store', ['offer-1']);
    expect(ctx.fetchProductImages).not.toHaveBeenCalled();
    expect(ctx.savePlatformImages).toHaveBeenCalledWith(
      'store',
      [{ orderItemId: 'item', imageUrl: 'https://img.example/a.jpg' }],
      expect.anything(),
    );
    expect(result).toMatchObject({ candidates: 1, wouldUpdate: 1, updated: 1, failed: false });
  });

  it('first media row wins when one offer sits on several links (§25)', async () => {
    const ctx = buildYandex(
      [yandexRow],
      [
        {
          sellerSku: 'offer-1',
          listingUrl: null,
          listingRawData: { offer: { pictures: ['https://img.example/first.jpg'] } },
        },
        {
          sellerSku: 'offer-1',
          listingUrl: null,
          listingRawData: { offer: { pictures: ['https://img.example/second.jpg'] } },
        },
      ],
    );
    await ctx.service.enrichPlatformImages('store', 'order');
    expect(ctx.savePlatformImages).toHaveBeenCalledWith(
      'store',
      [{ orderItemId: 'item', imageUrl: 'https://img.example/first.jpg' }],
      expect.anything(),
    );
  });

  it('rows without any resolvable picture warn and never save', async () => {
    const ctx = buildYandex(
      [yandexRow, { id: 'item-2', orderId: 'order', platformSkuId: null, sellerSku: 'offer-2' }],
      [
        { sellerSku: 'offer-1', listingUrl: null, listingRawData: { offer: { pictures: [] } } },
        { sellerSku: 'offer-2', listingUrl: null, listingRawData: {} },
      ],
    );
    const result = await ctx.service.enrichPlatformImages('store', 'order');
    expect(ctx.savePlatformImages).not.toHaveBeenCalled();
    expect(result).toMatchObject({ candidates: 2, wouldUpdate: 0, updated: 0, failed: false });
    expect(ctx.warn).toHaveBeenCalledOnce();
  });
});
