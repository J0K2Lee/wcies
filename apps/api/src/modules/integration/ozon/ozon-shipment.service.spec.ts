import { describe, expect, it, vi } from 'vitest';
import { OzonClient } from './ozon.client';
import {
  OzonAssemblyNotConfirmedError,
  OzonOrderNotReadyError,
  OzonShipmentService,
} from './ozon-shipment.service';

/**
 * OZON order fulfillment operations (2026-09-18).
 *
 * The transport is fully scripted, so the REAL platform write is exercised
 * without ever reaching OZON (AGENTS.md §92). What is asserted here is the
 * behaviour the flow depends on: idempotency, the mandatory post-write
 * re-read, platform-vocabulary-driven refusal, and both label encodings the
 * spec contradicts itself about.
 */

const CREDENTIAL = { clientId: 'client', apiKey: 'secret' };
const CONTEXT = { storeId: 'store-1', credential: CREDENTIAL };
const POSTING = '9401-0001-1';

const LOGGER = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof OzonShipmentService>[1];

interface Script {
  /** Status returned by /v3/posting/fbs/get on the Nth read (last one repeats). */
  readonly statuses: readonly string[];
  readonly substatus?: string;
  /** Per-read substatus override (last one repeats); entries may be undefined. */
  readonly substatuses?: readonly (string | undefined)[];
  readonly availableActions?: readonly string[];
  /** Response of /v4/posting/fbs/ship; omit to make the call fail the test. */
  readonly shipResponse?: { status: number; body: unknown };
  readonly label?: { status: number; contentType: string; body: string };
}

function build(script: Script) {
  const shipCalls: unknown[] = [];
  let readIndex = 0;
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/v4/posting/fbs/ship')) {
      const rawBody = typeof init?.body === 'string' ? init.body : '{}';
      shipCalls.push(JSON.parse(rawBody) as unknown);
      const response = script.shipResponse ?? { status: 200, body: { result: [POSTING] } };
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/v2/posting/fbs/package-label')) {
      const label = script.label ?? { status: 404, contentType: 'application/json', body: '{}' };
      return new Response(label.body, {
        status: label.status,
        headers: { 'Content-Type': label.contentType },
      });
    }
    const status = script.statuses[Math.min(readIndex, script.statuses.length - 1)] ?? 'unknown';
    // Per-read substatus: an explicit undefined entry means NO substatus for
    // that read (needed to script "plain read, then ship_pending re-read").
    const substatus =
      script.substatuses === undefined
        ? script.substatus
        : script.substatuses[Math.min(readIndex, script.substatuses.length - 1)];
    readIndex += 1;
    return new Response(
      JSON.stringify({
        result: {
          posting_number: POSTING,
          status,
          ...(substatus === undefined ? {} : { substatus }),
          ...(script.availableActions === undefined
            ? {}
            : { available_actions: script.availableActions }),
          tracking_number: status === 'awaiting_deliver' ? 'OZ-TRACK-9' : null,
          products: [
            { offer_id: 'SKU-A', sku: 111, quantity: 2 },
            { offer_id: 'SKU-B', sku: 222, quantity: 1 },
          ],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  const client = new OzonClient({
    baseUrl: 'https://api-seller.ozon.test',
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { service: new OzonShipmentService(client, LOGGER), shipCalls };
}

describe('OzonShipmentService.prepareShipment', () => {
  it('does NOT write when the platform already assembled the order', async () => {
    const { service, shipCalls } = build({ statuses: ['awaiting_deliver'] });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.alreadyPrepared).toBe(true);
    expect(result.trackingNumber).toBe('OZ-TRACK-9');
    expect(shipCalls).toHaveLength(0);
  });

  it('assembles an awaiting_packaging order with every product in one package', async () => {
    const { service, shipCalls } = build({
      statuses: ['awaiting_packaging', 'awaiting_deliver'],
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.alreadyPrepared).toBe(false);
    expect(result.platformStatus).toBe('awaiting_deliver');
    expect(shipCalls).toEqual([
      {
        posting_number: POSTING,
        packages: [
          {
            products: [
              { product_id: 111, quantity: 2 },
              { product_id: 222, quantity: 1 },
            ],
          },
        ],
      },
    ]);
  });

  it('treats the platform "already shipped" answer as success', async () => {
    const { service } = build({
      statuses: ['awaiting_packaging', 'awaiting_deliver'],
      shipResponse: {
        status: 400,
        body: { code: 9, message: 'POSTING_ALREADY_SHIPPED: order is already packaged' },
      },
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.platformStatus).toBe('awaiting_deliver');
  });

  it('refuses an unconfirmed assembly instead of reporting success', async () => {
    // A 200 does NOT prove assembly: the spec requires re-reading the posting.
    const { service } = build({
      statuses: ['awaiting_packaging'],
      substatus: 'ship_failed',
    });
    await expect(service.prepareShipment(CONTEXT, { platformOrderId: POSTING })).rejects.toThrow(
      OzonAssemblyNotConfirmedError,
    );
  });

  it('refuses a cancelled posting without touching the platform', async () => {
    const { service, shipCalls } = build({ statuses: ['cancelled'] });
    await expect(service.prepareShipment(CONTEXT, { platformOrderId: POSTING })).rejects.toThrow(
      OzonOrderNotReadyError,
    );
    expect(shipCalls).toHaveLength(0);
  });

  it('follows available_actions for a status outside the known vocabulary', async () => {
    // The platform itself says the posting is shippable: never blocked by an
    // incomplete local status list (AGENTS.md §88 - follow the platform).
    const { service, shipCalls } = build({
      statuses: ['awaiting_approve', 'awaiting_deliver'],
      availableActions: ['ship'],
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.alreadyPrepared).toBe(false);
    expect(shipCalls).toHaveLength(1);
  });

  it('reports an accepted-but-unconfirmed assembly as PENDING, not an error', async () => {
    // T0 2026-10-09 (OZON 124 / 56089221-0064-1): ship returns 200, the
    // re-read still shows awaiting_packaging/ship_pending - OZON confirms
    // assembly asynchronously and the waybill is not readable yet.
    const { service, shipCalls } = build({
      statuses: ['awaiting_packaging', 'awaiting_packaging'],
      substatuses: [undefined, 'ship_pending'],
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.assemblyPending).toBe(true);
    expect(result.trackingNumber).toBeNull();
    expect(result.platformStatus).toBe('awaiting_packaging');
    expect(shipCalls).toHaveLength(1);
  });

  it('returns PENDING without a second write when entry read shows ship_pending', async () => {
    // An earlier call already submitted the assembly: converge on that fact
    // instead of firing /v4/posting/fbs/ship again.
    const { service, shipCalls } = build({
      statuses: ['awaiting_packaging'],
      substatus: 'ship_pending',
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.assemblyPending).toBe(true);
    expect(shipCalls).toHaveLength(0);
  });

  it('reports assembly still running instead of firing a second write', async () => {
    // available_actions carries the in-progress hint (alternative platform
    // signal for the same pending state).
    const { service, shipCalls } = build({
      statuses: ['awaiting_packaging'],
      availableActions: ['ship_async_in_process'],
    });
    const result = await service.prepareShipment(CONTEXT, { platformOrderId: POSTING });
    expect(result.assemblyPending).toBe(true);
    expect(shipCalls).toHaveLength(0);
  });
});

describe('OzonShipmentService.fetchShippingLabel', () => {
  it('decodes the JSON base64 envelope variant', async () => {
    const pdf = Buffer.from('%PDF-1.4 envelope');
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content_type: 'application/pdf',
          file_name: 'ticket.pdf',
          file_content: pdf.toString('base64'),
        }),
      },
    });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING });
    expect(file?.fileName).toBe('ticket.pdf');
    expect(file?.mimeType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).toString()).toBe('%PDF-1.4 envelope');
  });

  it('passes raw PDF bytes through untouched', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: { status: 200, contentType: 'application/pdf', body: '%PDF-1.4 raw' },
    });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING });
    expect(file?.mimeType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).toString()).toBe('%PDF-1.4 raw');
  });

  it('returns null when the platform says the label is not generated yet', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: {
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 5, message: "The next postings aren't ready" }),
      },
    });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING }),
    ).resolves.toBeNull();
  });
});
