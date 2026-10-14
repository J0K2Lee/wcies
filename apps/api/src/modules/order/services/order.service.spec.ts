import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderPlatformFactsInput, OrderService } from './order.service';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { PlatformStatusHistoryRepository } from '../repositories/platform-status-history.repository';
import { OrderStatusService } from './order-status.service';
import { OrderTrackingStallService } from './order-tracking-stall.service';
import { OrderDeadlineExceptionService } from './order-deadline-exception.service';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderPlatformShippedService } from './order-platform-shipped.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { StoreService } from '../../store/services/store.service';
import { SkuImageService } from '../../product/services/sku-image.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OrderPickingStatePort } from '../ports/order-picking-state.port';
import { OrderInterceptionPort } from '../ports/order-interception.port';
import { OrderProcurementPort } from '../ports/order-procurement.port';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';

const OPERATOR = { userId: null, username: 'test' };

describe('OrderService.applySyncedPlatformFacts - fulfillmentMode', () => {
  const facts: OrderPlatformFactsInput = {
    storeId: 'store-1',
    platformOrderId: 'posting-1',
    platformStatus: 'awaiting_packaging',
    platformCancelled: false,
    platformStage: null,
    platformStageChangedAt: null,
    shipmentDeadline: null,
    rawData: null,
    source: 'ORDER_SYNC',
  };

  function build(storedMode: string | null = 'FBS', storedStage: string | null = null) {
    const order = {
      id: 'order-1',
      orderNo: 'ORD00000001',
      storeId: facts.storeId,
      erpStatus: 'BACKORDERED',
      platformStatus: facts.platformStatus,
      platformStage: storedStage,
      platformStageChangedAt: null,
      shipmentDeadline: null,
      rawData: null,
      fulfillmentMode: storedMode,
    };
    const orderRepo = {
      findByStoreAndPlatformOrder: vi.fn().mockResolvedValue(order),
      updatePlatformFacts: vi.fn().mockResolvedValue(undefined),
      markPlatformFactsChecked: vi.fn().mockResolvedValue(undefined),
    };
    const history = { insert: vi.fn() };
    const deadlineExceptionService = {
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderDeadlineExceptionService;
    const platformShipped = {
      apply: vi.fn().mockResolvedValue({ shipped: true, erpStatus: 'SHIPPED' }),
    } as unknown as OrderPlatformShippedService;
    const service = new OrderService(
      {
        transaction: vi.fn((work: (manager: unknown) => Promise<unknown>) => work({})),
      } as unknown as DataSource,
      orderRepo as unknown as OrderRepository,
      {} as OrderItemRepository,
      {} as OrderStatusHistoryRepository,
      history as unknown as PlatformStatusHistoryRepository,
      {} as OrderStatusService,
      deadlineExceptionService,
      { evaluate: vi.fn() } as unknown as OrderTrackingStallService,
      {} as OrderIngestionService,
      platformShipped,
      {} as ReservationService,
      {} as InventoryQueryService,
      {} as ExceptionService,
      {} as StoreService,
      {} as SkuImageService,
      {} as OperationLogService,
      {} as AppLoggerService,
      {} as OrderPickingStatePort,
      {} as OrderInterceptionPort,
      {} as OrderProcurementPort,
      {} as PlatformAdapterRegistry,
    );
    return { service, orderRepo, history, platformShipped, deadlineExceptionService };
  }

  it.each(['FBS', null])(
    'updates a changed channel from %s without an ERP transition',
    async (stored) => {
      const { service, orderRepo, history } = build(stored);
      const result = await service.applySyncedPlatformFacts(
        { ...facts, fulfillmentMode: 'RFBS' },
        OPERATOR,
      );
      expect(result).toEqual({ applied: true, changed: true, cancelled: false });
      expect(orderRepo.updatePlatformFacts).toHaveBeenCalledWith(expect.anything(), 'order-1', {
        platformStatus: facts.platformStatus,
        shipmentDeadline: null,
        rawData: null,
        fulfillmentMode: 'RFBS',
      });
      expect(history.insert).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, 'FBS'])(
    'does not rewrite a missing or unchanged channel (%s)',
    async (fulfillmentMode) => {
      const { service, orderRepo } = build();
      const result = await service.applySyncedPlatformFacts(
        { ...facts, fulfillmentMode },
        OPERATOR,
      );
      expect(result.changed).toBe(false);
      expect(orderRepo.updatePlatformFacts).not.toHaveBeenCalled();
      expect(orderRepo.markPlatformFactsChecked).toHaveBeenCalled();
    },
  );

  it.each([undefined, null])(
    'preserves the channel during another fact update (%s)',
    async (fulfillmentMode) => {
      const { service, orderRepo } = build();
      await service.applySyncedPlatformFacts(
        { ...facts, fulfillmentMode, rawData: { refreshed: true } },
        OPERATOR,
      );
      const patch = orderRepo.updatePlatformFacts.mock.calls[0]?.[2];
      expect(patch).not.toHaveProperty('fulfillmentMode');
    },
  );

  // 平台已事实发货（用户指示 2026-10-14）：归一化阶段 IN_TRANSIT /
  // DELIVERED（OZON delivering / delivered）时，缺货不得再阻塞订单——
  // 收敛逻辑（关缺货/时限异常、缺货行转外部履约完成、无未映射行转
  // SHIPPED）由 OrderPlatformShippedService 承担，此处只验证分流。
  it.each(['IN_TRANSIT', 'DELIVERED'])(
    'converges a platform-shipped order (%s) instead of evaluating the deadline',
    async (stage) => {
      const { service, platformShipped, deadlineExceptionService } = build('RFBS');
      const result = await service.applySyncedPlatformFacts(
        {
          ...facts,
          platformStatus: stage === 'IN_TRANSIT' ? 'delivering' : 'delivered',
          platformStage: stage,
        },
        OPERATOR,
      );
      expect(result).toEqual({ applied: true, changed: true, cancelled: false });
      expect(platformShipped.apply).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'order-1' }),
        OPERATOR,
        expect.stringContaining('平台已事实发货'),
      );
      expect(deadlineExceptionService.evaluate).not.toHaveBeenCalled();
    },
  );

  it('converges from the STORED stage when the re-read payload omits it', async () => {
    const { service, platformShipped } = build('RFBS', 'IN_TRANSIT');
    await service.applySyncedPlatformFacts({ ...facts, platformStage: null }, OPERATOR);
    expect(platformShipped.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      OPERATOR,
      expect.stringContaining('IN_TRANSIT'),
    );
  });

  it('still evaluates the deadline for a not-yet-shipped self-managed order', async () => {
    const { service, platformShipped, deadlineExceptionService } = build('RFBS');
    await service.applySyncedPlatformFacts(
      { ...facts, platformStage: 'AWAITING_SHIPMENT' },
      OPERATOR,
    );
    expect(platformShipped.apply).not.toHaveBeenCalled();
    expect(deadlineExceptionService.evaluate).toHaveBeenCalled();
  });
});

function makeItem(overrides: Partial<OrderItemEntity>): OrderItemEntity {
  return {
    id: 'item-1',
    orderId: 'order-1',
    lineNo: 1,
    platformProductId: null,
    platformSkuId: 'PSK-1',
    sellerSku: null,
    offerId: null,
    listingSkuId: null,
    skuId: 'sku-1',
    warehouseId: 'wh-1',
    quantity: '1.000',
    unitPrice: null,
    totalPrice: null,
    platformImageUrl: null,
    fulfillmentStatus: 'PENDING',
    mappingStatus: 'MAPPED',
    reservationId: null,
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Sprint 9 regression (orders.md §5.A): retryAllocation on a MAPPED PENDING
 * line with NO stock must land the line on BACKORDERED, create the
 * ORDER_OUT_OF_STOCK exception and recompute the rollup - a silent PENDING
 * with zero exceptions leaves the operator no to-do at all.
 */
describe('OrderService.retryAllocation - mapped line without stock', () => {
  function build(item: OrderItemEntity, order: Partial<OrderEntity>) {
    const transaction = vi
      .fn()
      .mockImplementation((work: (manager: unknown) => Promise<unknown>) => work({}));
    const itemRepo = {
      findById: vi.fn().mockResolvedValue({ ...item, fulfillmentStatus: 'BACKORDERED' }),
      updateFulfillment: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderItemRepository;
    const exceptionService = {
      resolveByReferenceInTx: vi.fn().mockResolvedValue(undefined),
      createInTx: vi.fn().mockResolvedValue({ id: 'exc-oos' }),
    } as unknown as ExceptionService;
    const ingestionService = {
      allocateMappedItem: vi.fn().mockResolvedValue({ reserved: false, reservationId: null }),
    } as unknown as OrderIngestionService;
    const statusService = {
      transition: vi.fn().mockResolvedValue(undefined),
      recomputeOrderStatus: vi.fn().mockResolvedValue('BACKORDERED'),
    } as unknown as OrderStatusService;
    const service = new OrderService(
      { transaction } as unknown as DataSource,
      {
        findById: vi.fn().mockResolvedValue({
          id: 'order-1',
          orderNo: 'ORD00000001',
          storeId: 'store-1',
          erpStatus: 'EXCEPTION',
          ...order,
        }),
      } as unknown as OrderRepository,
      itemRepo,
      {} as OrderStatusHistoryRepository,
      {} as PlatformStatusHistoryRepository,
      statusService,
      {} as OrderDeadlineExceptionService,
      { evaluate: vi.fn().mockResolvedValue(undefined) } as unknown as OrderTrackingStallService,
      ingestionService,
      {} as OrderPlatformShippedService,
      {} as ReservationService,
      {} as InventoryQueryService,
      exceptionService,
      {} as StoreService,
      {} as SkuImageService,
      { record: vi.fn() } as unknown as OperationLogService,
      { log: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService,
      {} as OrderPickingStatePort,
      {} as OrderInterceptionPort,
      {} as OrderProcurementPort,
      {} as PlatformAdapterRegistry,
    );
    return { service, itemRepo, exceptionService, statusService, ingestionService };
  }

  it('lands the line on BACKORDERED, creates ORDER_OUT_OF_STOCK and recomputes', async () => {
    const item = makeItem({});
    const { service, itemRepo, exceptionService, statusService } = build(item, {});

    const result = await service.retryAllocation(item.id, OPERATOR);

    expect(result.reserved).toBe(false);
    expect(result.fulfillmentStatus).toBe('BACKORDERED');
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), item.id, {
      fulfillmentStatus: 'BACKORDERED',
    });
    expect(exceptionService.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exceptionType: 'ORDER_OUT_OF_STOCK', referenceId: item.id }),
    );
    expect(exceptionService.resolveByReferenceInTx).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      OPERATOR,
      expect.stringContaining('仍库存不足'),
    );
  });

  it('still closes the OOS exception and recomputes when stock becomes available', async () => {
    const item = makeItem({});
    const { service, itemRepo, exceptionService, statusService } = build(item, {});
    (itemRepo.findById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ ...item, fulfillmentStatus: 'RESERVED' });
    (service as unknown as { ingestionService: OrderIngestionService }).ingestionService = {
      allocateMappedItem: vi.fn().mockResolvedValue({ reserved: true, reservationId: 'rsv-1' }),
    } as unknown as OrderIngestionService;

    const result = await service.retryAllocation(item.id, OPERATOR);

    expect(result.reserved).toBe(true);
    expect(exceptionService.resolveByReferenceInTx).toHaveBeenCalledWith(expect.anything(), {
      exceptionType: 'ORDER_OUT_OF_STOCK',
      referenceType: 'ORDER_ITEM',
      referenceId: item.id,
    });
    expect(statusService.recomputeOrderStatus).toHaveBeenCalled();
  });

  // 外部履约（ERP 建议#6 修复 2026-09-28）：平台持货行的重试永不占用内部库存。
  it('external-fulfillment line goes EXTERNAL_FULFILLED and follows platform facts to SHIPPED', async () => {
    const item = makeItem({});
    const { service, itemRepo, exceptionService, statusService, ingestionService } = build(item, {
      fulfillmentMode: 'FBP',
      platformStage: 'IN_TRANSIT',
    });
    (itemRepo.findById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...item, fulfillmentStatus: 'BACKORDERED' })
      .mockResolvedValueOnce({ ...item, fulfillmentStatus: 'EXTERNAL_FULFILLED' });

    const result = await service.retryAllocation(item.id, OPERATOR);

    expect(result).toMatchObject({ reserved: false, fulfillmentStatus: 'EXTERNAL_FULFILLED' });
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(expect.anything(), item.id, {
      fulfillmentStatus: 'EXTERNAL_FULFILLED',
    });
    expect(exceptionService.resolveByReferenceInTx).toHaveBeenCalledWith(expect.anything(), {
      exceptionType: 'ORDER_OUT_OF_STOCK',
      referenceType: 'ORDER_ITEM',
      referenceId: item.id,
    });
    expect(statusService.transition).toHaveBeenCalledWith(
      'order-1',
      'SHIPPED',
      OPERATOR,
      expect.stringContaining('平台履约流转'),
    );
    expect(
      (ingestionService.allocateMappedItem as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it('external-fulfillment line awaiting platform shipment only recomputes (no SHIPPED yet)', async () => {
    const item = makeItem({});
    const { service, statusService } = build(item, {
      fulfillmentMode: 'FBP',
      platformStage: 'AWAITING_SHIPMENT',
    });

    const result = await service.retryAllocation(item.id, OPERATOR);

    expect(result.reserved).toBe(false);
    expect(statusService.transition).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      OPERATOR,
      expect.stringContaining('外部履约'),
    );
  });
});
