import { describe, expect, it, vi } from 'vitest';
import { StoreContext } from '@wcies/platform-contracts';
import { OzonAdapter } from './ozon.adapter';
import { OzonClient } from './ozon.client';
import { OzonShipmentService } from './ozon-shipment.service';

/**
 * 订单行按需补链接（2026-10-20）：OZON 定向读取单个变体。
 * `/v3/product/info/list` 同时支持 offer_id 与 sku 两种入参（图片富化早已
 * 在生产使用 sku 入参）；一次点击最多一次调用。
 */

const CONTEXT: StoreContext = {
  storeId: 'store-1',
  storeCode: 'ON-002',
  platform: 'OZON',
  credential: { clientId: '111222333', apiKey: 'unit-test-api-key' },
};

function build(response: unknown) {
  const productInfoList = vi.fn().mockResolvedValue(response);
  const adapter = new OzonAdapter(
    { productInfoList } as unknown as OzonClient,
    {} as unknown as OzonShipmentService,
  );
  return { adapter, productInfoList };
}

describe('OzonAdapter.fetchListingVariant', () => {
  it('按不可变的 sku 定向读取，并归一化为 PlatformListingRaw', async () => {
    const { adapter, productInfoList } = build({
      items: [{ id: 3706007459, sku: 6040898074, offer_id: 'KASIER-44', name: 'KASIER 标配' }],
    });

    const listing = await adapter.fetchListingVariant(CONTEXT, {
      platformSkuId: '6040898074',
      offerId: 'ignored-when-sku-present',
    });

    expect(productInfoList).toHaveBeenCalledWith(
      { clientId: '111222333', apiKey: 'unit-test-api-key' },
      'store-1',
      [],
      [6040898074],
    );
    expect(listing).toMatchObject({
      platformProductId: '3706007459',
      title: 'KASIER 标配',
      skus: [
        {
          platformSkuId: '6040898074',
          offerId: 'KASIER-44',
          sellerSku: null,
        },
      ],
    });
  });

  it('没有 sku 时按 offer_id 读取', async () => {
    const { adapter, productInfoList } = build({
      items: [{ id: 3706007459, offer_id: 'KASIER-44', name: 'KASIER 标配' }],
    });

    const listing = await adapter.fetchListingVariant(CONTEXT, {
      platformSkuId: null,
      offerId: 'KASIER-44',
    });

    expect(productInfoList).toHaveBeenCalledWith(
      { clientId: '111222333', apiKey: 'unit-test-api-key' },
      'store-1',
      ['KASIER-44'],
    );
    expect(listing?.platformProductId).toBe('3706007459');
  });

  it('平台查不到时返回 null（不抛错，由上层决定兜底）', async () => {
    const { adapter } = build({ items: [] });
    await expect(
      adapter.fetchListingVariant(CONTEXT, { platformSkuId: '6040898074' }),
    ).resolves.toBeNull();
  });

  it('没有任何可查询标识时返回 null 且不打接口', async () => {
    const { adapter, productInfoList } = build({ items: [] });
    await expect(
      adapter.fetchListingVariant(CONTEXT, { platformSkuId: null, offerId: null }),
    ).resolves.toBeNull();
    expect(productInfoList).not.toHaveBeenCalled();
  });

  it('响应不是 { items: [...] } 时抛畸形响应（不把平台异常当「查不到」）', async () => {
    const { adapter } = build({ result: { items: [] } });
    await expect(
      adapter.fetchListingVariant(CONTEXT, { platformSkuId: '6040898074' }),
    ).rejects.toThrow(/product|info|items/i);
  });
});
