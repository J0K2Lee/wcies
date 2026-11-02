import { describe, expect, it } from 'vitest';
import { YandexAdapter } from './yandex.adapter';
import { YandexClient } from './yandex.client';
import { vi } from 'vitest';

/**
 * Yandex 退货列表信封（2026-11-02 修复）。
 *
 * 官方规范是 `{status, result:{returns, paging}}`；此前 adapter 读顶层
 * `returns`，每次同步都抛 "returns array missing"（Yandex 退货提醒空跑）。
 * 顶层形状保留兼容分支。
 */
const SHIPMENT_STUB = {} as unknown as ConstructorParameters<typeof YandexAdapter>[1];
const BASE = 'https://api.partner.market.yandex.test';

const CONTEXT = {
  storeId: 'store-1',
  storeCode: 'YX-A',
  platform: 'YANDEX' as const,
  credential: { apiKey: 'test-yx-token', campaignId: '111' },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function build(returnsBody: unknown): YandexAdapter {
  const fetchImpl = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.includes('/v2/campaigns') && url.includes('/returns')) {
      return jsonResponse(returnsBody);
    }
    if (url.includes('/v2/campaigns')) {
      return jsonResponse({
        campaigns: [{ id: 111, businessId: 222, domain: 'ru' }],
        paging: { nextPageToken: null },
      });
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new YandexClient({
    baseUrl: BASE,
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    maxConcurrency: 4,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return new YandexAdapter(client, SHIPMENT_STUB);
}

describe('YandexAdapter.fetchReturns 信封', () => {
  it('读取官方 result.returns 信封', async () => {
    const adapter = build({
      status: 'OK',
      result: {
        returns: [
          {
            id: 9001,
            orderId: 555,
            returnType: 'RETURN',
            items: [{ marketSku: '3214646989', shopSku: 'G75v2 TTC', count: 1 }],
            shipmentStatus: 'WAITING_FOR_DECISION',
            refundStatus: 'REFUND_PENDING',
            createdAt: '2026-11-01T10:00:00+03:00',
          },
        ],
        paging: { nextPageToken: null },
      },
    });

    const page = await adapter.fetchReturns(CONTEXT);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.platformReturnId).toBe('9001');
    expect(page.items[0]?.platformOrderId).toBe('555');
    expect(page.hasMore).toBe(false);
  });

  it('顶层 returns 的旧形状仍然兼容', async () => {
    const adapter = build({
      returns: [{ id: 9002, orderId: 556, items: [], returnType: 'UNREDEEMED' }],
      paging: { nextPageToken: null },
    });

    const page = await adapter.fetchReturns(CONTEXT);

    expect(page.items.map((item) => item.platformReturnId)).toEqual(['9002']);
  });
});
