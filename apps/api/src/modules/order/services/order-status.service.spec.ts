import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderStatusService } from './order-status.service';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { OrderPickingStatePort } from '../ports/order-picking-state.port';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderEntity } from '../entities/order.entity';

function makeItem(
  fulfillmentStatus: OrderItemEntity['fulfillmentStatus'],
  mappingStatus: OrderItemEntity['mappingStatus'] = 'MAPPED',
): OrderItemEntity {
  return {
    id: `item-${fulfillmentStatus}-${Math.random().toString(36).slice(2, 6)}`,
    orderId: 'order-1',
    lineNo: 1,
    platformProductId: null,
    platformSkuId: null,
    sellerSku: null,
    offerId: null,
    listingSkuId: null,
    skuId: mappingStatus === 'FAILED' ? null : 'sku-1',
    warehouseId: null,
    quantity: '1.000',
    fulfillmentStatus,
    mappingStatus,
    reservationId: null,
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeOrder(erpStatus: OrderEntity['erpStatus']): OrderEntity {
  return {
    id: 'order-1',
    orderNo: 'ORD00000001',
    storeId: 'store-1',
    platformOrderId: 'P1',
    platformStatus: null,
    erpStatus,
    fulfillmentMode: null,
    currency: null,
    orderedAt: new Date(),
    shipmentDeadline: null,
    rawData: null,
    remark: null,
    syncSource: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService(input: {
  order: OrderEntity;
  items: OrderItemEntity[];
  activePickingItems?: number;
}) {
  const transaction = vi
    .fn()
    .mockImplementation((work: (manager: unknown) => Promise<void>) => work({}));
  const dataSource = { transaction } as unknown as DataSource;
  const orderRepo = {
    findById: vi.fn().mockResolvedValue(input.order),
    updateErpStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrderRepository;
  const itemRepo = {
    findByOrderId: vi.fn().mockResolvedValue(input.items),
  } as unknown as OrderItemRepository;
  const insert = vi.fn().mockResolvedValue(undefined);
  const historyRepo = { insert } as unknown as OrderStatusHistoryRepository;
  const countActivePickingItems = vi.fn().mockResolvedValue(input.activePickingItems ?? 0);
  const pickingState = { countActivePickingItems } as unknown as OrderPickingStatePort;
  const service = new OrderStatusService(
    dataSource,
    orderRepo,
    itemRepo,
    historyRepo,
    pickingState,
  );
  return { service, insert: historyRepo.insert, orderRepo };
}

describe('OrderStatusService rollup (orders.md §7)', () => {
  it('all fulfillable lines RESERVED -> READY_TO_PICK', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('RESERVED'), makeItem('RESERVED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('READY_TO_PICK');
  });

  it('mixed RESERVED + BACKORDERED -> PARTIALLY_BACKORDERED', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('RESERVED'), makeItem('BACKORDERED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('PARTIALLY_BACKORDERED');
  });

  it('all BACKORDERED -> BACKORDERED', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('BACKORDERED'), makeItem('BACKORDERED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('BACKORDERED');
  });

  it('open picking items -> PICKING even when other lines are reserved', async () => {
    const { service } = buildService({
      order: makeOrder('READY_TO_PICK'),
      items: [makeItem('RESERVED'), makeItem('BACKORDERED')],
      activePickingItems: 1,
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('PICKING');
  });

  it('all fulfillable PICKED -> PICKED', async () => {
    const { service } = buildService({
      order: makeOrder('PICKING'),
      items: [makeItem('PICKED'), makeItem('PICKED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('PICKED');
  });

  it('mixed PICKED + BACKORDERED -> PARTIALLY_BACKORDERED (retry can re-pick)', async () => {
    const { service } = buildService({
      order: makeOrder('PICKING'),
      items: [makeItem('PICKED'), makeItem('BACKORDERED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('PARTIALLY_BACKORDERED');
  });

  it('every line mapping FAILED (nothing fulfillable) -> EXCEPTION', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('PENDING', 'FAILED'), makeItem('PENDING', 'FAILED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('EXCEPTION');
  });

  it('mapping failures alongside fulfillable lines keep the business rollup', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('RESERVED'), makeItem('PENDING', 'FAILED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('READY_TO_PICK');
  });

  it('CANCELLED is sticky - no recompute, no history', async () => {
    const { service, insert } = buildService({
      order: makeOrder('CANCELLED'),
      items: [makeItem('RESERVED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('CANCELLED');
    expect(insert).not.toHaveBeenCalled();
  });

  it('unchanged rollup writes no duplicate history', async () => {
    const { service, insert } = buildService({
      order: makeOrder('READY_TO_PICK'),
      items: [makeItem('RESERVED')],
    });
    await service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r');
    expect(insert).not.toHaveBeenCalled();
  });

  it('transition writes from/to history via transaction', async () => {
    const { service, insert } = buildService({
      order: makeOrder('NEW'),
      items: [],
    });
    await service.transition('order-1', 'CANCELLED', { userId: 'u1', username: 'op' }, '订单取消');
    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fromStatus: 'NEW', toStatus: 'CANCELLED', reason: '订单取消' }),
    );
  });
});
