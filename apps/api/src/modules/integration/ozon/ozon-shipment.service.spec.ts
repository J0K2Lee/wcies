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
  /**
   * 异步面单三步（2026-11-03）：create 建任务 → get 取 file_url → 下载文件。
   * 省略即「平台没有可打印的面单」。
   */
  readonly label?: {
    readonly create?: { status: number; body: unknown };
    readonly get?: readonly { status: number; body: unknown }[];
    readonly file?: { status: number; contentType: string; body: string };
  };
}

function build(script: Script) {
  const shipCalls: unknown[] = [];
  const labelGetCalls: unknown[] = [];
  let readIndex = 0;
  let labelGetIndex = 0;
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
    if (url.includes('/v3/posting/fbs/package-label/create')) {
      const create = script.label?.create ?? {
        status: 200,
        body: { tasks: [{ task_id: 550490555, task_type: 'small_label' }] },
      };
      return new Response(JSON.stringify(create.body), {
        status: create.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/v2/posting/fbs/package-label/get')) {
      const rawBody = typeof init?.body === 'string' ? init.body : null;
      labelGetCalls.push(rawBody === null ? null : (JSON.parse(rawBody) as unknown));
      const scripted = script.label?.get ?? [];
      const entry = scripted[Math.min(labelGetIndex, scripted.length - 1)] ?? {
        status: 200,
        body: {
          file_url: 'https://cdn.example/ozon-label.pdf',
          status: { code: 'completed', postings_count: 1, printed_postings_count: 1 },
        },
      };
      labelGetIndex += 1;
      return new Response(JSON.stringify(entry.body), {
        status: entry.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://cdn.example/')) {
      const file = script.label?.file ?? {
        status: 200,
        contentType: 'application/octet-stream',
        body: '%PDF-1.4 downloaded',
      };
      return new Response(file.body, {
        status: file.status,
        headers: { 'Content-Type': file.contentType },
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
  const service = new OzonShipmentService(client, LOGGER);
  // 面单任务轮询等待：测试里立即返回，避免真的等 9 秒。
  (service as unknown as { wait: (ms: number) => Promise<void> }).wait = async () => undefined;
  return { service, shipCalls, labelGetCalls };
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
  it('建任务 → 轮询 → 下载 file_url，返回 PDF 字节', async () => {
    const { service, labelGetCalls } = build({
      statuses: ['awaiting_deliver'],
      label: {
        get: [
          {
            status: 200,
            body: { status: { code: 'pending' } },
          },
          {
            status: 200,
            body: {
              file_url: 'https://cdn.example/ozon-label.pdf',
              status: { code: 'completed', postings_count: 1, printed_postings_count: 1 },
            },
          },
        ],
      },
    });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING });
    expect(file?.fileName).toBe(`ozon-label-${POSTING}.pdf`);
    expect(file?.mimeType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).toString()).toBe('%PDF-1.4 downloaded');
    expect(labelGetCalls).toEqual([{ task_id: 550490555 }, { task_id: 550490555 }]);
  });

  it('create 返回空任务 → null（平台还没给面单）', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: { create: { status: 200, body: { tasks: [] } } },
    });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING }),
    ).resolves.toBeNull();
  });

  it('轮询窗口内始终 pending → null（未就绪，不是失败）', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: {
        get: [
          { status: 200, body: { status: { code: 'pending' } } },
          { status: 200, body: { status: { code: 'in_progress' } } },
        ],
      },
    });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING }),
    ).resolves.toBeNull();
  });

  it('平台答「这些单现在取不到面单」→ null（未就绪）', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: {
        create: {
          status: 400,
          body: { code: 3, message: 'NO_POSTINGS_FOR_BATCH_DOWNLOAD' },
        },
      },
    });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING }),
    ).resolves.toBeNull();
  });

  it('任务 error 状态 → 带平台原因的失败', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: {
        get: [
          {
            status: 200,
            body: {
              status: {
                code: 'error',
                unprinted_postings: [
                  { posting_number: POSTING, message: 'posting is not in awaiting_deliver' },
                ],
              },
            },
          },
        ],
      },
    });
    await expect(service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING })).rejects.toThrow(
      /posting is not in awaiting_deliver/,
    );
  });

  it('下载到的不是 PDF（例如 CDN 错误页）→ 失败，不归档坏文件', async () => {
    const { service } = build({
      statuses: ['awaiting_deliver'],
      label: {
        file: { status: 200, contentType: 'text/html', body: '<html>oops</html>' },
      },
    });
    await expect(service.fetchShippingLabel(CONTEXT, { platformOrderId: POSTING })).rejects.toThrow(
      /不是 PDF/,
    );
  });
});
