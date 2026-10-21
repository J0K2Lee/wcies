import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { OzonClient, OzonRawResponse } from './ozon.client';
import { OzonShipmentService } from './ozon-shipment.service';
import { PlatformApiError, PlatformBatchShapeError } from '../platform-error';

/**
 * 批量取面单（用户指示 2026-10-21）。
 *
 * OZON 的 `package-label` 对多个 posting **一次返回一个 PDF**，页面顺序即
 * 请求顺序。能一页对一单时才拆页；页数不符 / 返回不可解析时必须抛
 * PlatformBatchShapeError，让调用方降级逐单——绝不猜测平台的分页规则。
 */

const CREDENTIAL = { clientId: 'client', apiKey: 'secret' };
const CONTEXT = { storeId: 'store-1', credential: CREDENTIAL };

const LOGGER = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof OzonShipmentService>[1];

async function makeCombinedPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([(57.9 * 72) / 25.4, (40 * 72) / 25.4]);
  }
  return doc.save();
}

function pdfResponse(bytes: Uint8Array): OzonRawResponse {
  return { contentType: 'application/pdf', bytes, text: '' };
}

function build(response: OzonRawResponse | Error) {
  const packageLabel = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  const client = { packageLabel } as unknown as OzonClient;
  const service = new OzonShipmentService(client, LOGGER);
  return { service, packageLabel };
}

describe('OzonShipmentService.fetchShippingLabels (批量取单)', () => {
  it('一次调用取多单，按请求顺序把合并 PDF 拆成一单一页', async () => {
    const { service, packageLabel } = build(pdfResponse(await makeCombinedPdf(2)));

    const files = await service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']);

    expect(packageLabel).toHaveBeenCalledTimes(1);
    expect(packageLabel).toHaveBeenCalledWith(expect.anything(), 'store-1', [
      'posting-1',
      'posting-2',
    ]);
    expect(files.map((entry) => entry.platformOrderId)).toEqual(['posting-1', 'posting-2']);
    for (const entry of files) {
      const doc = await PDFDocument.load(entry.file.bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it('页数与订单数不一致 → PlatformBatchShapeError（调用方降级逐单）', async () => {
    const { service } = build(pdfResponse(await makeCombinedPdf(1)));

    await expect(
      service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']),
    ).rejects.toBeInstanceOf(PlatformBatchShapeError);
  });

  it('返回不可解析为 PDF 的字节（例如 ZIP）→ PlatformBatchShapeError', async () => {
    const { service } = build({
      contentType: 'application/zip',
      bytes: new TextEncoder().encode('PK\u0003\u0004 not a pdf'),
      text: '',
    });

    await expect(
      service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']),
    ).rejects.toBeInstanceOf(PlatformBatchShapeError);
  });

  it('平台答「面单未就绪」→ 返回空数组（不是错误）', async () => {
    const { service } = build(
      new PlatformApiError({
        code: 'PLATFORM_API_ERROR',
        message: "The next postings aren't ready",
        endpoint: '/v2/posting/fbs/package-label',
        storeId: 'store-1',
        httpStatus: 400,
        requestId: null,
      }),
    );

    await expect(service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2'])).resolves.toEqual(
      [],
    );
  });

  it('空 id 列表不调用平台', async () => {
    const { service, packageLabel } = build(pdfResponse(await makeCombinedPdf(1)));

    await expect(service.fetchShippingLabels(CONTEXT, [])).resolves.toEqual([]);
    expect(packageLabel).not.toHaveBeenCalled();
  });
});
