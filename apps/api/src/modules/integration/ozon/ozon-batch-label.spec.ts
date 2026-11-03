import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { OzonClient } from './ozon.client';
import { OzonShipmentService } from './ozon-shipment.service';
import { PlatformApiError, PlatformBatchShapeError } from '../platform-error';

/**
 * 批量取面单（2026-10-21 引入；2026-11-03 迁移到 OZON 异步面单接口）。
 *
 * 旧同步接口 `POST /v2/posting/fbs/package-label` 自 2026-11-02 起被官方停用，
 * 现流程：`/v3/.../package-label/create` 建任务 → `/v2/.../package-label/get`
 * 轮询 → 下载 `file_url`。多单仍是**一个 PDF**，页面顺序即请求顺序，所以只有
 * 「全部打印成功且页数 = 单数」时才拆页；否则抛 PlatformBatchShapeError 让调用
 * 方降级逐单——绝不猜测平台的分页规则。
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

interface Script {
  /** create 抛出的错误（脚本化平台拒绝）。 */
  readonly createError?: Error;
  /** create 返回的任务；省略 = 空任务列表。 */
  readonly tasks?: readonly { task_id: number | string; task_type?: string }[];
  /** get 依次返回的状态码（最后一个重复）；省略 = 直接 completed。 */
  readonly statuses?: readonly string[];
  readonly printed?: number;
  readonly unprinted?: readonly { posting_number?: string; message?: string }[];
  /** 下载到的字节；省略 = 合成的 PDF。 */
  readonly fileBytes?: Uint8Array;
}

function build(script: Script) {
  const createCalls: unknown[] = [];
  const getCalls: unknown[] = [];
  let getIndex = 0;
  const pdf = script.fileBytes;

  const client = {
    packageLabelCreate: vi.fn(async (_auth: unknown, _storeId: string, ids: readonly string[]) => {
      createCalls.push([...ids]);
      if (script.createError !== undefined) {
        throw script.createError;
      }
      return { tasks: script.tasks ?? [] };
    }),
    packageLabelGet: vi.fn(async (_auth: unknown, _storeId: string, taskId: number | string) => {
      getCalls.push(taskId);
      const code =
        script.statuses?.[Math.min(getIndex, (script.statuses?.length ?? 1) - 1)] ?? 'completed';
      getIndex += 1;
      return {
        file_url: code === 'completed' ? 'https://cdn.example/ozon-label.pdf' : undefined,
        status: {
          code,
          printed_postings_count: script.printed,
          postings_count: script.printed,
          unprinted_postings: script.unprinted ?? [],
        },
      };
    }),
    downloadFile: vi.fn(async () => ({
      contentType: 'application/octet-stream',
      bytes: pdf ?? (await makeCombinedPdf(2)),
    })),
  } as unknown as OzonClient;

  const service = new OzonShipmentService(client, LOGGER);
  // 轮询等待由测试接管，避免真的等 9 秒。
  (service as unknown as { wait: () => Promise<void> }).wait = async () => undefined;
  return { service, createCalls, getCalls, client };
}

const TWO_TASKS = [{ task_id: 550492178, task_type: 'small_label' }];

describe('OzonShipmentService.fetchShippingLabels (批量取单)', () => {
  it('一次 create 建任务，按请求顺序把合并 PDF 拆成一单一页', async () => {
    const { service, createCalls, getCalls } = build({
      tasks: TWO_TASKS,
      printed: 2,
      fileBytes: await makeCombinedPdf(2),
    });

    const files = await service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']);

    expect(createCalls).toEqual([['posting-1', 'posting-2']]);
    expect(getCalls).toEqual([550492178]);
    expect(files.map((entry) => entry.platformOrderId)).toEqual(['posting-1', 'posting-2']);
    for (const entry of files) {
      const doc = await PDFDocument.load(entry.file.bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it('任务 pending → 轮询到 completed 再下载（不是失败）', async () => {
    const { service, getCalls } = build({
      tasks: TWO_TASKS,
      statuses: ['pending', 'in_progress', 'completed'],
      printed: 2,
      fileBytes: await makeCombinedPdf(2),
    });

    const files = await service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']);

    expect(getCalls).toHaveLength(3);
    expect(files).toHaveLength(2);
  });

  it('页数与订单数不一致 → PlatformBatchShapeError（调用方降级逐单）', async () => {
    const { service } = build({
      tasks: TWO_TASKS,
      printed: 2,
      fileBytes: await makeCombinedPdf(1),
    });

    await expect(
      service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']),
    ).rejects.toBeInstanceOf(PlatformBatchShapeError);
  });

  it('部分单未打印（unprinted_postings 非空）→ PlatformBatchShapeError，不猜页序', async () => {
    const { service } = build({
      tasks: TWO_TASKS,
      printed: 1,
      unprinted: [{ posting_number: 'posting-2', message: 'posting is not in awaiting_deliver' }],
      fileBytes: await makeCombinedPdf(1),
    });

    await expect(
      service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2']),
    ).rejects.toBeInstanceOf(PlatformBatchShapeError);
  });

  it('create 返回空任务 → 空数组（未就绪，不是错误）', async () => {
    const { service } = build({ tasks: [] });

    await expect(service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2'])).resolves.toEqual(
      [],
    );
  });

  it('平台答「这些单现在取不到面单」→ 空数组（不是错误）', async () => {
    const { service } = build({
      createError: new PlatformApiError({
        code: 'PLATFORM_API_ERROR',
        message: 'OZON error 3: NO_POSTINGS_FOR_BATCH_DOWNLOAD',
        endpoint: '/v3/posting/fbs/package-label/create',
        storeId: 'store-1',
        httpStatus: 400,
        requestId: null,
      }),
    });

    await expect(service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2'])).resolves.toEqual(
      [],
    );
  });

  it('限流（429）原样上抛，调用方不得逐单重试把它放大', async () => {
    const rateLimited = new PlatformApiError({
      code: 'PLATFORM_RATE_LIMITED',
      message:
        'Rate limited by OZON (OZON error 8: You have reached request rate limit per second)',
      endpoint: '/v3/posting/fbs/package-label/create',
      storeId: 'store-1',
      httpStatus: 429,
      requestId: null,
    });
    const { service } = build({ createError: rateLimited });

    await expect(service.fetchShippingLabels(CONTEXT, ['posting-1', 'posting-2'])).rejects.toBe(
      rateLimited,
    );
  });

  it('空 id 列表不调用平台', async () => {
    const { service, createCalls } = build({ tasks: TWO_TASKS });

    await expect(service.fetchShippingLabels(CONTEXT, [])).resolves.toEqual([]);
    expect(createCalls).toHaveLength(0);
  });
});
