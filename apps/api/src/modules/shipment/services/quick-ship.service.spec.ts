import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { QuickShipService } from './quick-ship.service';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import { ShipmentService } from './shipment.service';
import { PackingService } from './packing.service';
import { ShipmentShipService } from './shipment-ship.service';
import { OrderService } from '../../order/services/order.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { ShipmentStateInvalidError } from '../errors/shipment.errors';

/**
 * One-click outbound orchestration (2026-09-18). The point of these tests is
 * the ORDER of operations and the idempotency guarantees - the stock movement
 * itself belongs to ShipmentShipService and is covered by its own tests.
 */

const OPERATOR = { userId: 'user-1', username: 'tester' };

interface BuildOptions {
  order?: Partial<{
    id: string;
    orderNo: string;
    erpStatus: string;
    platformTrackingNo: string | null;
  }>;
  shipments?: Array<{
    id: string;
    shipmentNo: string;
    status: string;
    trackingNumber?: string | null;
  }>;
  packages?: Record<string, Array<{ id: string; packageNo: string; status: string }>>;
}

function build(options: BuildOptions = {}) {
  const order = {
    id: 'order-1',
    orderNo: 'ORD00000001',
    erpStatus: 'PICKED',
    platformTrackingNo: 'OZ-TRACK-9',
    ...options.order,
  };
  let shipments = options.shipments ?? [];
  const packagesByShipment = options.packages ?? {};
  let orderReads = 0;

  const shipmentRepo = {
    listLiveByOrderId: vi.fn(async () => shipments),
  };
  const packageRepo = {
    listByShipmentId: vi.fn(async (shipmentId: string) => packagesByShipment[shipmentId] ?? []),
    findById: vi.fn(async (packageId: string) => ({ id: packageId, packageNo: 'PKG00000001' })),
  };
  const shipmentService = {
    createShipmentsFromOrder: vi.fn(async () => {
      shipments = [{ id: 'ship-new', shipmentNo: 'SHP00000002', status: 'READY_TO_PACK' }];
    }),
  };
  const packingService = {
    createPackage: vi.fn(async () => ({ packageId: 'pkg-new', packageNo: 'PKG00000002' })),
    ensureOpenPackage: vi.fn(async (shipmentId: string) => {
      const live = packagesByShipment[shipmentId] ?? [];
      const reusable = live.find(
        (pkg) => pkg.status === 'OPEN' || pkg.status === 'REPACK_REQUIRED',
      );
      return reusable === undefined
        ? { packageId: 'pkg-new', packageNo: 'PKG00000002', created: true }
        : { packageId: reusable.id, packageNo: reusable.packageNo, created: false };
    }),
    packAllItems: vi.fn(async () => ({ packedLineCount: 1, orderItemIds: ['item-1'] })),
    sealPackage: vi.fn(async () => undefined),
  };
  const shipService = {
    shipShipment: vi.fn(async (shipmentId: string) => ({
      shipmentId,
      alreadyShipped: false,
    })),
  };
  const orderService = {
    // First read is the pre-condition guard (returns the order as configured);
    // the second is the settled rollup read after shipping.
    getOrderOrThrow: vi.fn(async () => {
      orderReads += 1;
      return orderReads === 1 ? { ...order } : { ...order, erpStatus: 'SHIPPED' };
    }),
  };
  const service = new QuickShipService(
    {
      // Advisory-lock runner: the lock is a no-op double in unit tests.
      createQueryRunner: () => ({
        connect: async () => undefined,
        query: async () => undefined,
        release: async () => undefined,
      }),
    } as unknown as DataSource,
    shipmentRepo as unknown as ShipmentRepository,
    packageRepo as unknown as PackageRepository,
    shipmentService as unknown as ShipmentService,
    packingService as unknown as PackingService,
    shipService as unknown as ShipmentShipService,
    orderService as unknown as OrderService,
    { record: vi.fn() } as unknown as OperationLogService,
  );
  return { service, shipmentService, packingService, shipService, orderService, packageRepo };
}

describe('QuickShipService.quickShipOrder', () => {
  it('creates, packs, seals and ships when the order has no shipment yet', async () => {
    const { service, shipmentService, packingService, shipService } = build();
    const result = await service.quickShipOrder('order-1', OPERATOR);

    expect(shipmentService.createShipmentsFromOrder).toHaveBeenCalledWith('order-1', OPERATOR);
    expect(packingService.ensureOpenPackage).toHaveBeenCalledWith('ship-new', OPERATOR);
    expect(packingService.packAllItems).toHaveBeenCalledWith('pkg-new', OPERATOR);
    expect(packingService.sealPackage).toHaveBeenCalledWith('pkg-new', {}, OPERATOR);
    expect(shipService.shipShipment).toHaveBeenCalledWith(
      'ship-new',
      { trackingNumber: 'OZ-TRACK-9' },
      OPERATOR,
    );
    expect(result.shipments).toHaveLength(1);
    expect(result.orderErpStatus).toBe('SHIPPED');
  });

  it('reuses an existing live shipment instead of creating a second one', async () => {
    const { service, shipmentService, packingService } = build({
      shipments: [{ id: 'ship-1', shipmentNo: 'SHP00000001', status: 'READY_TO_SHIP' }],
    });
    await service.quickShipOrder('order-1', OPERATOR);
    expect(shipmentService.createShipmentsFromOrder).not.toHaveBeenCalled();
    // Already packed and sealed by hand: nothing to pack, still ships.
    expect(packingService.ensureOpenPackage).not.toHaveBeenCalled();
    expect(packingService.packAllItems).not.toHaveBeenCalled();
  });

  it('packs into an existing open package rather than creating another one', async () => {
    const { service, packingService } = build({
      shipments: [{ id: 'ship-1', shipmentNo: 'SHP00000001', status: 'PACKING' }],
      packages: { 'ship-1': [{ id: 'pkg-open', packageNo: 'PKG00000001', status: 'OPEN' }] },
    });
    await service.quickShipOrder('order-1', OPERATOR);
    expect(packingService.createPackage).not.toHaveBeenCalled();
    expect(packingService.packAllItems).toHaveBeenCalledWith('pkg-open', OPERATOR);
  });

  it('reports an already shipped shipment without shipping it again', async () => {
    const { service, shipService } = build({
      shipments: [{ id: 'ship-1', shipmentNo: 'SHP00000001', status: 'SHIPPED' }],
    });
    const result = await service.quickShipOrder('order-1', OPERATOR);
    expect(shipService.shipShipment).not.toHaveBeenCalled();
    expect(result.shipments[0]?.alreadyShipped).toBe(true);
  });

  it('keeps an existing shipment tracking number instead of overwriting it', async () => {
    const { service, shipService } = build({
      shipments: [
        {
          id: 'ship-1',
          shipmentNo: 'SHP00000001',
          status: 'READY_TO_SHIP',
          trackingNumber: 'MANUAL-1',
        },
      ],
    });
    await service.quickShipOrder('order-1', OPERATOR);
    expect(shipService.shipShipment).toHaveBeenCalledWith('ship-1', {}, OPERATOR);
  });

  it('omits the tracking number when the order has no platform waybill', async () => {
    const { service, shipService } = build({ order: { platformTrackingNo: null } });
    await service.quickShipOrder('order-1', OPERATOR);
    expect(shipService.shipShipment).toHaveBeenCalledWith('ship-new', {}, OPERATOR);
  });

  it('refuses a cancelled order', async () => {
    const { service, shipmentService } = build({ order: { erpStatus: 'CANCELLED' } });
    await expect(service.quickShipOrder('order-1', OPERATOR)).rejects.toThrow(
      ShipmentStateInvalidError,
    );
    expect(shipmentService.createShipmentsFromOrder).not.toHaveBeenCalled();
  });
});
