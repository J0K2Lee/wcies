import { describe, expect, it, vi } from 'vitest';
import { YandexClient } from './yandex.client';
import { YxOrderNotPreparableError, YandexShipmentService } from './yandex-shipment.service';

/**
 * Yandex outbound-shipment operations (2026-09-18). The transport is fully
 * scripted, so the REAL platform write is exercised without ever reaching
 * Yandex (AGENTS.md §92). The verified seller transition is
 * PROCESSING/STARTED -> PROCESSING/READY_TO_SHIP (vendor OpenAPI,
 * updateOrderStatus); everything beyond that is platform-driven.
 */

const CREDENTIAL = { apiKey: 'secret' };
const CONTEXT = { storeId: 'store-1', credential: CREDENTIAL };
const IDENTITY = { businessId: '2002', campaignId: '1001' };
const ORDER_ID = '5632423';

const LOGGER = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof YandexShipmentService>[1];

interface Script {
  readonly status: string;
  readonly substatus?: string;
  /** State after the PUT write; defaults to READY_TO_SHIP. */
  readonly substatusAfter?: string;
  readonly label?: { status: number; contentType: string; body: string };
  readonly tracks?: readonly Record<string, unknown>[];
}

function build(script: Script) {
  const writes: Array<{ url: string; body: unknown }> = [];
  let currentStatus = script.status;
  let currentSubstatus = script.substatus;
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/v1/businesses/') && url.includes('/orders')) {
      return new Response(
        JSON.stringify({
          orders: [
            {
              orderId: Number(ORDER_ID),
              campaignId: Number(IDENTITY.campaignId),
              status: currentStatus,
              ...(currentSubstatus === undefined ? {} : { substatus: currentSubstatus }),
              creationDate: '2026-09-08T10:15:30+03:00',
              ...(script.tracks === undefined ? {} : { delivery: { tracks: script.tracks } }),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/orders/') && url.endsWith('/status')) {
      writes.push({
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      currentStatus = 'PROCESSING';
      currentSubstatus = script.substatusAfter ?? 'READY_TO_SHIP';
      return new Response(
        JSON.stringify({
          order: { orderId: Number(ORDER_ID), status: currentStatus, substatus: currentSubstatus },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/delivery/labels')) {
      const label = script.label ?? {
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ERROR', errors: [{ code: 'NOT_READY' }] }),
      };
      return new Response(label.body, {
        status: label.status,
        headers: { 'Content-Type': label.contentType },
      });
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new YandexClient({
    baseUrl: 'https://api.partner.market.yandex.test',
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    maxConcurrency: 4,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { service: new YandexShipmentService(client, LOGGER), writes };
}

describe('YandexShipmentService.prepareShipment', () => {
  it('writes READY_TO_SHIP for a confirmed, unprepared order', async () => {
    const { service, writes } = build({ status: 'PROCESSING', substatus: 'STARTED' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.url).toBe(
      `https://api.partner.market.yandex.test/v2/campaigns/1001/orders/5632423/status`,
    );
    expect(writes[0]?.body).toEqual({
      order: { status: 'PROCESSING', substatus: 'READY_TO_SHIP' },
    });
    expect(result.alreadyPrepared).toBe(false);
    expect(result.platformStatus).toBe('PROCESSING');
  });

  it('is a no-op when the order is already READY_TO_SHIP', async () => {
    const { service, writes } = build({ status: 'PROCESSING', substatus: 'READY_TO_SHIP' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY);
    expect(result.alreadyPrepared).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('does not write backwards when the platform already moved the order on', async () => {
    // Platform-managed substatuses beyond the seller step must not be rolled
    // back by a seller write.
    const { service, writes } = build({ status: 'PROCESSING', substatus: 'SHIPPED' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY);
    expect(result.alreadyPrepared).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('treats later logistics stages as already prepared', async () => {
    const { service, writes } = build({ status: 'DELIVERY' });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY);
    expect(result.alreadyPrepared).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('refuses a cancelled order without writing', async () => {
    const { service, writes } = build({ status: 'CANCELLED', substatus: 'SHOP_FAILED' });
    await expect(
      service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY),
    ).rejects.toThrow(YxOrderNotPreparableError);
    expect(writes).toHaveLength(0);
  });

  it('refuses an order the seller has not confirmed yet', async () => {
    const { service, writes } = build({ status: 'PENDING' });
    await expect(
      service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY),
    ).rejects.toThrow(YxOrderNotPreparableError);
    expect(writes).toHaveLength(0);
  });

  it('surfaces the platform tracking code once assigned', async () => {
    const { service } = build({
      status: 'PROCESSING',
      substatus: 'READY_TO_SHIP',
      tracks: [{ trackCode: 'YX-TRACK-1', deliveryServiceId: 99 }],
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY);
    expect(result.trackingNumber).toBe('YX-TRACK-1');
  });

  it('refuses a non-numeric platform order id', async () => {
    const { service, writes } = build({ status: 'PROCESSING', substatus: 'STARTED' });
    await expect(
      service.prepareShipment(CONTEXT, { platformOrderId: 'YX-abc' }, IDENTITY),
    ).rejects.toThrow(YxOrderNotPreparableError);
    expect(writes).toHaveLength(0);
  });
});

describe('YandexShipmentService.fetchShippingLabel', () => {
  it('passes the PDF bytes through untouched', async () => {
    const { service } = build({
      status: 'PROCESSING',
      substatus: 'READY_TO_SHIP',
      label: { status: 200, contentType: 'application/pdf', body: '%PDF-1.4 yx label' },
    });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY);
    expect(file?.mimeType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).toString()).toBe('%PDF-1.4 yx label');
  });

  it('returns null while the label is not generated yet', async () => {
    const { service } = build({ status: 'PROCESSING', substatus: 'STARTED' });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY),
    ).resolves.toBeNull();
  });

  it('ignores a JSON body that arrives with a 200 (not a PDF)', async () => {
    const { service } = build({
      status: 'PROCESSING',
      substatus: 'READY_TO_SHIP',
      label: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ERROR', errors: [{ code: 'X' }] }),
      },
    });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID }, IDENTITY),
    ).resolves.toBeNull();
  });
});
