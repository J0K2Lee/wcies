import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { PurchaseReceiptService } from './purchase-receipt.service';
import { PurchaseReceiptRepository } from '../repositories/purchase-receipt.repository';
import { PurchaseOrderRepository } from '../repositories/purchase-order.repository';
import { SupplierService } from './supplier.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { WarehousePlatformBindingService } from '../../warehouse/services/warehouse-platform-binding.service';
import { OrderService } from '../../order/services/order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import {
  PurchaseOrderNotFoundError,
  PurchaseReceiptDuplicateDraftError,
  PurchaseReceiptWarehouseMissingError,
} from '../errors/purchase-errors';

const operator = { userId: null, username: 'tester' };
const manager = {} as EntityManager;

function buildPo(overrides: Partial<{ receivingWarehouseId: string | null; status: string }>) {
  return {
    id: 'po-1',
    poNo: 'PO000001',
    supplierId: 'supplier-1',
    sourceNote: null,
    status: overrides.status ?? 'ORDERED',
    orderedAt: new Date(),
    expectedAt: null,
    remark: null,
    createdBy: null,
    receivingWarehouseId: overrides.receivingWarehouseId ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup(
  po: ReturnType<typeof buildPo>,
  extras?: {
    activePoId?: string | null;
    storeDefaultWarehouseId?: string | null;
  },
) {
  const receipt = {
    id: 'receipt-1',
    receiptNo: 'PR000001',
    purchaseOrderId: po.id,
    warehouseId: 'wh-1',
    status: 'DRAFT',
  };
  const repository = {
    findById: vi.fn().mockResolvedValue(receipt),
    findItemsWithRefs: vi.fn().mockResolvedValue([]),
    findActiveByPurchaseOrderId: vi.fn().mockResolvedValue([]),
    insertWithItems: vi.fn().mockResolvedValue(receipt),
  };
  const poRepository = {
    findById: vi.fn().mockResolvedValue(po),
    findActivePoIdByOrderItemId: vi
      .fn()
      .mockResolvedValue(extras?.activePoId === undefined ? po.id : extras.activePoId),
    findItemsWithRefs: vi.fn().mockResolvedValue([
      {
        item: {
          id: 'item-1',
          skuId: 'sku-1',
          quantity: '2.000',
          receivedQuantity: '0.000',
          unitCost: null,
        },
        skuCode: '',
        skuName: '',
        orderNo: null,
      },
    ]),
  };
  const warehouse = { getEntityById: vi.fn().mockResolvedValue({ id: 'wh-1', code: 'WH-1' }) };
  const binService = {
    countByWarehouse: vi.fn().mockResolvedValue(0),
    ensureReceiptStagingBin: vi.fn().mockResolvedValue({ id: 'bin-staging' }),
  };
  const inventoryQuery = {
    findCurrentBinId: vi.fn().mockResolvedValue(null),
  };
  const codes = { nextPurchaseReceiptNo: vi.fn().mockResolvedValue('PR000001') };
  const log = { record: vi.fn().mockResolvedValue(undefined) };
  const transaction = vi.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
  const service = new PurchaseReceiptService(
    { transaction } as unknown as DataSource,
    repository as unknown as PurchaseReceiptRepository,
    poRepository as unknown as PurchaseOrderRepository,
    {} as unknown as SupplierService,
    { getEntityById: vi.fn().mockResolvedValue({}) } as unknown as SkuService,
    warehouse as unknown as WarehouseService,
    binService as unknown as WarehouseBinService,
    {
      resolveDefaultWarehouseId: vi.fn().mockResolvedValue(extras?.storeDefaultWarehouseId ?? null),
    } as unknown as WarehousePlatformBindingService,
    {
      getItemFulfillment: vi.fn().mockResolvedValue({ storeId: 'store-1' }),
    } as unknown as OrderService,
    {} as unknown as InventoryService,
    inventoryQuery as unknown as InventoryQueryService,
    codes as unknown as BusinessCodeService,
    log as unknown as OperationLogService,
  );
  return { service, repository, poRepository, warehouse, binService, inventoryQuery, log };
}

describe('generateFromPo warehouse resolution (ERP 建议#4)', () => {
  it('uses the explicit request warehouse when given', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-po' }));
    await ctx.service.generateFromPo('po-1', { warehouseId: 'wh-req' }, operator);
    expect(ctx.warehouse.getEntityById).toHaveBeenCalledWith('wh-req');
    expect(ctx.repository.insertWithItems.mock.calls[0]?.[1]).toMatchObject({
      warehouseId: 'wh-req',
    });
  });

  it('falls back to the PO receiving-warehouse intent when request omits it', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-po' }));
    await ctx.service.generateFromPo('po-1', {}, operator);
    expect(ctx.warehouse.getEntityById).toHaveBeenCalledWith('wh-po');
    expect(ctx.repository.insertWithItems.mock.calls[0]?.[1]).toMatchObject({
      warehouseId: 'wh-po',
    });
  });

  it('rejects with a domain error when neither request nor PO carries a warehouse', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: null }));
    await expect(ctx.service.generateFromPo('po-1', {}, operator)).rejects.toBeInstanceOf(
      PurchaseReceiptWarehouseMissingError,
    );
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
  });
});

describe('generateFromOrderItem 订单行「去收货」(2026-10-16)', () => {
  it('PO 有收货仓库意向时直接用其仓库', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-po' }));
    await ctx.service.generateFromOrderItem('item-1', operator);
    expect(ctx.warehouse.getEntityById).toHaveBeenCalledWith('wh-po');
    expect(ctx.repository.insertWithItems.mock.calls[0]?.[1]).toMatchObject({
      warehouseId: 'wh-po',
    });
  });

  it('PO 无收货仓库意向时回退店铺绑定仓（用户拍板）', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: null }), {
      storeDefaultWarehouseId: 'wh-store',
    });
    await ctx.service.generateFromOrderItem('item-1', operator);
    expect(ctx.warehouse.getEntityById).toHaveBeenCalledWith('wh-store');
    expect(ctx.repository.insertWithItems.mock.calls[0]?.[1]).toMatchObject({
      warehouseId: 'wh-store',
    });
  });

  it('无有效采购单时报 ORDER_LINE_NOT_ORDERED，不生成草稿', async () => {
    const ctx = setup(buildPo({}), { activePoId: null });
    await expect(ctx.service.generateFromOrderItem('item-1', operator)).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_LINE_NOT_ORDERED',
    });
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
  });

  it('PO 意向与店铺绑定仓皆无时报 WAREHOUSE_MISSING', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: null }), { storeDefaultWarehouseId: null });
    await expect(ctx.service.generateFromOrderItem('item-1', operator)).rejects.toBeInstanceOf(
      PurchaseReceiptWarehouseMissingError,
    );
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
  });
});

describe('generateFromPosBatch (2026-10-13 采购单页多选批量)', () => {
  it('generates one draft per PO and isolates per-PO failures', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-po' }));
    const single = vi
      .spyOn(ctx.service, 'generateFromPo')
      .mockResolvedValueOnce({ id: 'r-1', receiptNo: 'PR000001' } as never)
      .mockRejectedValueOnce(new PurchaseReceiptWarehouseMissingError('PO000002'));
    vi.mocked(ctx.poRepository.findById)
      .mockResolvedValueOnce({ id: 'po-1', poNo: 'PO000001' })
      .mockResolvedValueOnce({ id: 'po-2', poNo: 'PO000002' });

    const result = await ctx.service.generateFromPosBatch(
      { items: [{ poId: 'po-1' }, { poId: 'po-2', warehouseId: 'wh-req' }] },
      operator,
    );

    expect(single).toHaveBeenNthCalledWith(1, 'po-1', { warehouseId: undefined }, operator);
    expect(single).toHaveBeenNthCalledWith(2, 'po-2', { warehouseId: 'wh-req' }, operator);
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(result.results[0]).toMatchObject({
      poNo: 'PO000001',
      ok: true,
      receiptNo: 'PR000001',
    });
    expect(result.results[1]).toMatchObject({
      poNo: 'PO000002',
      ok: false,
      code: 'PURCHASE_RECEIPT_WAREHOUSE_MISSING',
    });
  });

  it('labels an unknown PO as a failure with poNo = null', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-po' }));
    vi.mocked(ctx.poRepository.findById).mockResolvedValueOnce(null);
    const single = vi
      .spyOn(ctx.service, 'generateFromPo')
      .mockRejectedValueOnce(new PurchaseOrderNotFoundError('po-x'));

    const result = await ctx.service.generateFromPosBatch({ items: [{ poId: 'po-x' }] }, operator);

    expect(single).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ poNo: null, ok: false });
  });
});

describe('generateFromPo duplicate-draft guard (决策 0021)', () => {
  it('refuses a second draft while an active DRAFT exists for the PO', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    ctx.repository.findActiveByPurchaseOrderId.mockResolvedValue([
      { id: 'r-existing', receiptNo: 'PR000009', status: 'DRAFT' },
    ]);
    await expect(ctx.service.generateFromPo('po-1', {}, operator)).rejects.toBeInstanceOf(
      PurchaseReceiptDuplicateDraftError,
    );
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
  });

  it('allows generating again once the previous receipt is CANCELLED', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    ctx.repository.findActiveByPurchaseOrderId.mockResolvedValue([]);
    await ctx.service.generateFromPo('po-1', {}, operator);
    expect(ctx.repository.findActiveByPurchaseOrderId).toHaveBeenCalledWith('po-1');
    expect(ctx.repository.insertWithItems).toHaveBeenCalledOnce();
  });

  it('allows generating when a previous receipt is already RECEIVED', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    ctx.repository.findActiveByPurchaseOrderId.mockResolvedValue([
      { id: 'r-done', receiptNo: 'PR000010', status: 'RECEIVED' },
    ]);
    await ctx.service.generateFromPo('po-1', {}, operator);
    expect(ctx.repository.insertWithItems).toHaveBeenCalledOnce();
  });
});

describe('default receiving bin resolution (决策 0021)', () => {
  it('prefills each line with the SKU current bin when it has stock', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    ctx.inventoryQuery.findCurrentBinId.mockResolvedValue('bin-current');
    await ctx.service.generateFromPo('po-1', {}, operator);
    const rows = ctx.repository.insertWithItems.mock.calls[0]?.[2] as Array<{ binId: string }>;
    expect(rows[0]?.binId).toBe('bin-current');
    // The staging fallback is never needed when every SKU has a current bin.
    expect(ctx.binService.ensureReceiptStagingBin).not.toHaveBeenCalled();
  });

  it('falls back to a staging bin (auto-created once) when the SKU has no stock', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    ctx.inventoryQuery.findCurrentBinId.mockResolvedValue(null);
    ctx.binService.countByWarehouse.mockResolvedValue(2);
    await ctx.service.generateFromPo('po-1', {}, operator);
    const rows = ctx.repository.insertWithItems.mock.calls[0]?.[2] as Array<{ binId: string }>;
    expect(rows[0]?.binId).toBe('bin-staging');
    expect(ctx.binService.ensureReceiptStagingBin).toHaveBeenCalledOnce();
  });

  it('leaves binId null for a warehouse that has no bins at all', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    ctx.inventoryQuery.findCurrentBinId.mockResolvedValue(null);
    ctx.binService.countByWarehouse.mockResolvedValue(0);
    await ctx.service.generateFromPo('po-1', {}, operator);
    const rows = ctx.repository.insertWithItems.mock.calls[0]?.[2] as Array<{
      binId: string | null;
    }>;
    expect(rows[0]?.binId).toBeNull();
    expect(ctx.binService.ensureReceiptStagingBin).not.toHaveBeenCalled();
  });

  it('honours an explicit defaultBinId for every line', async () => {
    const ctx = setup(buildPo({ receivingWarehouseId: 'wh-1' }));
    await ctx.service.generateFromPo('po-1', { defaultBinId: 'bin-explicit' }, operator);
    const rows = ctx.repository.insertWithItems.mock.calls[0]?.[2] as Array<{ binId: string }>;
    expect(rows[0]?.binId).toBe('bin-explicit');
    expect(ctx.inventoryQuery.findCurrentBinId).not.toHaveBeenCalled();
  });
});

describe('confirm over-receipt guard (决策 0021)', () => {
  function setupConfirm(remaining: { quantity: string; receivedQuantity: string } | null) {
    const receipt = {
      id: 'receipt-1',
      receiptNo: 'PR000001',
      warehouseId: 'wh-1',
      purchaseOrderId: null,
      supplierId: null,
      sourceNote: null,
      receivedAt: null,
      remark: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'DRAFT',
    };
    const repository = {
      findById: vi.fn().mockResolvedValue(receipt),
      findItemsWithRefs: vi.fn().mockResolvedValue([
        {
          item: {
            id: 'item-r1',
            skuId: 'sku-1',
            binId: 'bin-1',
            quantity: '5.000',
            unitCost: null,
            serialNumbers: null,
            purchaseOrderItemId: 'po-item-1',
          },
          skuCode: 'SKU000000001',
          skuName: 'x',
          binCode: 'A01',
        },
      ]),
      lockById: vi.fn().mockResolvedValue(receipt),
      findPoItemRemainingInTx: vi
        .fn()
        .mockResolvedValue(remaining === null ? null : { skuCode: 'SKU000000001', ...remaining }),
      updateHeader: vi.fn().mockResolvedValue(undefined),
      accruePoItemReceived: vi.fn().mockResolvedValue(undefined),
    };
    const runner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      manager: {},
      query: vi.fn().mockResolvedValue([{ po_id: 'po-1' }]),
    };
    const inventoryService = {
      receiveStockInTx: vi.fn().mockResolvedValue({ wrote: true }),
      // 提交后广播库存增加事件（2026-10-17 自动分配修复）。
      emitStockIncreased: vi.fn(),
    };
    const service = new PurchaseReceiptService(
      {
        transaction: vi.fn(),
        createQueryRunner: () => runner,
      } as unknown as DataSource,
      repository as unknown as PurchaseReceiptRepository,
      {
        recomputeStatus: vi.fn().mockResolvedValue('RECEIVED'),
        updateHeader: vi.fn().mockResolvedValue(undefined),
      } as unknown as PurchaseOrderRepository,
      {} as unknown as SupplierService,
      {} as unknown as SkuService,
      { getEntityById: vi.fn().mockResolvedValue({ id: 'wh-1' }) } as unknown as WarehouseService,
      {} as unknown as WarehouseBinService,
      {
        resolveDefaultWarehouseId: vi.fn().mockResolvedValue(null),
      } as unknown as WarehousePlatformBindingService,
      { getItemFulfillment: vi.fn() } as unknown as OrderService,
      inventoryService as unknown as InventoryService,
      {} as unknown as InventoryQueryService,
      {} as unknown as BusinessCodeService,
      { record: vi.fn() } as unknown as OperationLogService,
    );
    return { service, repository, inventoryService, runner };
  }

  it('rejects a confirm whose line exceeds the PO item remaining quantity (409, no stock)', async () => {
    const ctx = setupConfirm({ quantity: '10.000', receivedQuantity: '7.000' });
    await expect(ctx.service.confirm('receipt-1', operator)).rejects.toMatchObject({
      code: 'PURCHASE_RECEIPT_EXCEEDS_ORDERED',
    });
    expect(ctx.inventoryService.receiveStockInTx).not.toHaveBeenCalled();
    expect(ctx.runner.rollbackTransaction).toHaveBeenCalled();
  });

  it('confirms normally when the line fits within the remaining quantity', async () => {
    const ctx = setupConfirm({ quantity: '10.000', receivedQuantity: '7.000' });
    ctx.repository.findItemsWithRefs.mockResolvedValue([
      {
        item: {
          id: 'item-r1',
          skuId: 'sku-1',
          binId: 'bin-1',
          quantity: '3.000',
          unitCost: null,
          serialNumbers: null,
          purchaseOrderItemId: 'po-item-1',
        },
        skuCode: 'SKU000000001',
        skuName: 'x',
        binCode: 'A01',
      },
    ]);
    const result = await ctx.service.confirm('receipt-1', operator);
    expect(result.idempotentReplay).toBe(false);
    expect(ctx.inventoryService.receiveStockInTx).toHaveBeenCalledOnce();
    expect(ctx.runner.commitTransaction).toHaveBeenCalled();
  });

  it('库存增加事件在**提交之后**广播（2026-10-17 自动分配修复）', async () => {
    const ctx = setupConfirm({ quantity: '10.000', receivedQuantity: '7.000' });
    ctx.repository.findItemsWithRefs.mockResolvedValue([
      {
        item: {
          id: 'item-r1',
          skuId: 'sku-1',
          binId: 'bin-1',
          quantity: '3.000',
          unitCost: null,
          serialNumbers: null,
          purchaseOrderItemId: 'po-item-1',
        },
        skuCode: 'SKU000000001',
        skuName: 'x',
        binCode: 'A01',
      },
    ]);
    // 提交前广播会让监听器读不到新建的余额行 → 误判库存不足（原 bug）。
    let committed = false;
    let emittedAfterCommit = true;
    ctx.runner.commitTransaction.mockImplementation(async () => {
      committed = true;
    });
    ctx.inventoryService.emitStockIncreased.mockImplementation(() => {
      emittedAfterCommit = committed;
    });

    await ctx.service.confirm('receipt-1', operator);

    expect(ctx.inventoryService.emitStockIncreased).toHaveBeenCalledWith({
      skuId: 'sku-1',
      warehouseId: expect.any(String),
      eventType: 'RECEIVE',
    });
    expect(emittedAfterCommit).toBe(true);
  });
});
