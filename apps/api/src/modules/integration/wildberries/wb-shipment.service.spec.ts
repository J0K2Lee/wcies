import { describe, expect, it, vi } from 'vitest';
import { WbClient } from './wb.client';
import { WbOrderNotPreparableError, WbShipmentService } from './wb-shipment.service';

/**
 * WB outbound-shipment operations (2026-09-18). The transport is fully
 * scripted, so the REAL platform write is exercised without ever reaching WB
 * (AGENTS.md §92). The flow under test is supply-driven: the only seller path
 * into `confirm` is putting the order into a supply (vendor spec,
 * docs/wb-orders-fbs-openapi.yaml).
 */

const CREDENTIAL = { apiKey: 'secret' };
const CONTEXT = { storeId: 'store-1', credential: CREDENTIAL };
const ORDER_ID = '5632423';

const LOGGER = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof WbShipmentService>[1];

interface Script {
  /** supplierStatus BEFORE the write (POST /api/v3/orders/status). */
  readonly supplierStatus: string;
  /** supplierStatus AFTER the order joined the supply; default confirm. */
  readonly supplierStatusAfter?: string;
  readonly supplyId?: string;
  readonly stickerFileB64?: string;
}

function build(script: Script) {
  const calls: Array<{ url: string; body: unknown }> = [];
  // Persistent scripted state: the write flips it, later reads observe it.
  let currentStatus = script.supplierStatus;
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, body });
    if (url.includes('/supplies/') && url.endsWith('/orders')) {
      currentStatus = script.supplierStatusAfter ?? 'confirm';
    }
    if (url.includes('/api/v3/orders/status')) {
      return new Response(
        JSON.stringify({
          orders: [{ id: Number(ORDER_ID), supplierStatus: currentStatus, wbStatus: 'waiting' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/v3/supplies')) {
      return new Response(JSON.stringify({ id: script.supplyId ?? 'WB-GI-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/supplies/') && url.endsWith('/orders')) {
      return new Response(null, { status: 204 });
    }
    if (url.includes('/api/v3/orders/stickers')) {
      return new Response(
        JSON.stringify({
          stickers:
            script.stickerFileB64 === undefined
              ? []
              : [
                  {
                    orderId: Number(ORDER_ID),
                    partA: '231648',
                    partB: '9753',
                    barcode: '!uKEtQZVx',
                    file: script.stickerFileB64,
                  },
                ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new WbClient({
    baseUrls: {
      common: 'https://common-api.wb.test',
      content: 'https://content-api.wb.test',
      marketplace: 'https://marketplace-api.wb.test',
      statistics: 'https://statistics-api.wb.test',
      webhooks: 'https://webhooks-api.wb.test',
    },
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    statisticsMinIntervalMs: 0,
    webhooksMinIntervalMs: 0,
    marketplace4xxPenaltyMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { service: new WbShipmentService(client, LOGGER), calls };
}

describe('WbShipmentService.prepareShipment', () => {
  it('creates a dedicated supply and joins the order for a `new` order', async () => {
    const { service, calls } = build({ supplierStatus: 'new' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID });

    const created = calls.find((c) => c.url.endsWith('/api/v3/supplies'));
    expect(created).toEqual({
      url: 'https://marketplace-api.wb.test/api/v3/supplies',
      body: { name: `WCIES-${ORDER_ID}` },
    });
    expect(calls.some((c) => c.url.includes('/supplies/WB-GI-1/orders'))).toBe(true);
    expect(result.alreadyPrepared).toBe(false);
    expect(result.platformStatus).toBe('confirm');
  });

  it('is a no-op for an order already in a supply (`confirm`)', async () => {
    const { service, calls } = build({ supplierStatus: 'confirm' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID });
    expect(result.alreadyPrepared).toBe(true);
    expect(result.platformStatus).toBe('confirm');
    // Only the status read happened - no supply was created.
    expect(calls).toHaveLength(1);
  });

  it('is a no-op for an order already in delivery (`complete`)', async () => {
    const { service, calls } = build({ supplierStatus: 'complete' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID });
    expect(result.alreadyPrepared).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('refuses a cancelled order without writing anything', async () => {
    const { service, calls } = build({ supplierStatus: 'cancel' });
    await expect(service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID })).rejects.toThrow(
      WbOrderNotPreparableError,
    );
    expect(calls).toHaveLength(1);
  });

  it('reports an unverified status instead of guessing a transition', async () => {
    const { service, calls } = build({ supplierStatus: 'something_new' });
    await expect(service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID })).rejects.toThrow(
      WbOrderNotPreparableError,
    );
    expect(calls).toHaveLength(1);
  });

  it('refuses a non-numeric platform order id', async () => {
    const { service } = build({ supplierStatus: 'new' });
    await expect(service.prepareShipment(CONTEXT, { platformOrderId: 'WB-abc-1' })).rejects.toThrow(
      WbOrderNotPreparableError,
    );
  });
});

describe('WbShipmentService.fetchShippingLabel', () => {
  it('decodes the base64 sticker file', async () => {
    const b64 = Buffer.from('%PNG-sticker').toString('base64');
    const { service } = build({ supplierStatus: 'confirm', stickerFileB64: b64 });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID });
    expect(file?.mimeType).toBe('image/png');
    expect(Buffer.from(file!.bytes).toString()).toBe('%PNG-sticker');
  });

  it('returns null when the platform lists no sticker for the order', async () => {
    const { service } = build({ supplierStatus: 'confirm', stickerFileB64: undefined });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID }),
    ).resolves.toBeNull();
  });
});
