import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { OrderService } from '../../order/services/order.service';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import { ShippingLabelRepository } from '../repositories/shipping-label.repository';
import { ShipmentService } from './shipment.service';

const OPERATOR: OperatorContext = { userId: 'u1', username: 'tester' };

function build(updated: Array<{ id: string; shipmentNo: string }>) {
  const shipmentRepo = { fillMissingTracking: vi.fn(async () => updated) };
  const operationLog = { record: vi.fn(async () => undefined) };
  const service = new ShipmentService(
    {} as DataSource,
    shipmentRepo as unknown as ShipmentRepository,
    {} as PackageRepository,
    {} as ShippingLabelRepository,
    {} as OrderService,
    {} as SkuService,
    {} as WarehouseService,
    operationLog as unknown as OperationLogService,
    {} as ObjectStorageService,
  );
  return { service, shipmentRepo, operationLog };
}

describe('ShipmentService.backfillTrackingForOrder (2026-10-21)', () => {
  it('把订单运单号写入仍为空的发货单并留审计日志', async () => {
    const { service, shipmentRepo, operationLog } = build([
      { id: 'ship-1', shipmentNo: 'SHP00000074' },
    ]);

    await expect(
      service.backfillTrackingForOrder('order-1', ' 86427263-0106-1 ', OPERATOR),
    ).resolves.toBe(1);

    expect(shipmentRepo.fillMissingTracking).toHaveBeenCalledWith('order-1', '86427263-0106-1');
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SHIPMENT',
        entityId: 'ship-1',
        entityCode: 'SHP00000074',
        action: 'SYNC_PLATFORM_TRACKING',
        changes: { trackingNumber: { from: null, to: '86427263-0106-1' } },
      }),
    );
  });

  it('空运单号直接 no-op（不触库）', async () => {
    const { service, shipmentRepo, operationLog } = build([]);

    await expect(service.backfillTrackingForOrder('order-1', '   ', OPERATOR)).resolves.toBe(0);

    expect(shipmentRepo.fillMissingTracking).not.toHaveBeenCalled();
    expect(operationLog.record).not.toHaveBeenCalled();
  });

  it('没有可回填的发货单时不写日志', async () => {
    const { service, operationLog } = build([]);

    await expect(service.backfillTrackingForOrder('order-1', 'OZ123', OPERATOR)).resolves.toBe(0);

    expect(operationLog.record).not.toHaveBeenCalled();
  });
});
