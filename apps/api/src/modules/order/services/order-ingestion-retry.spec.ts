import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';

const OPERATOR = { userId: null, username: 'test' };

function makeOrder(overrides: Partial<OrderEntity>): OrderEntity {
  return {
    id: 'order-1',
    orderNo: 'ORD00000001',
    storeId: 'store-1',
    platformOrderId: 'posting-1',
    erpStatus: 'EXCEPTION',
    fulfillmentMode: 'FBP',
    platformStatus: 'delivering',
    platformStage: 'IN_TRANSIT',
    ...overrides,
  } as OrderEntity;
}

function makeItem(): OrderItemEntity {
  return {
    id: 'item-1',
    orderId: 'order-1',
    lineNo: 1,
    platformProductId: null,
    platformSkuId: null,
    sellerSku: 'offer-1',
    offerId: 'offer-1',
    listingSkuId: null,
    skuId: null,
    warehouseId: null,
    quantity: '1.000',
    unitPrice: null,
    totalPrice: null,
    platformImageUrl: null,
    fulfillmentStatus: 'PENDING',
    mappingStatus: 'FAILED',
    reservationId: null,
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 外部履约行的映射修复（ERP 建议#6 修复 2026-09-28）：FBP/FBO 等平台持货
 * 订单行的恢复路径必须与摄入路径同语义——不占内部库存、不进拣货，行直接
 * EXTERNAL_FULFILLED；平台已发货时订单随事实立即 SHIPPED，不再被映射异常
 * 永久卡在 待处理/异常。
 */
describe('OrderIngestionService.retryFailedMappingItem - external fulfillment', () => {
  function build() {
    const transaction = vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) =>
      work({} as EntityManager),
    );
    const service: OrderIngestionService = Object.assign(
      Object.create(OrderIngestionService.prototype) as OrderIngestionService,
      {
        dataSource: { transaction } as unknown as DataSource,
        resolver: {
          resolveInternalSku: vi
            .fn()
            .mockResolvedValue({ internalSkuId: 'sku-1', listingSkuId: 'ls-1' }),
        },
        itemRepo: {
          updateMapping: vi.fn().mockResolvedValue(undefined),
          updateFulfillment: vi.fn().mockResolvedValue(undefined),
          findById: vi.fn().mockResolvedValue({ ...makeItem(), mappingStatus: 'MAPPED' }),
        },
        exceptionService: {
          resolveByReferenceInTx: vi.fn().mockResolvedValue(undefined),
          createInTx: vi.fn().mockResolvedValue({ id: 'exc-1' }),
        },
        statusService: {
          transition: vi.fn().mockResolvedValue(undefined),
          recomputeOrderStatus: vi.fn().mockResolvedValue('EXCEPTION'),
        },
        platformShipped: {
          apply: vi.fn().mockResolvedValue({ shipped: true, erpStatus: 'SHIPPED' }),
        },
        logger: { log: vi.fn(), warn: vi.fn() },
      },
    );
    const internals = service as unknown as {
      itemRepo: {
        updateMapping: ReturnType<typeof vi.fn>;
        updateFulfillment: ReturnType<typeof vi.fn>;
      };
      statusService: {
        transition: ReturnType<typeof vi.fn>;
        recomputeOrderStatus: ReturnType<typeof vi.fn>;
      };
      platformShipped: { apply: ReturnType<typeof vi.fn> };
    };
    return {
      service,
      itemRepo: internals.itemRepo,
      statusService: internals.statusService,
      platformShipped: internals.platformShipped,
    };
  }

  it('marks the line EXTERNAL_FULFILLED and follows an already-shipped platform to SHIPPED', async () => {
    const order = makeOrder({});
    const { service, itemRepo, statusService } = build();

    const result = await service.retryFailedMappingItem(order, makeItem(), OPERATOR);

    expect(result).toMatchObject({ resolved: true, reserved: false, reservationId: null });
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
    expect(statusService.transition).toHaveBeenCalledWith(
      'order-1',
      'SHIPPED',
      OPERATOR,
      expect.stringContaining('平台履约流转'),
    );
    expect(statusService.recomputeOrderStatus).not.toHaveBeenCalled();
  });

  it('external line awaiting platform shipment recomputes instead of transitioning', async () => {
    const order = makeOrder({
      platformStage: 'AWAITING_SHIPMENT',
      platformStatus: 'awaiting_packaging',
    });
    const { service, statusService } = build();

    const result = await service.retryFailedMappingItem(order, makeItem(), OPERATOR);

    expect(result).toMatchObject({ resolved: true, reserved: false });
    expect(statusService.transition).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      OPERATOR,
      expect.stringContaining('外部履约'),
    );
  });

  // 平台已事实发货（用户指示 2026-10-14）：自管履约（FBS/RFBS）订单映射
  // 修复时平台已发走——不再占内部库存（会被现实否证），行转外部履约完成、
  // 关缺货异常，由 OrderPlatformShippedService 按平台事实收敛订单。
  it('self-managed order already shipped on the platform converges instead of allocating', async () => {
    const order = makeOrder({
      fulfillmentMode: 'RFBS',
      platformStage: 'IN_TRANSIT',
      platformStatus: 'delivering',
    });
    const { service, statusService, platformShipped } = build();

    const result = await service.retryFailedMappingItem(order, makeItem(), OPERATOR);

    expect(result).toMatchObject({ resolved: true, reserved: false, reservationId: null });
    expect(platformShipped.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', platformStage: 'IN_TRANSIT' }),
      OPERATOR,
      expect.stringContaining('平台已事实发货'),
    );
    // 收敛服务负责状态迁移：此处不再自行 transition / recompute。
    expect(statusService.transition).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).not.toHaveBeenCalled();
  });
});
