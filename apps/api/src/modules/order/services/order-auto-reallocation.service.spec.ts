import { describe, expect, it, vi } from 'vitest';
import { OrderAutoReallocationService } from './order-auto-reallocation.service';
import { InventoryStockListenerRegistry } from '../../inventory/services/inventory-stock-listener-registry';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderStatusService } from './order-status.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderIngestInvalidError } from '../errors/order.errors';

function makeOrder(id: string, erpStatus = 'BACKORDERED'): OrderEntity {
  return {
    id,
    orderNo: 'ORD00000001',
    storeId: 'store-1',
    erpStatus,
  } as OrderEntity;
}

function makeItem(id: string, overrides: Partial<OrderItemEntity> = {}): OrderItemEntity {
  return {
    id,
    orderId: 'order-1',
    lineNo: 1,
    skuId: 'sku-1',
    quantity: '1.000',
    fulfillmentStatus: 'BACKORDERED',
    mappingStatus: 'MAPPED',
    reservationId: null,
    ...overrides,
  } as OrderItemEntity;
}

function build(opts: {
  order?: OrderEntity | null;
  item?: OrderItemEntity | null;
  reserved?: boolean;
}) {
  const registry = new InventoryStockListenerRegistry();
  const itemRepo = {
    findUnallocatedItemIdsBySku: vi
      .fn()
      .mockResolvedValue([{ itemId: 'item-1', orderId: 'order-1' }]),
    findById: vi.fn().mockResolvedValue(opts.item ?? makeItem('item-1')),
  } as unknown as OrderItemRepository;
  const orderRepo = {
    findById: vi.fn().mockResolvedValue(opts.order ?? makeOrder('order-1')),
  } as unknown as OrderRepository;
  const ingestionService = {
    allocateMappedItem: vi
      .fn()
      .mockResolvedValue({ reserved: opts.reserved ?? true, reservationId: 'rsv-1' }),
  } as unknown as OrderIngestionService;
  const statusService = {
    recomputeOrderStatus: vi.fn().mockResolvedValue('READY_TO_PICK'),
  } as unknown as OrderStatusService;
  const exceptionService = {
    resolveByReference: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExceptionService;
  const logger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as AppLoggerService;
  const service = new OrderAutoReallocationService(
    registry,
    itemRepo,
    orderRepo,
    ingestionService,
    statusService,
    exceptionService,
    logger,
  );
  return {
    service,
    registry,
    itemRepo,
    orderRepo,
    ingestionService,
    statusService,
    exceptionService,
  };
}

describe('OrderAutoReallocationService (用户指示 2026-09-17)', () => {
  it('registers itself as a stock listener on module init', () => {
    const { service, registry } = build({});
    const spy = vi.spyOn(registry, 'register');
    service.onModuleInit();
    expect(spy).toHaveBeenCalledWith(service);
  });

  it('re-allocates a backordered line and recomputes the rollup when stock arrives', async () => {
    const { service, ingestionService, statusService, exceptionService } = build({
      reserved: true,
    });
    await (
      service as unknown as {
        reallocateFor: (event: unknown) => Promise<void>;
      }
    ).reallocateFor({ skuId: 'sku-1', warehouseId: 'wh-1', eventType: 'RECEIVE' });
    expect(ingestionService.allocateMappedItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      expect.objectContaining({ id: 'item-1' }),
      expect.objectContaining({ username: 'auto-reallocation' }),
    );
    expect(exceptionService.resolveByReference).toHaveBeenCalledWith(
      expect.objectContaining({ exceptionType: 'ORDER_OUT_OF_STOCK', referenceId: 'item-1' }),
    );
    expect(statusService.recomputeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      expect.anything(),
      expect.stringContaining('自动重新分配'),
    );
  });

  it('keeps the backordered state (no exception spam) when stock is still short', async () => {
    const { service, exceptionService, statusService } = build({ reserved: false });
    await (
      service as unknown as {
        reallocateFor: (event: unknown) => Promise<void>;
      }
    ).reallocateFor({ skuId: 'sku-1', warehouseId: 'wh-1', eventType: 'RECEIVE' });
    expect(exceptionService.resolveByReference).not.toHaveBeenCalled();
    expect(statusService.recomputeOrderStatus).not.toHaveBeenCalled();
  });

  it('skips cancelled / shipped orders', async () => {
    const { service, ingestionService } = build({
      order: makeOrder('order-1', 'CANCELLED'),
    });
    await (
      service as unknown as {
        reallocateFor: (event: unknown) => Promise<void>;
      }
    ).reallocateFor({ skuId: 'sku-1', warehouseId: 'wh-1', eventType: 'RECEIVE' });
    expect(ingestionService.allocateMappedItem).not.toHaveBeenCalled();
  });

  it('swallows listener failures (stock flow must never break)', async () => {
    const { service } = build({});
    (service as unknown as { reallocateFor: () => Promise<void> }).reallocateFor = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
    expect(() =>
      service.onStockIncreased({ skuId: 'sku-1', warehouseId: 'wh-1', eventType: 'RECEIVE' }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('OrderAutoReallocationService 配置性失败可见化 (用户指示 2026-10-15)', () => {
  it('raises an ORDER_INVALID_STATE line exception when the store has no bound warehouse', async () => {
    const registry = new InventoryStockListenerRegistry();
    const itemRepo = {
      findUnallocatedItemIdsBySku: vi
        .fn()
        .mockResolvedValue([{ itemId: 'item-1', orderId: 'order-1' }]),
      findById: vi.fn().mockResolvedValue(makeItem('item-1')),
    } as unknown as OrderItemRepository;
    const orderRepo = {
      findById: vi.fn().mockResolvedValue(makeOrder('order-1')),
    } as unknown as OrderRepository;
    const ingestionService = {
      allocateMappedItem: vi
        .fn()
        .mockRejectedValue(new OrderIngestInvalidError('店铺没有可用的库存绑定仓库')),
    } as unknown as OrderIngestionService;
    const exceptionService = {
      resolveByReference: vi.fn().mockResolvedValue(undefined),
      upsertOpen: vi.fn().mockResolvedValue({ id: 'exc-1' }),
    } as unknown as ExceptionService;
    const service = new OrderAutoReallocationService(
      registry,
      itemRepo,
      orderRepo,
      ingestionService,
      { recomputeOrderStatus: vi.fn() } as never,
      exceptionService,
      { log: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
    );

    service.onStockIncreased({ skuId: 'sku-1', warehouseId: 'wh-1', eventType: 'RECEIVE' });
    // 异步自吞：等一个微任务周期让 reallocateFor 跑完。
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exceptionService.upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionType: 'ORDER_INVALID_STATE',
        referenceType: 'ORDER_ITEM',
        referenceId: 'item-1',
        storeId: 'store-1',
      }),
    );
  });

  it('closes the config-failure exception when allocation succeeds', async () => {
    const registry = new InventoryStockListenerRegistry();
    const itemRepo = {
      findUnallocatedItemIdsBySku: vi
        .fn()
        .mockResolvedValue([{ itemId: 'item-1', orderId: 'order-1' }]),
      findById: vi.fn().mockResolvedValue(makeItem('item-1')),
    } as unknown as OrderItemRepository;
    const orderRepo = {
      findById: vi.fn().mockResolvedValue(makeOrder('order-1')),
    } as unknown as OrderRepository;
    const ingestionService = {
      allocateMappedItem: vi.fn().mockResolvedValue({ reserved: true, reservationId: 'rsv-1' }),
    } as unknown as OrderIngestionService;
    const exceptionService = {
      resolveByReference: vi.fn().mockResolvedValue(undefined),
      upsertOpen: vi.fn().mockResolvedValue({ id: 'exc-1' }),
    } as unknown as ExceptionService;
    const service = new OrderAutoReallocationService(
      registry,
      itemRepo,
      orderRepo,
      ingestionService,
      { recomputeOrderStatus: vi.fn() } as never,
      exceptionService,
      { log: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
    );

    service.onStockIncreased({ skuId: 'sku-1', warehouseId: 'wh-1', eventType: 'RECEIVE' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 成功 = 关缺货异常 + 关配置性失败异常（幂等，无则不动）。
    expect(exceptionService.resolveByReference).toHaveBeenCalledWith({
      exceptionType: 'ORDER_OUT_OF_STOCK',
      referenceType: 'ORDER_ITEM',
      referenceId: 'item-1',
    });
    expect(exceptionService.resolveByReference).toHaveBeenCalledWith({
      exceptionType: 'ORDER_INVALID_STATE',
      referenceType: 'ORDER_ITEM',
      referenceId: 'item-1',
    });
  });
});
