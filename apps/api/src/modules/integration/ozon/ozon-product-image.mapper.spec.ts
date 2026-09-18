import { describe, expect, it, vi } from 'vitest';
import { mapProductImages } from './ozon-product-image.mapper';
import { OzonAdapter } from './ozon.adapter';
import { OzonClient } from './ozon.client';

const primary = 'https://cdn.example/primary.jpg';
const fallback = 'https://cdn.example/fallback.jpg';

describe('OZON product images', () => {
  it.each([
    [{ primary_image: [primary], images: [fallback] }, primary],
    [{ primary_image: [], images: [fallback] }, fallback],
    [{ images: [fallback] }, fallback],
    [{ primary_image: [''], images: [fallback] }, fallback],
    [{ primary_image: ['javascript:alert(1)'], images: [fallback] }, fallback],
    [{ images: [] }, null],
    [{}, null],
    [{ primary_image: 'not-an-array', images: [42] }, null],
  ])('maps first image using priority and tolerates absent images (%j)', (fields, expected) => {
    expect(mapProductImages({ items: [{ sku: 123, ...fields }] }, 'store').get('123')).toBe(
      expected,
    );
  });

  it('rejects malformed envelopes and ambiguous SKU responses', () => {
    expect(() => mapProductImages({ result: { items: [] } }, 'store')).toThrow();
    expect(() => mapProductImages({ items: [{ sku: 1 }, { sku: 1 }] }, 'store')).toThrow();
    expect(() =>
      mapProductImages({ items: [{ sku: Number.MAX_SAFE_INTEGER + 1 }] }, 'store'),
    ).toThrow();
  });

  it('reuses product info transport with numeric sku batches of 100 and store auth', async () => {
    const bodies: number[][] = [];
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
      const body = JSON.parse(init.body) as { sku: number[] };
      bodies.push(body.sku);
      expect(init?.headers).toMatchObject({ 'Client-Id': 'client', 'Api-Key': 'secret' });
      return new Response(
        JSON.stringify({ items: body.sku.map((sku) => ({ sku, primary_image: [primary] })) }),
      );
    });
    const adapter = new OzonAdapter(
      new OzonClient({
        baseUrl: 'https://example.test',
        timeoutMs: 1000,
        maxRetries: 0,
        perStoreMinIntervalMs: 0,
        fetchImpl: transport,
      }),
      // Not exercised here: image lookup never touches the shipment write path.
      {} as unknown as ConstructorParameters<typeof OzonAdapter>[1],
    );
    const context = {
      storeId: 'store',
      storeCode: 'S',
      platform: 'OZON' as const,
      credential: { clientId: 'client', apiKey: 'secret' },
    };
    const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));
    const images = await adapter.fetchProductImages(context, [...ids, '1', 'invalid']);
    expect(bodies.map((body) => body.length)).toEqual([100, 1]);
    expect(transport.mock.calls[0]?.[0]).toBe('https://example.test/v3/product/info/list');
    expect(images.get('101')).toBe(primary);
    expect(images.get('invalid')).toBeNull();
    expect(await adapter.fetchProductImages(context, [])).toEqual(new Map());
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
