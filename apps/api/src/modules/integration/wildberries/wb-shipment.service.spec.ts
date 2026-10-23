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
  /** 通用贴纸（PNG）的 base64。 */
  readonly stickerFileB64?: string;
  /**
   * 跨境贴纸接口的行为（2026-10-22）：
   * - `ready`：返回 PDF 贴纸 + parcelId；
   * - `awaitingTrackNumber`：条目在但面单未生成；
   * - `unsupported`：400（非跨境电商）→ 调用方应降级到通用贴纸；
   * - `absent`：默认，跨境接口返回空列表（同样降级）。
   */
  readonly crossBorder?: 'ready' | 'awaitingTrackNumber' | 'unsupported' | 'absent';
  readonly crossBorderPdfB64?: string;
  readonly parcelId?: string;
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
    if (url.includes('/api/v3/orders/stickers/cross-border')) {
      if (script.crossBorder === 'unsupported') {
        return new Response(JSON.stringify({ title: 'unsupported' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const mode = script.crossBorder ?? 'absent';
      const stickers =
        mode === 'ready' || mode === 'awaitingTrackNumber'
          ? [
              {
                orderId: Number(ORDER_ID),
                status: mode === 'ready' ? 'ready' : 'awaitingTrackNumber',
                ...(mode === 'ready' ? { parcelId: script.parcelId ?? 'WBCNRUGUBCJ2000ZAD' } : {}),
                file:
                  mode === 'ready'
                    ? (script.crossBorderPdfB64 ??
                      Buffer.from('%PDF-1.7 fake label').toString('base64'))
                    : '',
              },
            ]
          : [];
      return new Response(JSON.stringify({ stickers }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/v3/orders/stickers')) {
      const requested = (body as { orders?: number[] } | undefined)?.orders ?? [];
      return new Response(
        JSON.stringify({
          stickers: requested.map((orderId) => ({
            orderId,
            partA: '231648',
            partB: '9753',
            barcode: '!uKEtQZVx',
            file: script.stickerFileB64 ?? '',
          })),
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

/** 真实可解析的 1×1 PNG（PNG→PDF 转换需要合法解码）。 */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('WbShipmentService.fetchShippingLabel (2026-10-22 跨境优先)', () => {
  it('prefers the cross-border PDF sticker and carries parcelId as the tracking number', async () => {
    const { service, calls } = build({
      supplierStatus: 'confirm',
      crossBorder: 'ready',
      parcelId: 'WBCNRUGUBCJ2000ZAD',
    });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID });
    expect(file?.mimeType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).toString()).toContain('%PDF');
    expect(file?.trackingNumber).toBe('WBCNRUGUBCJ2000ZAD');
    // 跨境就绪时不再打通用贴纸接口。
    expect(calls.some((c) => c.url.includes('/stickers/cross-border'))).toBe(true);
    expect(
      calls.filter((c) => c.url.endsWith('/stickers?type=png&width=58&height=40')),
    ).toHaveLength(0);
  });

  it('returns null (not ready) when the cross-border sticker still awaits a track number', async () => {
    const { service, calls } = build({
      supplierStatus: 'confirm',
      crossBorder: 'awaitingTrackNumber',
    });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID }),
    ).resolves.toBeNull();
    // 不能降级到通用贴纸：那是另一套流程的凭证。
    expect(calls.filter((c) => c.url.includes('type=png'))).toHaveLength(0);
  });

  it('falls back to the generic PNG sticker and converts it to PDF for non-CBT sellers', async () => {
    const { service } = build({
      supplierStatus: 'confirm',
      crossBorder: 'unsupported',
      stickerFileB64: TINY_PNG_B64,
    });
    const file = await service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID });
    expect(file?.mimeType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).toString().slice(0, 5)).toBe('%PDF-');
    expect(file?.trackingNumber).toBeNull();
  });

  it('returns null when the platform lists no sticker at all', async () => {
    const { service } = build({ supplierStatus: 'confirm', crossBorder: 'absent' });
    await expect(
      service.fetchShippingLabel(CONTEXT, { platformOrderId: ORDER_ID }),
    ).resolves.toBeNull();
  });
});

describe('WbShipmentService.fetchShippingLabels (批量, 2026-10-22)', () => {
  it('returns only ready labels and keeps the caller order', async () => {
    const { service, calls } = build({ supplierStatus: 'confirm', crossBorder: 'ready' });
    const files = await service.fetchShippingLabels(CONTEXT, [ORDER_ID]);
    expect(files).toHaveLength(1);
    expect(files[0]?.platformOrderId).toBe(ORDER_ID);
    expect(files[0]?.file.mimeType).toBe('application/pdf');
    const batchCall = calls.find((c) => c.url.includes('/stickers/cross-border'));
    expect((batchCall?.body as { orders: number[] }).orders).toEqual([Number(ORDER_ID)]);
  });

  it('is a no-op for an empty id list (no platform call)', async () => {
    const { service, calls } = build({ supplierStatus: 'confirm', crossBorder: 'ready' });
    await expect(service.fetchShippingLabels(CONTEXT, [])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
