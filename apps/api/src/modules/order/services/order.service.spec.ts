import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderService } from './order.service';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { PlatformStatusHistoryRepository } from '../repositories/platform-status-history.repository';
import { OrderStatusService } from './order-status.service';
import { OrderTrackingStallService } from './order-tracking-stall.service';
import { OrderDeadlineExceptionService } from './order-deadline-exception.service';
import { OrderIngestionService } from './order-ingestion.service';
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
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';

const OPERATOR = { userId: null, username: 'test' };

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
    );
    return { service, itemRepo, exceptionService, statusService };
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
});
