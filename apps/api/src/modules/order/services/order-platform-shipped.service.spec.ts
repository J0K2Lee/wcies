import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderPlatformShippedService } from './order-platform-shipped.service';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { ExceptionService } from '../../exception/services/exception.service';
import { OrderStatusService } from './order-status.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';

const OPERATOR = { userId: null, username: 'test' };

function makeOrder(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return {
    id: 'order-1',
    orderNo: 'ORD00000001',
    storeId: 'store-1',
    platformOrderId: 'posting-1',
    erpStatus: 'BACKORDERED',
    fulfillmentMode: 'RFBS',
    platformStatus: 'delivering',
    platformStage: 'IN_TRANSIT',
    platformStageChangedAt: null,
    ...overrides,
    // Partial 展开会把可空字段放宽成 `| undefined`，与 OrderEntity 的
    // `Date | null` 不兼容——与本仓其他 spec 一致用断言收口（仅测试夹具）。
  } as OrderEntity;
}

function makeItem(overrides: Partial<OrderItemEntity> = {}): OrderItemEntity {
  return {
    id: 'item-1',
    orderId: 'order-1',
    lineNo: 1,
    platformProductId: null,
    platformSkuId: null,
    sellerSku: null,
    offerId: null,
    listingSkuId: null,
    skuId: 'sku-1',
    warehouseId: null,
    quantity: '1.000',
    unitPrice: null,
    totalPrice: null,
    platformImageUrl: null,
    fulfillmentStatus: 'BACKORDERED',
    mappingStatus: 'MAPPED',
    reservationId: null,
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(items: OrderItemEntity[]) {
  const transaction = vi
    .fn()
    .mockImplementation((work: (manager: unknown) => Promise<unknown>) => work({}));
  const itemRepo = {
    findByOrderId: vi.fn().mockResolvedValue(items),
    updateFulfillment: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrderItemRepository;
  const exceptionService = {
    resolveByReferenceInTx: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExceptionService;
  const statusService = {
    transition: vi.fn().mockResolvedValue(undefined),
    recomputeOrderStatus: vi.fn().mockResolvedValue('EXCEPTION'),
  } as unknown as OrderStatusService;
  const service = new OrderPlatformShippedService(
    { transaction } as unknown as DataSource,
    itemRepo,
    exceptionService,
    statusService,
  );
  return { service, itemRepo, exceptionService, statusService };
}

/**
 * 平台已事实发货的收敛（用户指示 2026-10-14）：OZON 同步到的
 * delivering / delivered 订单不得再被缺货阻塞——缺货行转外部履约完成、
 * 缺货/时限异常关闭；除未映射异常外不阻塞。
 */
describe('OrderPlatformShippedService.apply', () => {
  it('moves the backordered line to EXTERNAL_FULFILLED, closes the stock exception and ships the order', async () => {
    const { service, itemRepo, exceptionService, statusService } = build([
      makeItem({ fulfillmentStatus: 'BACKORDERED' }),
    ]);

    const outcome = await service.apply(
      makeOrder(),
      OPERATOR,
      '平台已事实发货（stage IN_TRANSIT）',
    );

    expect(outcome).toEqual({ shipped: true, erpStatus: 'SHIPPED' });
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
    expect(exceptionService.resolveByReferenceInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        exceptionType: 'ORDER_OUT_OF_STOCK',
        referenceType: 'ORDER_ITEM',
        referenceId: 'item-1',
      }),
    );
    // 订单级发货时限警报同样关闭：货物已上车，时限不再构成内部压力。
    expect(exceptionService.resolveByReferenceInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        exceptionType: 'ORDER_SHIPMENT_DEADLINE_NEAR',
        referenceType: 'ORDER',
        referenceId: 'order-1',
      }),
    );
    expect(statusService.transition).toHaveBeenCalledWith(
      'order-1',
      'SHIPPED',
      OPERATOR,
      expect.stringContaining('平台已事实发货'),
    );
    expect(statusService.recomputeOrderStatus).not.toHaveBeenCalled();
  });

  it('converges a PENDING (never allocated) mapped line as well', async () => {
    const { service, itemRepo, statusService } = build([
      makeItem({ fulfillmentStatus: 'PENDING' }),
    ]);

    const outcome = await service.apply(makeOrder(), OPERATOR, '平台已事实发货');

    expect(outcome.shipped).toBe(true);
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
    expect(statusService.transition).toHaveBeenCalled();
  });

  it('keeps the order blocked by the unmapped exception when a FAILED line remains', async () => {
    const failed = makeItem({ id: 'item-2', lineNo: 2, mappingStatus: 'FAILED' });
    const { service, itemRepo, statusService } = build([
      makeItem({ fulfillmentStatus: 'BACKORDERED' }),
      failed,
    ]);

    const outcome = await service.apply(
      makeOrder({ erpStatus: 'EXCEPTION' }),
      OPERATOR,
      '平台已事实发货',
    );

    // 缺货行照样收敛（不再被缺货阻塞），但订单不转 SHIPPED——未映射异常
    // 是唯一被允许的阻塞（用户指示 2026-10-14）。
    expect(outcome).toEqual({ shipped: false, erpStatus: 'EXCEPTION' });
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
    expect(itemRepo.updateFulfillment).not.toHaveBeenCalledWith(
      expect.anything(),
      'item-2',
      expect.anything(),
    );
    expect(statusService.transition).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      OPERATOR,
      expect.stringContaining('未映射'),
    );
  });

  it('never transitions a CANCELLED order', async () => {
    const { service, statusService } = build([makeItem({ fulfillmentStatus: 'BACKORDERED' })]);

    const outcome = await service.apply(
      makeOrder({ erpStatus: 'CANCELLED' }),
      OPERATOR,
      '平台已事实发货',
    );

    expect(outcome).toEqual({ shipped: false, erpStatus: 'CANCELLED' });
    expect(statusService.transition).not.toHaveBeenCalled();
  });

  it('is idempotent for an already SHIPPED order (no second transition)', async () => {
    const { service, itemRepo, statusService } = build([
      makeItem({ fulfillmentStatus: 'EXTERNAL_FULFILLED' }),
    ]);

    const outcome = await service.apply(
      makeOrder({ erpStatus: 'SHIPPED' }),
      OPERATOR,
      '平台已事实发货',
    );

    expect(outcome).toEqual({ shipped: true, erpStatus: 'SHIPPED' });
    expect(itemRepo.updateFulfillment).not.toHaveBeenCalled();
    expect(statusService.transition).not.toHaveBeenCalled();
  });

  it('leaves lines that hold internal stock (RESERVED / PICKED) untouched', async () => {
    const { service, itemRepo } = build([
      makeItem({ id: 'item-1', fulfillmentStatus: 'RESERVED', reservationId: 'rsv-1' }),
      makeItem({ id: 'item-2', lineNo: 2, fulfillmentStatus: 'PICKED' }),
      makeItem({ id: 'item-3', lineNo: 3, fulfillmentStatus: 'BACKORDERED' }),
    ]);

    await service.apply(makeOrder(), OPERATOR, '平台已事实发货');

    expect(itemRepo.updateFulfillment).toHaveBeenCalledTimes(1);
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), 'item-3', {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
  });

  it('does not auto-ship while internal fulfillment is in progress (RESERVED / PICKED lines)', async () => {
    // 双轴差异协议（orders.md §7a.8 / §8A）：货可能还在我们仓内，平台状态
    // 与现实谁对谁错留给人判——不自动关账，但缺货部分照样收敛。
    const { service, itemRepo, statusService } = build([
      makeItem({ id: 'item-1', fulfillmentStatus: 'RESERVED', reservationId: 'rsv-1' }),
      makeItem({ id: 'item-2', lineNo: 2, fulfillmentStatus: 'BACKORDERED' }),
    ]);

    const outcome = await service.apply(
      makeOrder({ erpStatus: 'PARTIALLY_BACKORDERED' }),
      OPERATOR,
      '平台已事实发货',
    );

    // recomputeOrderStatus 在本单测里桩返回 EXCEPTION；真实 rollup 会按
    // 剩余行事实推导（此处为 READY_TO_PICK）。
    expect(outcome).toEqual({ shipped: false, erpStatus: 'EXCEPTION' });
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), 'item-2', {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
    expect(statusService.transition).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      OPERATOR,
      expect.stringContaining('内部履约进行中'),
    );
  });
});
