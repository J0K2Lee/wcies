import { describe, expect, it, vi } from 'vitest';
import { StoreContext } from '@wcies/platform-contracts';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OrderService } from '../../order/services/order.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { ShippingLabelService } from '../../shipment/services/shipping-label.service';
import { ShippingLabelDto } from '../../shipment/dto/shipment.dto';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { SyncContextService } from './sync-context.service';
import {
  OrderPlatformShipService,
  PlatformLabelNotReadyError,
} from './order-platform-ship.service';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';

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
    getOrderOrThrow: vi.fn(async () => order),
    applySyncedPlatformFacts: vi.fn(async () => ({ ...order, platformTrackingNo: 'OZ75001234' })),
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
  };
  const operationLog = { record: vi.fn(async () => undefined) };
  const logger = { log: vi.fn(), warn: vi.fn() };
  const service = new OrderPlatformShipService(
    syncContext as unknown as SyncContextService,
    orderService as unknown as OrderService,
    exceptionService as unknown as ExceptionService,
    labelService as unknown as ShippingLabelService,
    operationLog as unknown as OperationLogService,
    logger as unknown as AppLoggerService,
  );
  return { service, orderService, exceptionService, labelService, operationLog, syncContext };
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
