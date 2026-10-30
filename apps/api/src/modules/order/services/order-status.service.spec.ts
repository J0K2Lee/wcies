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
    unitPrice: null,
    totalPrice: null,
    platformImageUrl: null,
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
    platformStage: null,
    platformStageChangedAt: null,
    platformFactsCheckedAt: null,
    erpStatus,
    fulfillmentMode: null,
    currency: null,
    orderedAt: new Date(),
    shipmentDeadline: null,
    platformTrackingNo: null,
    rawData: null,
    remark: null,
    isUrgent: false,
    urgentMarkedAt: null,
    labelPrintedAt: null,
    externalFulfilledAt: null,
    externalFulfillmentReason: null,
    syncSource: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService(input: {
  order: OrderEntity;
  items: OrderItemEntity[];
  activePickingItems?: number;
  lastStatusOtherThanException?: string | null;
}) {
  const transaction = vi
    .fn()
    .mockImplementation((work: (manager: unknown) => Promise<void>) => work({}));
  const dataSource = { transaction } as unknown as DataSource;
  const orderRepo = {
    findById: vi.fn().mockResolvedValue(input.order),
    updateErpStatus: vi.fn().mockResolvedValue(undefined),
    clearUrgent: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrderRepository;
  const itemRepo = {
    findByOrderId: vi.fn().mockResolvedValue(input.items),
  } as unknown as OrderItemRepository;
  const insert = vi.fn().mockResolvedValue(undefined);
  const historyRepo = {
    insert,
    findLastStatusOtherThan: vi.fn().mockResolvedValue(input.lastStatusOtherThanException ?? null),
  } as unknown as OrderStatusHistoryRepository;
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

describe('OrderStatusService.transition：发货后移除加急（2026-10-27 用户指示）', () => {
  it('转 SHIPPED 时清 is_urgent（与状态变更同一事务）', async () => {
    const { service, orderRepo } = buildService({ order: makeOrder('PICKED'), items: [] });

    await service.transition('order-1', 'SHIPPED', { userId: null, username: 't' }, '拣货完成');

    expect(orderRepo.updateErpStatus).toHaveBeenCalledWith({}, 'order-1', 'SHIPPED');
    expect(orderRepo.clearUrgent).toHaveBeenCalledWith({}, 'order-1');
  });

  it('其他状态迁移不动加急标记', async () => {
    const { service, orderRepo } = buildService({ order: makeOrder('NEW'), items: [] });

    await service.transition('order-1', 'CANCELLED', { userId: null, username: 't' }, '平台取消');

    expect(orderRepo.clearUrgent).not.toHaveBeenCalled();
  });
});

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

  it('全 EXTERNAL_FULFILLED 且无 FAILED 行：陈旧 EXCEPTION 回落持有态 NEW（2026-10-16 FBP 映射修复）', async () => {
    // 现实来源：FBP 订单摄入时 SKU 尚未建档 → 行 FAILED、订单 EXCEPTION；运营
    // 补齐映射后行转 MAPPED+EXTERNAL_FULFILLED、映射异常关闭。此前 rollup 的
    // 「无可履约行」分支无条件返回 current，把陈旧 EXCEPTION 保留（其成立前提
    // 「存在 FAILED 行」已消失）→ 订单卡在异常（真实样本 ORD00000207）。
    const { service } = buildService({
      order: makeOrder('EXCEPTION'),
      items: [makeItem('EXTERNAL_FULFILLED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('NEW');
  });

  it('全 EXTERNAL_FULFILLED 且无 FAILED 行：非 EXCEPTION 的当前态保持不变（等平台事件）', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('EXTERNAL_FULFILLED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('NEW');
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

  it('FAILED 行已被释放（外部履约/取消）不再把已发货订单翻回 EXCEPTION（2026-10-20）', async () => {
    // 现实来源 ORD00000065：行从未映射（FAILED），运营用「标记外部履约」
    // 把订单按平台事实置 SHIPPED，行随之 RELEASED。此后任何一次 rollup
    // 重算都被旧规则按「存在 FAILED 行」判回 EXCEPTION —— 状态倒退。
    const released = buildService({
      order: makeOrder('SHIPPED'),
      items: [makeItem('RELEASED', 'FAILED')],
    });
    await expect(
      released.service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('SHIPPED');

    const external = buildService({
      order: makeOrder('SHIPPED'),
      items: [makeItem('EXTERNAL_FULFILLED', 'FAILED')],
    });
    await expect(
      external.service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('SHIPPED');
  });

  it('未释放的 FAILED 行仍然阻塞（映射异常不能被静默忽略）', async () => {
    const { service } = buildService({
      order: makeOrder('NEW'),
      items: [makeItem('PENDING', 'FAILED')],
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('EXCEPTION');
  });

  it('EXCEPTION 前提消失时恢复到历史中的真实状态（SHIPPED），而不是 NEW', async () => {
    // 已被 2026-10-20 旧规则误判回 EXCEPTION 的订单，在映射修复/同步再遇时
    // 必须回到 SHIPPED；回落 NEW 会把已发货订单塞回「待处理」。
    const { service } = buildService({
      order: makeOrder('EXCEPTION'),
      items: [makeItem('RELEASED', 'MAPPED')],
      lastStatusOtherThanException: 'SHIPPED',
    });
    await expect(
      service.recomputeOrderStatus('order-1', { userId: null, username: 't' }, 'r'),
    ).resolves.toBe('SHIPPED');
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
