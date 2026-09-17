import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderStatusService } from './order-status.service';
import { OrderDeadlineExceptionService } from './order-deadline-exception.service';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { StoreService } from '../../store/services/store.service';
import { ListingResolverService } from '../../listing/services/listing-resolver.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { WarehousePlatformBindingService } from '../../warehouse/services/warehouse-platform-binding.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ListingSkuResolveFailedError } from '../../listing/errors/listing-errors';
import { InsufficientStockError } from '../../inventory/errors/inventory.errors';
import { NormalizedOrderInput } from '../dto/order.dto';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';

const OPERATOR = { userId: null, username: 'test' };

function baseInput(): NormalizedOrderInput {
  return {
    storeId: 'store-1',
    platformOrderId: 'P-1',
    platformStatus: 'new',
    fulfillmentMode: 'FBS',
    orderedAt: new Date(),
    currency: 'RUB',
    items: [{ platformSkuId: 'PSK-1', quantity: '2' }],
  };
}

function makeItem(
  id: string,
  lineNo: number,
  overrides: Partial<OrderItemEntity> = {},
): OrderItemEntity {
  return {
    id,
    orderId: 'order-1',
    lineNo,
    platformProductId: null,
    platformSkuId: 'PSK-1',
    sellerSku: null,
    offerId: null,
    listingSkuId: null,
    skuId: null,
    warehouseId: null,
    quantity: '2.000',
    unitPrice: null,
    totalPrice: null,
    platformImageUrl: null,
    fulfillmentStatus: 'PENDING',
    mappingStatus: 'PENDING',
    reservationId: null,
    rawData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(input: {
  existingOrder?: OrderEntity | null;
  createdItems: OrderItemEntity[];
  finalItems?: OrderItemEntity[];
  resolveError?: Error;
  reserveError?: Error;
}) {
  const transaction = vi
    .fn()
    .mockImplementation((work: (manager: unknown) => Promise<unknown>) => work({}));
  const dataSource = { transaction } as unknown as DataSource;
  const storeService = {
    getEntityById: vi.fn().mockResolvedValue({ id: 'store-1', name: 'S1' }),
  } as unknown as StoreService;
  const resolver = {
    resolveInternalSku: vi.fn().mockImplementation(() => {
      if (input.resolveError !== undefined) {
        throw input.resolveError;
      }
      return Promise.resolve({ internalSkuId: 'sku-1', listingSkuId: 'pls-1' });
    }),
  } as unknown as ListingResolverService;
  const reservationService = {
    reserveStock: vi.fn().mockImplementation(() => {
      if (input.reserveError !== undefined) {
        throw input.reserveError;
      }
      return Promise.resolve({ id: 'rsv-1' });
    }),
  } as unknown as ReservationService;
  const bindingService = {
    listActiveByStore: vi.fn().mockResolvedValue([
      {
        binding: {
          status: 'ACTIVE',
          priority: 100,
          warehouseId: 'wh-1',
        },
        warehouseType: 'SELF',
      },
    ]),
  } as unknown as WarehousePlatformBindingService;
  const exceptionService = {
    createInTx: vi.fn().mockResolvedValue({ id: 'exc-1' }),
    resolveByReferenceInTx: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExceptionService;
  const created = input.createdItems;
  const orderRepo = {
    findByStoreAndPlatformOrder: vi
      .fn()
      .mockResolvedValue(input.existingOrder !== undefined ? input.existingOrder : null),
    nextOrderNo: vi.fn().mockResolvedValue('ORD00000001'),
    insertWithItems: vi.fn().mockResolvedValue({
      id: 'order-1',
      orderNo: 'ORD00000001',
      erpStatus: 'NEW',
      storeId: 'store-1',
      platformOrderId: 'P-1',
    }),
  } as unknown as OrderRepository;
  let call = 0;
  const itemRepo = {
    findByOrderId: vi.fn().mockImplementation(() => {
      call += 1;
      // First call returns PENDING items (post-insert), later calls return the final state.
      return Promise.resolve(call === 1 ? created : (input.finalItems ?? created));
    }),
    updateMapping: vi.fn().mockResolvedValue(undefined),
    updateFulfillment: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrderItemRepository;
  const historyRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrderStatusHistoryRepository;
  const statusService = {
    recomputeOrderStatus: vi.fn().mockResolvedValue('READY_TO_PICK'),
  } as unknown as OrderStatusService;
  const deadlineExceptionService = {
    evaluate: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrderDeadlineExceptionService;
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
  const service = new OrderIngestionService(
    dataSource,
    storeService,
    resolver,
    reservationService,
    bindingService,
    exceptionService,
    orderRepo,
    itemRepo,
    historyRepo,
    statusService,
    deadlineExceptionService,
    logger,
  );
  return { service, exceptionService, reservationService, statusService, itemRepo };
}

describe('OrderIngestionService (task §11-§24)', () => {
  it('replays idempotently when (storeId, platformOrderId) already exists', async () => {
    const existing = {
      id: 'order-9',
      orderNo: 'ORD00000009',
      erpStatus: 'READY_TO_PICK',
    } as OrderEntity;
    const { service, reservationService } = build({
      existingOrder: existing,
      createdItems: [],
    });
    const result = await service.ingest(baseInput(), OPERATOR);
    expect(result.alreadyIngested).toBe(true);
    expect(result.orderId).toBe('order-9');
    expect(reservationService.reserveStock).not.toHaveBeenCalled();
  });

  it('reserves stock for a mapped line and marks it RESERVED', async () => {
    const { service, itemRepo, statusService } = build({
      createdItems: [makeItem('item-1', 1)],
      finalItems: [makeItem('item-1', 1, { fulfillmentStatus: 'RESERVED', skuId: 'sku-1' })],
    });
    const result = await service.ingest(baseInput(), OPERATOR);
    expect(result.alreadyIngested).toBe(false);
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({ fulfillmentStatus: 'RESERVED', reservationId: 'rsv-1' }),
    );
    expect(statusService.recomputeOrderStatus).toHaveBeenCalled();
  });

  it('maps resolve failure to mapping FAILED + ORDER_SKU_MAPPING_FAILED, order survives', async () => {
    const { service, exceptionService, reservationService } = build({
      createdItems: [makeItem('item-1', 1)],
      resolveError: new ListingSkuResolveFailedError('store-1', {}),
    });
    const result = await service.ingest(baseInput(), OPERATOR);
    expect(result.alreadyIngested).toBe(false);
    expect(exceptionService.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exceptionType: 'ORDER_SKU_MAPPING_FAILED' }),
    );
    expect(reservationService.reserveStock).not.toHaveBeenCalled();
  });

  it('insufficient stock backorders the line and creates ORDER_OUT_OF_STOCK (task §22)', async () => {
    const { service, exceptionService } = build({
      createdItems: [makeItem('item-1', 1)],
      reserveError: new InsufficientStockError({
        skuId: 'sku-1',
        warehouseId: 'wh-1',
        requestedQty: '2.000',
        availableQty: '1.000',
      }),
    });
    await service.ingest(baseInput(), OPERATOR);
    expect(exceptionService.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exceptionType: 'ORDER_OUT_OF_STOCK' }),
    );
  });

  it('per-line failure does not stop later lines (task §17)', async () => {
    const items = [makeItem('item-1', 1), makeItem('item-2', 2)];
    let resolveCalls = 0;
    const transaction = vi
      .fn()
      .mockImplementation((work: (manager: unknown) => Promise<unknown>) => work({}));
    const dataSource = { transaction } as unknown as DataSource;
    const resolver = {
      resolveInternalSku: vi.fn().mockImplementation(() => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          throw new ListingSkuResolveFailedError('store-1', {});
        }
        return Promise.resolve({ internalSkuId: 'sku-2', listingSkuId: 'pls-2' });
      }),
    } as unknown as ListingResolverService;
    const storeService = {
      getEntityById: vi.fn().mockResolvedValue({ id: 'store-1' }),
    } as unknown as StoreService;
    const reservationService = {
      reserveStock: vi.fn().mockResolvedValue({ id: 'rsv-2' }),
    } as unknown as ReservationService;
    const bindingService = {
      listActiveByStore: vi
        .fn()
        .mockResolvedValue([
          {
            binding: { status: 'ACTIVE', priority: 1, warehouseId: 'wh-1' },
            warehouseType: 'SELF',
          },
        ]),
    } as unknown as WarehousePlatformBindingService;
    const exceptionService = {
      createInTx: vi.fn().mockResolvedValue({ id: 'exc' }),
    } as unknown as ExceptionService;
    const orderRepo = {
      findByStoreAndPlatformOrder: vi.fn().mockResolvedValue(null),
      nextOrderNo: vi.fn().mockResolvedValue('ORD1'),
      insertWithItems: vi.fn().mockResolvedValue({
        id: 'order-1',
        orderNo: 'ORD1',
        erpStatus: 'NEW',
        storeId: 'store-1',
        platformOrderId: 'P-1',
      }),
    } as unknown as OrderRepository;
    let call = 0;
    const itemRepo = {
      findByOrderId: vi.fn().mockImplementation(() => {
        call += 1;
        return Promise.resolve(call === 1 ? items : items);
      }),
      updateMapping: vi.fn().mockResolvedValue(undefined),
      updateFulfillment: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderItemRepository;
    const historyRepo = {
      insert: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderStatusHistoryRepository;
    const statusService = {
      recomputeOrderStatus: vi.fn().mockResolvedValue('PARTIALLY_BACKORDERED'),
    } as unknown as OrderStatusService;
    const deadlineExceptionService = {
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderDeadlineExceptionService;
    const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
    const service = new OrderIngestionService(
      dataSource,
      storeService,
      resolver,
      reservationService,
      bindingService,
      exceptionService,
      orderRepo,
      itemRepo,
      historyRepo,
      statusService,
      deadlineExceptionService,
      logger,
    );
    await service.ingest(baseInput(), OPERATOR);
    expect(reservationService.reserveStock).toHaveBeenCalledTimes(1);
    expect(exceptionService.createInTx).toHaveBeenCalledTimes(1);
  });
});
