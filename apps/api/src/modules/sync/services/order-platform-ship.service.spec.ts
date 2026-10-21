import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { StoreContext } from '@wcies/platform-contracts';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OrderService } from '../../order/services/order.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { ShippingLabelService } from '../../shipment/services/shipping-label.service';
import { ShippingLabelDto } from '../../shipment/dto/shipment.dto';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { SyncContextService } from './sync-context.service';
import {
  OrderLabelNotPrintableError,
  OrderPlatformShipService,
  PlatformLabelNotReadyError,
} from './order-platform-ship.service';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';
import { PlatformBatchShapeError } from '../../integration/platform-error';
import { LabelPrefetchService } from './label-prefetch.service';

/**
 * OrderPlatformShipService unit tests.
 *
 * The adapters here are CLASS instances whose capability methods read `this.*`
 * internal state on purpose: the capability lookup must return a method still
 * bound to its adapter. A detached reference ran with `this === undefined` in
 * production (500 on 「获取运单号」) while every arrow-property mock stayed green -
 * this spec pins the regression.
 */

const OPERATOR: OperatorContext = { userId: 'u1', username: 'tester' };
const CONTEXT: StoreContext = {
  storeId: 'store-1',
  storeCode: 'OZ-124',
  platform: 'OZON',
  credential: {},
};

const ORDER = {
  id: 'order-1',
  orderNo: 'ORD00000018',
  storeId: 'store-1',
  platformOrderId: '56089221-0064-1',
  platformStatus: 'awaiting_packaging',
  platformTrackingNo: null as string | null,
  erpStatus: 'READY_TO_PICK',
  platformStage: 'AWAITING_SHIPMENT' as string | null,
};

/** Real prototype methods (not arrow properties) so `this` binding matters. */
class PreparableAdapter {
  readonly platformCode = 'OZON' as const;
  private readonly secret = 'adapter-internal';

  async prepareShipment(
    _context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<{
    platformOrderId: string;
    trackingNumber: string | null;
    platformStatus: string | null;
    alreadyPrepared: boolean;
  }> {
    if (this.secret !== 'adapter-internal') {
      throw new Error('this is not the adapter instance');
    }
    return {
      platformOrderId: order.platformOrderId,
      trackingNumber: 'OZ75001234',
      platformStatus: 'awaiting_deliver',
      alreadyPrepared: false,
    };
  }

  async fetchShippingLabel(): Promise<{ fileName: string; mimeType: string; bytes: Uint8Array }> {
    if (this.secret !== 'adapter-internal') {
      throw new Error('this is not the adapter instance');
    }
    return { fileName: 'label.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) };
  }
}

class BareAdapter {
  readonly platformCode = 'WB' as const;
}

function makeService(adapter: object, order = ORDER) {
  const syncContext = {
    resolveSyncableStore: vi.fn(async () => ({ store: { id: order.storeId }, adapter })),
    buildStoreContext: vi.fn(async () => CONTEXT),
  };
  const orderService = {
    getOrderOrThrow: vi.fn(async (_id: string) => order),
    applySyncedPlatformFacts: vi.fn(async () => ({ ...order, platformTrackingNo: 'OZ75001234' })),
    // 批量打单按列表排序重排 id（2026-10-19）；默认原样返回。
    findIdsInListOrder: vi.fn(async (ids: readonly string[]) => [...ids]),
  };
  const exceptionService = {
    resolveByReference: vi.fn(async () => undefined),
    create: vi.fn(async () => ({})),
  };
  const labelService = {
    findLatestOrderLabel: vi.fn(
      async () => null as Awaited<ReturnType<ShippingLabelService['findLatestOrderLabel']>>,
    ),
    createPlatformLabelForOrder: vi.fn(async () => ({
      id: 'label-1',
      signedUrl: 'https://s3/l.pdf',
    })),
    listByOrder: vi.fn(async () => []),
    // 批量打印会读取面单字节做合并；默认给空字节（仅批量用例覆盖为真实 PDF）。
    bytesOfLabel: vi.fn(async () => Buffer.alloc(0)),
  };
  const operationLog = { record: vi.fn(async () => undefined) };
  const logger = { log: vi.fn(), warn: vi.fn() };
  const config = {
    get: vi.fn((key: string) => (key === 'app.label.batchFetchChunk' ? 20 : undefined)),
  };
  const labelPrefetch = {
    delayMs: vi.fn(() => 60_000),
    enqueueForOrder: vi.fn(async () => undefined),
    enqueueBatch: vi.fn(async () => undefined),
    enqueueFromSync: vi.fn(async () => undefined),
  };
  const service = new OrderPlatformShipService(
    syncContext as unknown as SyncContextService,
    orderService as unknown as OrderService,
    exceptionService as unknown as ExceptionService,
    labelService as unknown as ShippingLabelService,
    operationLog as unknown as OperationLogService,
    logger as unknown as AppLoggerService,
    config as unknown as ConfigService,
    labelPrefetch as unknown as LabelPrefetchService,
  );
  return {
    service,
    orderService,
    exceptionService,
    labelService,
    operationLog,
    syncContext,
    labelPrefetch,
  };
}

describe('OrderPlatformShipService.prepareShipment', () => {
  it('calls the adapter capability bound to its instance and persists the platform facts', async () => {
    // fetchOrdersByPlatformIds absent → the preparation result is used as-is.
    const { service, orderService, exceptionService } = makeService(new PreparableAdapter());

    const result = await service.prepareShipment('order-1', OPERATOR);

    expect(result).toMatchObject({
      platformCode: 'OZON',
      trackingNumber: 'OZ75001234',
      platformStatus: 'awaiting_deliver',
      alreadyPrepared: false,
      platformWritePerformed: true,
    });
    expect(orderService.applySyncedPlatformFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        platformOrderId: ORDER.platformOrderId,
        platformTrackingNo: 'OZ75001234',
        source: 'MANUAL',
      }),
      OPERATOR,
    );
    // A successful prepare clears any OPEN failure alert for this order.
    expect(exceptionService.resolveByReference).toHaveBeenCalledWith({
      exceptionType: 'ORDER_PLATFORM_SHIP_FAILED',
      referenceType: 'ORDER',
      referenceId: ORDER.id,
    });
  });

  it('passes the async acceptance through as a success (assemblyPending), no exception row', async () => {
    // OZON 组包是异步的：平台受理但未确认属于正常结果，不得建异常，
    // 操作日志记 PLATFORM_SHIP_SUBMITTED，platformWritePerformed 为 false。
    const { service, exceptionService, operationLog } = makeService({
      platformCode: 'OZON',
      async prepareShipment() {
        return {
          platformOrderId: ORDER.platformOrderId,
          trackingNumber: null,
          platformStatus: 'awaiting_packaging',
          alreadyPrepared: false,
          assemblyPending: true,
        };
      },
    });

    const result = await service.prepareShipment('order-1', OPERATOR);

    expect(result.assemblyPending).toBe(true);
    expect(result.platformWritePerformed).toBe(false);
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PLATFORM_SHIP_SUBMITTED', operator: OPERATOR }),
    );
    // Pending 不是失败：只走 resolve（清旧告警），不走 create（建新告警）。
    expect(exceptionService.create).not.toHaveBeenCalled();
  });

  it('throws PLATFORM_CAPABILITY_UNSUPPORTED when the platform lacks the capability', async () => {
    const { service } = makeService(new BareAdapter());

    await expect(service.prepareShipment('order-1', OPERATOR)).rejects.toBeInstanceOf(
      PlatformCapabilityUnsupportedError,
    );
  });
});

describe('OrderPlatformShipService.fetchShippingLabel', () => {
  it('returns a stored label without touching the platform when one exists', async () => {
    const stored: ShippingLabelDto = {
      id: 'label-0',
      shipmentId: null,
      orderId: ORDER.id,
      packageId: null,
      labelType: 'SHIPPING',
      fileName: 'label.pdf',
      mimeType: 'application/pdf',
      fileSize: 3,
      source: 'PLATFORM_API',
      externalLabelId: ORDER.platformOrderId,
      createdAt: new Date('2026-10-09T00:00:00Z'),
      signedUrl: 'https://s3/stored.pdf',
    };
    const { service, labelService, syncContext } = makeService(new PreparableAdapter());
    labelService.findLatestOrderLabel.mockResolvedValueOnce(stored);

    await expect(service.fetchShippingLabel('order-1', { refresh: false }, OPERATOR)).resolves.toBe(
      stored,
    );
    expect(syncContext.resolveSyncableStore).not.toHaveBeenCalled();
  });

  it('archives the platform label bound to the adapter instance', async () => {
    const { service, labelService } = makeService(new PreparableAdapter());

    await service.fetchShippingLabel('order-1', { refresh: false }, OPERATOR);

    expect(labelService.createPlatformLabelForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER.id, fileName: 'label.pdf' }),
      OPERATOR,
    );
  });

  it('reports a 409 when the platform has no label yet', async () => {
    const { service } = makeService({
      platformCode: 'OZON',
      fetchShippingLabel: async () => null,
    });

    await expect(
      service.fetchShippingLabel('order-1', { refresh: true }, OPERATOR),
    ).rejects.toBeInstanceOf(PlatformLabelNotReadyError);
  });
});

describe('OrderPlatformShipService.prepareShipmentBatch (2026-10-13 订单页多选批量)', () => {
  it('prepares each order via the single-order path and isolates failures', async () => {
    const { service } = makeService(new PreparableAdapter());
    const single = vi
      .spyOn(service, 'prepareShipment')
      .mockResolvedValueOnce({
        orderId: 'o1',
        orderNo: 'ORD1',
        platformCode: 'OZON',
        trackingNumber: 'OZ75001234',
        platformStatus: 'awaiting_deliver',
        alreadyPrepared: false,
        assemblyPending: false,
        platformWritePerformed: true,
      })
      .mockRejectedValueOnce(
        // 构造签名是 (platformCode, capability, reason) —— 只传文案会在 tsc
        // 报 arity 错（vitest 经 esbuild 不做类型检查，故只有 typecheck 能发现）。
        new PlatformCapabilityUnsupportedError('WB', '组包', 'WB 不支持组包（测试桩）'),
      );

    const result = await service.prepareShipmentBatch(['o1', 'o2', 'o1'], OPERATOR);

    // 重复 id 只执行一次；平台能力失败的单不拖垮整批。
    expect(single).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(result.results[0]).toMatchObject({
      orderId: 'o1',
      ok: true,
      trackingNumber: 'OZ75001234',
    });
    expect(result.results[1]).toMatchObject({ orderId: 'o2', ok: false, orderNo: null });
    expect(result.results[1]?.code).toBe('PLATFORM_CAPABILITY_UNSUPPORTED');
  });
});

describe('OrderPlatformShipService.fetchShippingLabelBatch (2026-10-17 批量打印面单)', () => {
  it('取每单面单（复用存档）、去重，并把单笔失败隔离出来', async () => {
    const { service, orderService } = makeService(new PreparableAdapter());
    const single = vi
      .spyOn(service, 'fetchShippingLabel')
      .mockResolvedValueOnce({
        id: 'label-1',
        signedUrl: 'https://s3/l1.pdf',
        fileName: 'label-1.pdf',
      } as ShippingLabelDto)
      .mockRejectedValueOnce(
        new PlatformLabelNotReadyError({
          orderId: 'o2',
          platformOrderId: ORDER.platformOrderId,
        }),
      );

    const result = await service.fetchShippingLabelBatch(
      ['o1', 'o2', 'o1'],
      { refresh: false },
      OPERATOR,
    );

    // 重复 id 只取一次；默认复用本地存档（refresh=false）。
    expect(single).toHaveBeenCalledTimes(2);
    expect(single).toHaveBeenCalledWith('o1', { refresh: false }, OPERATOR);
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(result.results[0]).toMatchObject({
      orderId: 'o1',
      orderNo: ORDER.orderNo,
      ok: true,
      signedUrl: 'https://s3/l1.pdf',
      fileName: 'label-1.pdf',
    });
    expect(result.results[1]).toMatchObject({ orderId: 'o2', ok: false, signedUrl: null });
    expect(result.results[1]?.code).toBe('PLATFORM_LABEL_NOT_READY');
    // 失败单也带可读订单号（先读了一次订单）。
    expect(orderService.getOrderOrThrow).toHaveBeenCalledTimes(2);
    // 取面单前先按列表排序重排（去重后的 id）。
    expect(orderService.findIdsInListOrder).toHaveBeenCalledWith(
      ['o1', 'o2'],
      undefined,
      undefined,
    );
  });

  it('按列表当前排序确定面单顺序（合并页序与列表一致）', async () => {
    const { service, orderService } = makeService(new PreparableAdapter());
    // 列表排序把 o2 排在 o1 前面。
    orderService.findIdsInListOrder.mockResolvedValue(['o2', 'o1']);
    const single = vi.spyOn(service, 'fetchShippingLabel').mockResolvedValue({
      id: 'label-1',
      signedUrl: 'https://s3/l.pdf',
      fileName: 'l.pdf',
    } as ShippingLabelDto);

    await service.fetchShippingLabelBatch(
      ['o1', 'o2'],
      { refresh: false, sortBy: 'skuCode', sortOrder: 'asc' },
      OPERATOR,
    );

    expect(orderService.findIdsInListOrder).toHaveBeenCalledWith(['o1', 'o2'], 'skuCode', 'asc');
    expect(single.mock.calls.map((call) => call[0])).toEqual(['o2', 'o1']);
  });

  it('把成功面单合并成一个 PDF，并保留 OZON 面单原纸张尺寸', async () => {
    const { service, labelService } = makeService(new PreparableAdapter());
    // OZON 实测面单纸张：57.9mm × 40mm。
    const doc = await PDFDocument.create();
    doc.addPage([(57.9 * 72) / 25.4, (40 * 72) / 25.4]);
    const labelBytes = Buffer.from(await doc.save());
    labelService.bytesOfLabel.mockResolvedValue(labelBytes);
    vi.spyOn(service, 'fetchShippingLabel').mockResolvedValue({
      id: 'label-1',
      signedUrl: 'https://s3/l1.pdf',
      fileName: 'label-1.pdf',
    } as ShippingLabelDto);

    const result = await service.fetchShippingLabelBatch(['o1'], { refresh: false }, OPERATOR);

    expect(result.mergedPageCount).toBe(1);
    expect(result.mergedPdfBase64).not.toBeNull();
    const merged = await PDFDocument.load(Buffer.from(result.mergedPdfBase64 as string, 'base64'));
    const { width, height } = merged.getPage(0).getSize();
    expect(((width / 72) * 25.4).toFixed(1)).toBe('57.9');
    expect(((height / 72) * 25.4).toFixed(1)).toBe('40.0');
  });
});

// ---------------------------------------------------------------------------
// 2026-10-21：终态禁打 / 批量取单 / 组包后预取
// ---------------------------------------------------------------------------

/** Adapter exposing the batched label capability (one call for the chunk). */
class BatchLabelAdapter {
  readonly platformCode = 'OZON' as const;
  readonly batchCalls: string[][] = [];

  async fetchShippingLabel(): Promise<{
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }> {
    return { fileName: 'single.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]) };
  }

  async fetchShippingLabels(
    _context: unknown,
    platformOrderIds: readonly string[],
  ): Promise<
    Array<{
      platformOrderId: string;
      file: { fileName: string; mimeType: string; bytes: Uint8Array };
    }>
  > {
    this.batchCalls.push([...platformOrderIds]);
    return platformOrderIds.map((platformOrderId) => ({
      platformOrderId,
      file: {
        fileName: `${platformOrderId}.pdf`,
        mimeType: 'application/pdf',
        bytes: new Uint8Array([1, 2]),
      },
    }));
  }
}

function orderById(id: string, overrides: Record<string, unknown> = {}) {
  return { ...ORDER, id, platformOrderId: `posting-${id}`, ...overrides };
}

describe('OrderPlatformShipService 终态禁打 (2026-10-21)', () => {
  it.each([
    ['CANCELLED', 'AWAITING_SHIPMENT'],
    ['SHIPPED', 'DELIVERED'],
  ])('erp=%s + stage=%s 拒绝打单，且不读存档/不调平台', async (erpStatus, platformStage) => {
    const { service, labelService, syncContext } = makeService(new PreparableAdapter(), {
      ...ORDER,
      erpStatus,
      platformStage,
    });

    await expect(
      service.fetchShippingLabel('order-1', { refresh: false }, OPERATOR),
    ).rejects.toBeInstanceOf(OrderLabelNotPrintableError);

    expect(labelService.findLatestOrderLabel).not.toHaveBeenCalled();
    expect(syncContext.resolveSyncableStore).not.toHaveBeenCalled();
  });

  it('平台已妥投但 ERP 未 SHIPPED 的背离单仍然可以打单', async () => {
    const { service, labelService } = makeService(new PreparableAdapter(), {
      ...ORDER,
      erpStatus: 'READY_TO_PICK',
      platformStage: 'DELIVERED',
    });

    await service.fetchShippingLabel('order-1', { refresh: false }, OPERATOR);

    expect(labelService.createPlatformLabelForOrder).toHaveBeenCalled();
  });
});

describe('OrderPlatformShipService 批量取单 (2026-10-21)', () => {
  it('同一批订单只调用一次平台的批量面单能力', async () => {
    const adapter = new BatchLabelAdapter();
    const { service, orderService, labelService } = makeService(adapter);
    orderService.getOrderOrThrow.mockImplementation(async (id: string) => orderById(id));

    const result = await service.fetchShippingLabelBatch(
      ['o1', 'o2'],
      { refresh: false },
      OPERATOR,
    );

    expect(adapter.batchCalls).toEqual([['posting-o1', 'posting-o2']]);
    expect(labelService.createPlatformLabelForOrder).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0, notPrintable: 0 });
    expect(result.results.every((item) => item.ok && item.fromArchive === false)).toBe(true);
  });

  it('批量返回形状不可用 → 逐单降级，仍成功', async () => {
    class ShapeFailAdapter extends BatchLabelAdapter {
      override async fetchShippingLabels(): Promise<never> {
        throw new PlatformBatchShapeError('page count mismatch');
      }
    }
    const { service, orderService } = makeService(new ShapeFailAdapter());
    orderService.getOrderOrThrow.mockImplementation(async (id: string) => orderById(id));
    const single = vi.spyOn(service, 'fetchShippingLabel').mockResolvedValue({
      id: 'label-1',
      signedUrl: 'https://s3/l.pdf',
      fileName: 'l.pdf',
    } as ShippingLabelDto);

    const result = await service.fetchShippingLabelBatch(
      ['o1', 'o2'],
      { refresh: false },
      OPERATOR,
    );

    expect(single).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ succeeded: 2, failed: 0 });
  });

  it('终态订单被跳过并计入 notPrintable，其余照常取单', async () => {
    const { service, orderService, labelService } = makeService(new BatchLabelAdapter());
    orderService.getOrderOrThrow.mockImplementation(async (id: string) =>
      id === 'o1'
        ? orderById(id, { erpStatus: 'CANCELLED', platformStage: 'AWAITING_SHIPMENT' })
        : orderById(id),
    );
    const single = vi.spyOn(service, 'fetchShippingLabel').mockResolvedValue({
      id: 'label-1',
      signedUrl: 'https://s3/l.pdf',
      fileName: 'l.pdf',
    } as ShippingLabelDto);

    const result = await service.fetchShippingLabelBatch(
      ['o1', 'o2'],
      { refresh: false },
      OPERATOR,
    );

    expect(result.results[0]).toMatchObject({
      orderId: 'o1',
      ok: false,
      code: 'ORDER_LABEL_NOT_PRINTABLE',
    });
    expect(result.notPrintable).toBe(1);
    expect(result.succeeded).toBe(1);
    // 终态单不落存档、不调平台；o2 由批量能力取到。
    expect(labelService.createPlatformLabelForOrder).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });

  it('存档复用：不再访问平台且标记 fromArchive', async () => {
    const adapter = new BatchLabelAdapter();
    const { service, orderService, labelService } = makeService(adapter);
    orderService.getOrderOrThrow.mockImplementation(async (id: string) => orderById(id));
    labelService.findLatestOrderLabel.mockResolvedValue({
      id: 'archived-1',
      signedUrl: 'https://s3/archived.pdf',
      fileName: 'archived.pdf',
    } as ShippingLabelDto);

    const result = await service.fetchShippingLabelBatch(
      ['o1', 'o2'],
      { refresh: false },
      OPERATOR,
    );

    expect(adapter.batchCalls).toEqual([]);
    expect(result.results.every((item) => item.ok && item.fromArchive)).toBe(true);
  });
});

describe('OrderPlatformShipService 组包后预取 (2026-10-21)', () => {
  it('单笔组包成功 → 入队延迟预取', async () => {
    const { service, labelPrefetch } = makeService(new PreparableAdapter());

    await service.prepareShipment('order-1', OPERATOR);

    expect(labelPrefetch.enqueueForOrder).toHaveBeenCalledWith('order-1', {
      delayMs: 60_000,
    });
  });

  it('没有运单号且非异步组包 → 不预取（避免无意义的平台调用）', async () => {
    class NotAssembledAdapter {
      readonly platformCode = 'OZON' as const;
      async prepareShipment() {
        return {
          platformOrderId: ORDER.platformOrderId,
          trackingNumber: null,
          platformStatus: 'awaiting_packaging',
          alreadyPrepared: false,
          assemblyPending: false,
        };
      }
    }
    const { service, labelPrefetch } = makeService(new NotAssembledAdapter());

    await service.prepareShipment('order-1', OPERATOR);

    expect(labelPrefetch.enqueueForOrder).not.toHaveBeenCalled();
  });

  it('批量组包只入队一个批次 job，不逐单入队', async () => {
    const { service, labelPrefetch } = makeService(new PreparableAdapter());

    await service.prepareShipmentBatch(['o1', 'o2'], OPERATOR);

    expect(labelPrefetch.enqueueForOrder).not.toHaveBeenCalled();
    expect(labelPrefetch.enqueueBatch).toHaveBeenCalledWith(['o1', 'o2'], {
      delayMs: 60_000,
    });
  });
});
