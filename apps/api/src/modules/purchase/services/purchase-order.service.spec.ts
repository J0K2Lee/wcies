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
import { SkuImageService } from '../../product/services/sku-image.service';
import { ProcurementCoverageService } from './procurement-coverage.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from '../entities/purchase-order-item.entity';
import { CreatePurchaseOrderRequestDto } from '../dto/purchase-order.dto';
import { PurchaseReceiptService } from './purchase-receipt.service';

const operator = { userId: null, username: 'tester' };
const manager = { query: vi.fn().mockResolvedValue(undefined) } as unknown as EntityManager;
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
  receivingWarehouseId: 'wh-1',
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
  receivingWarehouseId: 'wh-1',
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
  const receiptService = {
    resolveDefaultReceiptBins: vi
      .fn()
      .mockImplementation(
        async (_whId: string, explicitBinId: string | undefined, skuIds: string[]) => {
          const map = new Map<string, string | null>();
          for (const skuId of skuIds) {
            map.set(skuId, explicitBinId ?? null);
          }
          return map;
        },
      ),
  };
  const codes = {
    nextPurchaseOrderNo: vi.fn().mockResolvedValue('PO000001'),
    nextPurchaseReceiptNo: vi.fn().mockResolvedValue('PR000001'),
  };
  const log = { record: vi.fn().mockResolvedValue(undefined) };
  const coverage = { getWarehouseGap: vi.fn().mockResolvedValue({ gapQty: '10.000' }) };
  const transaction = vi.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
  const service = new PurchaseOrderService(
    { transaction } as unknown as DataSource,
    repository as unknown as PurchaseOrderRepository,
    { getEntityById: vi.fn().mockResolvedValue({}) } as unknown as SupplierService,
    { getEntityById: vi.fn().mockResolvedValue({}) } as unknown as SkuService,
    { primaryUrlsBySkuIds: vi.fn().mockResolvedValue(new Map()) } as unknown as SkuImageService,
    codes as unknown as BusinessCodeService,
    log as unknown as OperationLogService,
    receipts as unknown as PurchaseReceiptRepository,
    warehouse as unknown as WarehouseService,
    receiptService as unknown as PurchaseReceiptService,
    coverage as unknown as ProcurementCoverageService,
  );
  return {
    service,
    repository,
    receipts,
    warehouse,
    receiptService,
    coverage,
    codes,
    log,
    transaction,
  };
}
let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('purchase order optional receiving draft', () => {
  it('creates a numbered draft with all PO lines and source fields in the same transaction', async () => {
    await ctx.service.create({ ...input, receipt: { defaultBinId: 'bin-1' } }, operator);
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
    // 目标仓是采购单表头字段（决策 0023），收货草稿仓库与它同源。
    expect(ctx.repository.insertWithItems.mock.calls[0]?.[1]).toMatchObject({
      receivingWarehouseId: 'wh-1',
    });
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
    await ctx.service.create({ ...input, receipt: {} }, operator);
    expect(ctx.receipts.insertWithItems.mock.calls[0]?.[2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ binId: null })]),
    );
  });

  it('without receipt preserves the existing create flow and current purchase time', async () => {
    const before = Date.now();
    await ctx.service.create(input, operator);
    expect(ctx.receipts.insertWithItems).not.toHaveBeenCalled();
    expect(ctx.codes.nextPurchaseReceiptNo).not.toHaveBeenCalled();
    const header = ctx.repository.insertWithItems.mock.calls[0]?.[1] as {
      orderedAt: Date;
      receivingWarehouseId: string;
    };
    expect(header.orderedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(header.orderedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(header.receivingWarehouseId).toBe('wh-1');
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
    await expect(ctx.service.create(input, operator)).rejects.toBeInstanceOf(
      WarehouseNotFoundError,
    );
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
    expect(ctx.transaction).not.toHaveBeenCalled();
    expect(ctx.log.record).not.toHaveBeenCalled();
  });

  it('propagates draft insertion failure out of the transaction without success logs', async () => {
    ctx.receipts.insertWithItems.mockRejectedValue(new Error('insert failed'));
    await expect(ctx.service.create({ ...input, receipt: {} }, operator)).rejects.toThrow(
      'insert failed',
    );
    expect(ctx.transaction).toHaveBeenCalledOnce();
    expect(ctx.log.record).not.toHaveBeenCalled();
  });
});

describe('purchase order replenish gap guard (决策 0023)', () => {
  it('STOCK purpose skips the gap check', async () => {
    await ctx.service.create(input, operator);
    expect(ctx.coverage.getWarehouseGap).not.toHaveBeenCalled();
  });

  it('REPLENISH rejects a line the in-transit stock already covers', async () => {
    ctx.coverage.getWarehouseGap.mockResolvedValue({
      demandQty: '2.000',
      inTransitQty: '2.000',
      gapQty: '0.000',
    });
    await expect(
      ctx.service.create({ ...input, purpose: 'REPLENISH' }, operator),
    ).rejects.toMatchObject({ code: 'PURCHASE_SKU_GAP_COVERED' });
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
  });

  it('REPLENISH rejects a quantity larger than the remaining gap', async () => {
    ctx.coverage.getWarehouseGap.mockResolvedValue({
      demandQty: '5.000',
      inTransitQty: '0.000',
      gapQty: '5.000',
    });
    await expect(
      ctx.service.create(
        { ...input, purpose: 'REPLENISH', items: [{ skuId: 'sku-1', quantity: '6' }] },
        operator,
      ),
    ).rejects.toMatchObject({ code: 'PURCHASE_ORDER_INVALID_STATE' });
    expect(ctx.repository.insertWithItems).not.toHaveBeenCalled();
  });

  it('REPLENISH allows a quantity within the gap', async () => {
    await ctx.service.create({ ...input, purpose: 'REPLENISH' }, operator);
    expect(ctx.coverage.getWarehouseGap).toHaveBeenCalledTimes(2);
    expect(ctx.repository.insertWithItems).toHaveBeenCalledOnce();
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
  const valid = {
    receivingWarehouseId: '00000000-0000-4000-8000-000000000001',
    items: [{ skuId: '00000000-0000-4000-8000-000000000001', quantity: '1' }],
  };
  it.each([
    { orderedAt: 'invalid' },
    { purpose: 'OTHER' },
    { receipt: { defaultBinId: 'invalid' } },
  ])('rejects malformed optional input %j', async (patch) => {
    const errors = await validate(
      plainToInstance(CreatePurchaseOrderRequestDto, { ...valid, ...patch }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
  it('requires a target warehouse', async () => {
    const errors = await validate(
      plainToInstance(CreatePurchaseOrderRequestDto, { items: valid.items }),
    );
    expect(errors.some((error) => error.property === 'receivingWarehouseId')).toBe(true);
  });
  it('accepts valid nested receiving options and purchase time', async () => {
    expect(
      await validate(
        plainToInstance(CreatePurchaseOrderRequestDto, {
          ...valid,
          orderedAt: '2026-09-01T00:00:00Z',
          receipt: { defaultBinId: valid.items[0]!.skuId },
        }),
      ),
    ).toEqual([]);
  });
});
