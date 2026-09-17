import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { FinanceTransactionService } from './finance-transaction.service';
import { FinanceTransactionRepository } from '../repositories/finance-transaction.repository';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { StoreService } from '../../store/services/store.service';
import { SupplierService } from '../../purchase/services/supplier.service';
import { PurchaseOrderService } from '../../purchase/services/purchase-order.service';
import { OrderService } from '../../order/services/order.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { FinanceRelationRequiredError } from '../errors/finance.errors';

const operator = { userId: null, username: 'tester' };
const manager = {} as EntityManager;

function payableFact(id: string) {
  return { id, payableAmount: '100.0000', hasUnpricedLines: false, status: 'ORDERED' };
}

function setup() {
  const repository = {
    insert: vi.fn(async () => ({ id: 'tx-1', voucherNo: 'FV000001' })),
    sumPaidByPurchaseOrderIds: vi.fn(async () => new Map()),
  };
  const codes = { nextFinanceVoucherNo: vi.fn(async () => 'FV000001') };
  const store = { getEntityById: vi.fn(async () => ({ id: 'store-1' })) };
  const supplier = {
    getEntityById: vi.fn(async (id: string) => (id === 'supplier-1' ? { id } : null)),
  };
  const orders = { getOrderOrThrow: vi.fn(async () => ({ id: 'order-1' })) };
  const log = { record: vi.fn(async () => undefined) };
  const transaction = vi.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
  const purchaseOrder = {
    listPayableFacts: vi.fn(async () => [payableFact('po-1')]),
  };
  const service = new FinanceTransactionService(
    { transaction } as unknown as DataSource,
    repository as unknown as FinanceTransactionRepository,
    codes as unknown as BusinessCodeService,
    store as unknown as StoreService,
    supplier as unknown as SupplierService,
    purchaseOrder as unknown as PurchaseOrderService,
    orders as unknown as OrderService,
    log as unknown as OperationLogService,
  );
  return { service, transaction, repository, supplier, purchaseOrder, log };
}

const baseInput = {
  direction: 'EXPENSE' as const,
  category: 'PURCHASE_PAYMENT' as const,
  amount: '10.0000',
};

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('PURCHASE_PAYMENT supplier relation (finance.md §3.3, user advice #13)', () => {
  it('accepts a payment without supplierId (white-label / one-off online purchase)', async () => {
    const created = await ctx.service.create({ ...baseInput, purchaseOrderId: 'po-1' }, operator);
    expect(created).toMatchObject({ id: 'tx-1', voucherNo: 'FV000001' });
    expect(ctx.repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ supplierId: null, purchaseOrderId: 'po-1' }),
    );
    expect(ctx.supplier.getEntityById).not.toHaveBeenCalled();
    expect(ctx.log.record).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'supplier-1'])(
    'requires only the PO when purchaseOrderId is missing (supplierId=%s)',
    async (supplierId) => {
      const result = ctx.service.create({ ...baseInput, supplierId }, operator);
      await expect(result).rejects.toBeInstanceOf(FinanceRelationRequiredError);
      await expect(result).rejects.toMatchObject({
        code: 'FINANCE_RELATION_REQUIRED',
        message: '该类别必须关联：采购单',
        details: { required: ['采购单'] },
      });
      expect(ctx.transaction).not.toHaveBeenCalled();
    },
  );

  it('accepts and preserves an existing supplierId', async () => {
    await ctx.service.create(
      { ...baseInput, purchaseOrderId: 'po-1', supplierId: 'supplier-1' },
      operator,
    );
    expect(ctx.supplier.getEntityById).toHaveBeenCalledWith('supplier-1');
    expect(ctx.repository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ supplierId: 'supplier-1', purchaseOrderId: 'po-1' }),
    );
  });

  it('still rejects overpayment without a supplier', async () => {
    await expect(
      ctx.service.create({ ...baseInput, amount: '100.0001', purchaseOrderId: 'po-1' }, operator),
    ).rejects.toMatchObject({ code: 'FINANCE_OVERPAYMENT' });
    expect(ctx.transaction).not.toHaveBeenCalled();
  });

  it('still rejects payment for a cancelled PO without a supplier', async () => {
    ctx.purchaseOrder.listPayableFacts.mockResolvedValue([
      { ...payableFact('po-1'), status: 'CANCELLED' },
    ]);
    await expect(
      ctx.service.create({ ...baseInput, purchaseOrderId: 'po-1' }, operator),
    ).rejects.toMatchObject({
      code: 'FINANCE_OVERPAYMENT',
      details: { message: '已取消的采购单不能登记付款' },
    });
    expect(ctx.transaction).not.toHaveBeenCalled();
  });

  it('keeps supplier existence validation when supplierId is provided', async () => {
    await expect(
      ctx.service.create(
        { ...baseInput, purchaseOrderId: 'po-1', supplierId: 'supplier-404' },
        operator,
      ),
    ).rejects.toMatchObject({
      code: 'FINANCE_RELATION_NOT_FOUND',
      details: { relation: '供应商' },
    });
  });
});
