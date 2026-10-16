import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderStatusService } from './order-status.service';
import { OrderDeadlineExceptionService } from './order-deadline-exception.service';
import { OrderPlatformShippedService } from './order-platform-shipped.service';
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
    resolveDefaultWarehouseId: vi.fn().mockResolvedValue('wh-1'),
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
    insertWithItems: vi
      .fn()
      .mockImplementation((_runner: unknown, header: Record<string, unknown>) =>
        Promise.resolve({
          id: 'order-1',
          erpStatus: 'NEW',
          ...header,
        }),
      ),
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
  const platformShipped = {
    apply: vi.fn().mockResolvedValue({ shipped: true, erpStatus: 'SHIPPED' }),
  } as unknown as OrderPlatformShippedService;
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
    platformShipped,
    logger,
  );
  return {
    service,
    exceptionService,
    reservationService,
    statusService,
    itemRepo,
    deadlineExceptionService,
    platformShipped,
  };
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

  it('external fulfillment (FBO/FBP) marks the line EXTERNAL_FULFILLED without reserving (用户指示 2026-09-17)', async () => {
    const { service, reservationService, itemRepo } = build({
      createdItems: [makeItem('item-1', 1)],
      finalItems: [
        makeItem('item-1', 1, { fulfillmentStatus: 'EXTERNAL_FULFILLED', skuId: 'sku-1' }),
      ],
    });
    const input = { ...baseInput(), fulfillmentMode: 'FBO' };
    await service.ingest(input, OPERATOR);
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({ fulfillmentStatus: 'EXTERNAL_FULFILLED' }),
    );
    expect(reservationService.reserveStock).not.toHaveBeenCalled();
  });

  // 平台已事实发货（用户指示 2026-10-14）：摄入时平台阶段已是
  // IN_TRANSIT / DELIVERED（OZON delivering / delivered）——货物已发走，
  // 不预留、不产生缺货异常；订单头由 OrderPlatformShippedService 按平台
  // 事实收敛（无未映射行转 SHIPPED）。
  it('platform-shipped at ingest marks the line EXTERNAL_FULFILLED and converges the order', async () => {
    const { service, reservationService, itemRepo, platformShipped, deadlineExceptionService } =
      build({
        createdItems: [makeItem('item-1', 1)],
        finalItems: [
          makeItem('item-1', 1, { fulfillmentStatus: 'EXTERNAL_FULFILLED', skuId: 'sku-1' }),
        ],
      });
    const input = { ...baseInput(), platformStage: 'IN_TRANSIT' };
    const result = await service.ingest(input, OPERATOR);
    expect(result.alreadyIngested).toBe(false);
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({ fulfillmentStatus: 'EXTERNAL_FULFILLED' }),
    );
    expect(reservationService.reserveStock).not.toHaveBeenCalled();
    expect(platformShipped.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', platformStage: 'IN_TRANSIT' }),
      OPERATOR,
      expect.stringContaining('平台已事实发货'),
    );
    expect(deadlineExceptionService.evaluate).not.toHaveBeenCalled();
  });

  it('platform-shipped at ingest still raises the mapping exception and stays blocked by it', async () => {
    const { service, exceptionService, platformShipped } = build({
      createdItems: [makeItem('item-1', 1)],
      resolveError: new ListingSkuResolveFailedError('store-1', {}),
    });
    const input = { ...baseInput(), platformStage: 'DELIVERED' };
    await service.ingest(input, OPERATOR);
    // 未映射异常仍然创建（唯一被允许的阻塞）；收敛仍执行——由 rollup
    // 决定订单保持 EXCEPTION。
    expect(exceptionService.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exceptionType: 'ORDER_SKU_MAPPING_FAILED' }),
    );
    expect(platformShipped.apply).toHaveBeenCalled();
  });

  it('no available warehouse backorders the mapped line instead of leaving PENDING (2026-09-17 修复)', async () => {
    const { service, itemRepo, reservationService } = build({
      createdItems: [makeItem('item-1', 1)],
    });
    const bindingService = {
      listActiveByStore: vi.fn().mockResolvedValue([]),
      resolveDefaultWarehouseId: vi.fn().mockResolvedValue(null),
    } as unknown as WarehousePlatformBindingService;
    (service as unknown as { bindingService: WarehousePlatformBindingService }).bindingService =
      bindingService;
    await service.ingest(baseInput(), OPERATOR);
    expect(itemRepo.updateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({ fulfillmentStatus: 'BACKORDERED' }),
    );
    expect(reservationService.reserveStock).not.toHaveBeenCalled();
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
      listActiveByStore: vi.fn().mockResolvedValue([
        {
          binding: { status: 'ACTIVE', priority: 1, warehouseId: 'wh-1' },
          warehouseType: 'SELF',
        },
      ]),
      resolveDefaultWarehouseId: vi.fn().mockResolvedValue('wh-1'),
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
    const platformShipped = {
      apply: vi.fn().mockResolvedValue({ shipped: true, erpStatus: 'SHIPPED' }),
    } as unknown as OrderPlatformShippedService;
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
      platformShipped,
      logger,
    );
    await service.ingest(baseInput(), OPERATOR);
    expect(reservationService.reserveStock).toHaveBeenCalledTimes(1);
    expect(exceptionService.createInTx).toHaveBeenCalledTimes(1);
  });
});

describe('OrderIngestionService.retryFailedMappingForVariant (2026-10-15 批量收敛)', () => {
  /** 轻量装配：只 mock 批量路径触达的依赖。 */
  function buildBatch(options: {
    candidates: Array<{ itemId: string; orderId: string }>;
    items: Record<string, Record<string, unknown> | null>;
    orders: Record<string, Record<string, unknown> | null>;
    failItemIds?: string[];
  }) {
    const transaction = vi
      .fn()
      .mockImplementation((work: (manager: unknown) => Promise<unknown>) => work({}));
    const dataSource = { transaction } as unknown as DataSource;
    const storeService = {
      getEntityById: vi.fn().mockResolvedValue({ id: 'store-1', name: 'S1' }),
    } as unknown as StoreService;
    const resolver = {
      resolveInternalSku: vi
        .fn()
        .mockResolvedValue({ internalSkuId: 'sku-1', listingSkuId: 'pls-1' }),
    } as unknown as ListingResolverService;
    const reservationService = {
      reserveStock: vi.fn().mockRejectedValue(
        new InsufficientStockError({
          skuId: 'sku-1',
          warehouseId: 'wh-1',
          requestedQty: '1',
          availableQty: '0',
        }),
      ),
    } as unknown as ReservationService;
    const bindingService = {
      listActiveByStore: vi.fn().mockResolvedValue([
        {
          binding: { status: 'ACTIVE', priority: 100, warehouseId: 'wh-1' },
          warehouseType: 'SELF',
        },
      ]),
      resolveDefaultWarehouseId: vi.fn().mockResolvedValue('wh-1'),
    } as unknown as WarehousePlatformBindingService;
    const exceptionService = {
      createInTx: vi.fn().mockResolvedValue({ id: 'exc-1' }),
      resolveByReferenceInTx: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExceptionService;
    const orderRepo = {
      findById: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(
            options.orders[id] === undefined
              ? null
              : (options.orders[id] as unknown as OrderEntity),
          ),
        ),
    } as unknown as OrderRepository;
    const itemRepo = {
      findFailedMappingLineCandidates: vi.fn().mockResolvedValue(options.candidates),
      findById: vi.fn().mockImplementation((id: string) => {
        if (options.failItemIds?.includes(id) === true) {
          return Promise.reject(new Error('db hiccup'));
        }
        return Promise.resolve(
          options.items[id] === undefined
            ? null
            : (options.items[id] as unknown as OrderItemEntity),
        );
      }),
      updateMapping: vi.fn().mockResolvedValue(undefined),
      updateFulfillment: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderItemRepository;
    const historyRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    const statusService = {
      recomputeOrderStatus: vi.fn().mockResolvedValue('READY_TO_PICK'),
    } as unknown as OrderStatusService;
    const deadlineExceptionService = {
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderDeadlineExceptionService;
    const platformShipped = {
      apply: vi.fn().mockResolvedValue({ shipped: true, erpStatus: 'SHIPPED' }),
    } as unknown as OrderPlatformShippedService;
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
      historyRepo as never,
      statusService,
      deadlineExceptionService,
      platformShipped,
      logger,
    );
    return { service, itemRepo, orderRepo, statusService, logger };
  }

  const ORDER = {
    id: 'order-1',
    orderNo: 'ORD00000001',
    storeId: 'store-1',
    erpStatus: 'READY_TO_PICK',
    fulfillmentMode: 'FBS',
    platformStage: null,
  };

  it('repairs every FAILED line of the variant; only BACKORDERED/PENDING allocate', async () => {
    const { service, itemRepo } = buildBatch({
      candidates: [
        { itemId: 'i1', orderId: 'order-1' },
        { itemId: 'i2', orderId: 'order-1' },
      ],
      items: {
        // BACKORDERED → 修映射并尝试分配；RELEASED → 只修映射不占库存。
        i1: {
          id: 'i1',
          orderId: 'order-1',
          lineNo: 1,
          mappingStatus: 'FAILED',
          fulfillmentStatus: 'BACKORDERED',
          platformSkuId: 'psk-1',
          sellerSku: null,
          skuId: null,
        },
        i2: {
          id: 'i2',
          orderId: 'order-1',
          lineNo: 2,
          mappingStatus: 'FAILED',
          fulfillmentStatus: 'RELEASED',
          platformSkuId: 'psk-1',
          sellerSku: null,
          skuId: null,
        },
      },
      orders: { 'order-1': ORDER },
    });
    const result = await service.retryFailedMappingForVariant(
      { storeId: 'store-1', platformSkuId: 'psk-1', sellerSku: null },
      OPERATOR,
    );

    expect(result).toMatchObject({ scanned: 2, repaired: 2, reserved: 0 });
    expect(itemRepo.updateMapping).toHaveBeenCalledTimes(2);
  });

  it('swallows a single-line failure and keeps repairing the rest', async () => {
    const { service, logger } = buildBatch({
      candidates: [
        { itemId: 'i1', orderId: 'order-1' },
        { itemId: 'i2', orderId: 'order-missing' },
      ],
      items: {
        i1: {
          id: 'i1',
          orderId: 'order-1',
          lineNo: 1,
          mappingStatus: 'FAILED',
          fulfillmentStatus: 'BACKORDERED',
          platformSkuId: 'psk-1',
          sellerSku: null,
          skuId: null,
        },
        i2: {
          id: 'i2',
          orderId: 'order-1',
          lineNo: 2,
          mappingStatus: 'FAILED',
          fulfillmentStatus: 'BACKORDERED',
          platformSkuId: 'psk-1',
          sellerSku: null,
          skuId: null,
        },
      },
      orders: { 'order-1': ORDER },
      failItemIds: ['i2'],
    });

    const result = await service.retryFailedMappingForVariant(
      { storeId: 'store-1', platformSkuId: 'psk-1', sellerSku: null },
      OPERATOR,
    );

    expect(result).toMatchObject({ scanned: 2, repaired: 1, reserved: 0 });
    expect(logger.warn).toHaveBeenCalled();
  });
});
