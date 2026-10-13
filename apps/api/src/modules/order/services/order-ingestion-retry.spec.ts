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
    };
    return { service, itemRepo: internals.itemRepo, statusService: internals.statusService };
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
});
