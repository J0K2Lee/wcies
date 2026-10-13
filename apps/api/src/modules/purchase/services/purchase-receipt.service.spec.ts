import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { PurchaseReceiptService } from './purchase-receipt.service';
import { PurchaseReceiptRepository } from '../repositories/purchase-receipt.repository';
import { PurchaseOrderRepository } from '../repositories/purchase-order.repository';
import { SupplierService } from './supplier.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { PurchaseReceiptWarehouseMissingError } from '../errors/purchase-errors';

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

function setup(po: ReturnType<typeof buildPo>) {
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
    insertWithItems: vi.fn().mockResolvedValue(receipt),
  };
  const poRepository = {
    findById: vi.fn().mockResolvedValue(po),
    findItemsWithRefs: vi
      .fn()
      .mockResolvedValue([
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
    {} as unknown as InventoryService,
    {} as unknown as InventoryQueryService,
    codes as unknown as BusinessCodeService,
    log as unknown as OperationLogService,
  );
  return { service, repository, poRepository, warehouse, log };
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
