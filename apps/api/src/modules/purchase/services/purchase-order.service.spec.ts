import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderRepository } from '../repositories/purchase-order.repository';
import { PurchaseReceiptRepository } from '../repositories/purchase-receipt.repository';
import { SupplierService } from './supplier.service';
import { SkuService } from '../../product/services/sku.service';
import { OrderService } from '../../order/services/order.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from '../entities/purchase-order-item.entity';
import { CreatePurchaseOrderRequestDto } from '../dto/purchase-order.dto';

const operator = { userId: null, username: 'tester' };
const manager = {} as EntityManager;
const po: PurchaseOrderEntity = {
  id: 'po-1',
  poNo: 'PO000001',
  supplierId: 'supplier-1',
  sourceNote: 'source',
  status: 'ORDERED',
  orderedAt: new Date(),
  expectedAt: null,
  remark: null,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const items: PurchaseOrderItemEntity[] = [
  {
    id: 'item-1',
    poId: po.id,
    skuId: 'sku-1',
    quantity: '2.500',
    unitCost: '9.1234',
    receivedQuantity: '0.000',
    orderItemId: null,
    remark: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'item-2',
    poId: po.id,
    skuId: 'sku-2',
    quantity: '3.000',
    unitCost: null,
    receivedQuantity: '0.000',
    orderItemId: null,
    remark: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
const input: CreatePurchaseOrderRequestDto = {
  supplierId: po.supplierId!,
  sourceNote: po.sourceNote!,
  items: [
    { skuId: 'sku-1', quantity: '2.5', unitCost: '9.1234' },
    { skuId: 'sku-2', quantity: '3' },
  ],
};

function setup() {
  const repository = {
    findById: vi.fn().mockResolvedValue({ ...po }),
    lockById: vi.fn().mockResolvedValue({ ...po }),
    findItemsWithRefs: vi
      .fn()
      .mockResolvedValue(items.map((item) => ({ item, skuCode: '', skuName: '', orderNo: null }))),
    findItemsInTx: vi.fn().mockResolvedValue(items),
    findActiveItemByOrderItemId: vi.fn().mockResolvedValue(null),
    insertWithItems: vi.fn().mockResolvedValue({ ...po }),
    updateHeader: vi.fn().mockResolvedValue(undefined),
  };
  const receipts = {
    insertWithItems: vi
      .fn()
      .mockResolvedValue({ id: 'receipt-1', receiptNo: 'PR000001', warehouseId: 'wh-1' }),
    findDraftsByPurchaseOrderId: vi.fn().mockResolvedValue([]),
    updateHeader: vi.fn().mockResolvedValue(undefined),
  };
  const warehouse = { getEntityById: vi.fn().mockResolvedValue({ id: 'wh-1' }) };
  const codes = {
    nextPurchaseOrderNo: vi.fn().mockResolvedValue('PO000001'),
    nextPurchaseReceiptNo: vi.fn().mockResolvedValue('PR000001'),
  };
  const log = { record: vi.fn().mockResolvedValue(undefined) };
  const transaction = vi.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
  const service = new PurchaseOrderService(
    { transaction } as unknown as DataSource,
    repository as unknown as PurchaseOrderRepository,
    { getEntityById: vi.fn().mockResolvedValue({}) } as unknown as SupplierService,
    { getEntityById: vi.fn().mockResolvedValue({}) } as unknown as SkuService,
    { getItemFulfillment: vi.fn() } as unknown as OrderService,
    codes as unknown as BusinessCodeService,
    log as unknown as OperationLogService,
    receipts as unknown as PurchaseReceiptRepository,
    warehouse as unknown as WarehouseService,
  );
  return { service, repository, receipts, warehouse, codes, log, transaction };
}
let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('purchase order optional receiving draft', () => {
  it('creates a numbered draft with all PO lines and source fields in the same transaction', async () => {
    await ctx.service.create(
      { ...input, receipt: { warehouseId: 'wh-1', defaultBinId: 'bin-1' } },
      operator,
    );
    expect(ctx.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.repository.insertWithItems.mock.calls[0]?.[0]).toBe(manager);
    expect(ctx.repository.findItemsInTx).toHaveBeenCalledWith(manager, po.id);
    expect(ctx.codes.nextPurchaseReceiptNo).toHaveBeenCalledOnce();
    expect(ctx.receipts.insertWithItems).toHaveBeenCalledWith(
      manager,
      {
        receiptNo: 'PR000001',
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        sourceNote: po.sourceNote,
        warehouseId: 'wh-1',
        status: 'DRAFT',
        remark: `从采购单 ${po.poNo} 创建时自动生成`,
        createdBy: null,
      },
      items.map((item) => ({
        purchaseOrderItemId: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        binId: 'bin-1',
        serialNumbers: null,
        remark: null,
      })),
    );
    expect(ctx.log.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'PURCHASE_RECEIPT',
        entityCode: 'PR000001',
        action: 'CREATE',
        operator,
      }),
    );
    expect(ctx.log.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'PURCHASE_ORDER', action: 'CREATE' }),
    );
  });

  it('leaves the bin empty when omitted', async () => {
    await ctx.service.create({ ...input, receipt: { warehouseId: 'wh-1' } }, operator);
    expect(ctx.receipts.insertWithItems.mock.calls[0]?.[2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ binId: null })]),
    );
  });

  it('without receipt preserves the existing create flow and current purchase time', async () => {
    const before = Date.now();
    await ctx.service.create(input, operator);
    expect(ctx.receipts.insertWithItems).not.toHaveBeenCalled();
    expect(ctx.codes.nextPurchaseReceiptNo).not.toHaveBeenCalled();
    expect(ctx.warehouse.getEntityById).not.toHaveBeenCalled();
    const header = ctx.repository.insertWithItems.mock.calls[0]?.[1] as { orderedAt: Date };
    expect(header.orderedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(header.orderedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(ctx.log.record).toHaveBeenCalledTimes(1);
  });

  it('uses manually specified purchase time', async () => {
    const orderedAt = '2026-09-01T12:30:00+08:00';
    await ctx.service.create({ ...input, orderedAt }, operator);
    expect(ctx.repository.insertWithItems).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ orderedAt: new Date(orderedAt) }),
      expect.any(Array),
    );
  });

  it('unknown warehouse rejects before a PO is inserted', async () => {
    ctx.warehouse.getEntityById.mockResolvedValue(null);
    await expect(
      ctx.service.create({ ...input, receipt: { warehouseId: 'missing' } }, operator),
    ).rejects.toBeInstanceOf(WarehouseNotFoundError);
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
    expect(ctx.transaction).not.toHaveBeenCalled();
    expect(ctx.log.record).not.toHaveBeenCalled();
  });

  it('propagates draft insertion failure out of the transaction without success logs', async () => {
    ctx.receipts.insertWithItems.mockRejectedValue(new Error('insert failed'));
    await expect(
      ctx.service.create({ ...input, receipt: { warehouseId: 'wh-1' } }, operator),
    ).rejects.toThrow('insert failed');
    expect(ctx.transaction).toHaveBeenCalledOnce();
    expect(ctx.log.record).not.toHaveBeenCalled();
  });
});

describe('purchase order cancellation', () => {
  it('cancels every linked draft in the PO transaction and audits each receipt', async () => {
    const drafts = [
      { id: 'r1', receiptNo: 'PR000001' },
      { id: 'r2', receiptNo: 'PR000002' },
    ];
    ctx.receipts.findDraftsByPurchaseOrderId.mockResolvedValue(drafts);
    await ctx.service.cancel(po.id, operator, 'cancel reason');
    expect(ctx.transaction).toHaveBeenCalledOnce();
    expect(ctx.receipts.findDraftsByPurchaseOrderId).toHaveBeenCalledWith(manager, po.id);
    for (const draft of drafts) {
      expect(ctx.receipts.updateHeader).toHaveBeenCalledWith(manager, draft.id, {
        status: 'CANCELLED',
      });
      expect(ctx.log.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'PURCHASE_RECEIPT',
          entityId: draft.id,
          entityCode: draft.receiptNo,
          action: 'CANCEL',
        }),
      );
    }
    expect(ctx.repository.updateHeader).toHaveBeenCalledWith(manager, po.id, {
      status: 'CANCELLED',
    });
    expect(ctx.log.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'PURCHASE_ORDER',
        changes: expect.objectContaining({ cancelledReceiptCount: { from: null, to: 2 } }),
      }),
    );
  });

  it('cancels a PO without receipts as before', async () => {
    await ctx.service.cancel(po.id, operator);
    expect(ctx.receipts.updateHeader).not.toHaveBeenCalled();
    expect(ctx.repository.updateHeader).toHaveBeenCalledWith(manager, po.id, {
      status: 'CANCELLED',
    });
    expect(ctx.log.record).toHaveBeenCalledTimes(1);
  });

  it.each(['RECEIVED', 'PARTIALLY_RECEIVED'])(
    'refuses %s without touching receipts',
    async (status) => {
      ctx.repository.findById.mockResolvedValue({ ...po, status });
      await expect(ctx.service.cancel(po.id, operator)).rejects.toMatchObject({
        code: 'PURCHASE_ORDER_INVALID_STATE',
      });
      expect(ctx.transaction).not.toHaveBeenCalled();
    },
  );

  it('rechecks received quantities after locking drafts and PO', async () => {
    ctx.repository.findItemsInTx.mockResolvedValue([{ ...items[0], receivedQuantity: '1.000' }]);
    await expect(ctx.service.cancel(po.id, operator)).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_INVALID_STATE',
    });
    expect(ctx.repository.updateHeader).not.toHaveBeenCalled();
    expect(ctx.receipts.updateHeader).not.toHaveBeenCalled();
    expect(ctx.log.record).not.toHaveBeenCalled();
  });
});

describe('purchase create request validation', () => {
  const valid = { items: [{ skuId: '00000000-0000-4000-8000-000000000001', quantity: '1' }] };
  it.each([
    { orderedAt: 'invalid' },
    { receipt: {} },
    { receipt: { warehouseId: 'invalid' } },
    { receipt: { warehouseId: valid.items[0]!.skuId, defaultBinId: 'invalid' } },
  ])('rejects malformed optional input %j', async (patch) => {
    const errors = await validate(
      plainToInstance(CreatePurchaseOrderRequestDto, { ...valid, ...patch }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
  it('accepts valid nested receiving options and purchase time', async () => {
    expect(
      await validate(
        plainToInstance(CreatePurchaseOrderRequestDto, {
          ...valid,
          orderedAt: '2026-09-01T00:00:00Z',
          receipt: { warehouseId: valid.items[0]!.skuId },
        }),
      ),
    ).toEqual([]);
  });
});
