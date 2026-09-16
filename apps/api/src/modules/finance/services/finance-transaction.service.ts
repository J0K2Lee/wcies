import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { StoreService } from '../../store/services/store.service';
import { SupplierService } from '../../purchase/services/supplier.service';
import { PurchaseOrderService } from '../../purchase/services/purchase-order.service';
import { OrderService } from '../../order/services/order.service';
import { OrderNotFoundError } from '../../order/errors/order.errors';
import { amountFromDb, formatAmount, parseAmount } from '../../../common/utils/money';
import { FinanceTransactionEntity } from '../entities/finance-transaction.entity';
import {
  FinanceCategoryDirectionMismatchError,
  FinanceOverpaymentError,
  FinanceRelationNotFoundError,
  FinanceRelationRequiredError,
  FinanceTransactionNotFoundError,
} from '../errors/finance.errors';
import {
  FINANCE_CATEGORY_DIRECTIONS,
  FinanceDirection,
  FinanceTransactionCategory,
} from '../enums/finance.constants';
import {
  FinanceTransactionFilters,
  FinanceTransactionRepository,
} from '../repositories/finance-transaction.repository';

const ENTITY_TYPE = 'FINANCE_TRANSACTION';

export interface CreateTransactionInput {
  direction: FinanceDirection;
  category: FinanceTransactionCategory;
  amount: string;
  currency?: string;
  occurredAt?: Date;
  storeId?: string;
  supplierId?: string;
  orderId?: string;
  purchaseOrderId?: string;
  remark?: string | null;
}

/**
 * Append-only finance ledger commands (finance.md §3). Vouchers are created
 * once and can only be REVERSED by a twin - there is no update, no delete.
 */
@Injectable()
export class FinanceTransactionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: FinanceTransactionRepository,
    private readonly businessCode: BusinessCodeService,
    private readonly storeService: StoreService,
    private readonly supplierService: SupplierService,
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly orderService: OrderService,
    private readonly operationLog: OperationLogService,
  ) {}

  async create(input: CreateTransactionInput, operator: OperatorContext) {
    await this.validate(input);

    const created = await this.dataSource.transaction(async (manager) => {
      const voucherNo = await this.businessCode.nextFinanceVoucherNo(manager);
      return this.repository.insert(manager, {
        voucherNo,
        direction: input.direction,
        category: input.category,
        amount: formatAmount(parseAmount(input.amount)),
        currency: input.currency ?? 'CNY',
        occurredAt: input.occurredAt ?? new Date(),
        storeId: input.storeId ?? null,
        supplierId: input.supplierId ?? null,
        orderId: input.orderId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        payoutId: null,
        reversedByVoucherNo: null,
        remark: input.remark ?? null,
        createdBy: operator.userId,
      });
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: created.voucherNo,
      action: 'CREATE',
      changes: {
        direction: { from: null, to: created.direction },
        category: { from: null, to: created.category },
        amount: { from: null, to: created.amount },
      },
      operator,
    });
    return created;
  }

  /**
   * Reversal twin (finance.md §3.4): opposite direction, same category and
   * amount, reversed_by_voucher_no set both ways. Net effect of the pair on
   * every summary is zero.
   */
  async reverse(id: string, operator: OperatorContext): Promise<FinanceTransactionEntity> {
    const original = await this.repository.findById(id);
    if (original === null) {
      throw new FinanceTransactionNotFoundError(id);
    }
    if (original.reversedByVoucherNo !== null) {
      throw new FinanceTransactionNotFoundError(id);
    }

    const twin = await this.dataSource.transaction(async (manager) => {
      const voucherNo = await this.businessCode.nextFinanceVoucherNo(manager);
      const created = await this.repository.insert(manager, {
        voucherNo,
        direction: original.direction === 'INCOME' ? 'EXPENSE' : 'INCOME',
        category: original.category,
        amount: original.amount,
        currency: original.currency,
        occurredAt: new Date(),
        storeId: original.storeId,
        supplierId: original.supplierId,
        orderId: original.orderId,
        purchaseOrderId: original.purchaseOrderId,
        payoutId: null,
        reversedByVoucherNo: original.voucherNo,
        remark: original.remark === null ? null : `冲正 ${original.voucherNo}`,
        createdBy: operator.userId,
      });
      await manager
        .getRepository(FinanceTransactionEntity)
        .update({ id: original.id }, { reversedByVoucherNo: voucherNo, updatedAt: new Date() });
      return created;
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: original.id,
      entityCode: original.voucherNo,
      action: 'REVERSE',
      changes: { reversedByVoucherNo: { from: null, to: twin.voucherNo } },
      operator,
    });
    return twin;
  }

  async list(
    filters: FinanceTransactionFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: Array<Record<string, unknown>>; meta: PageMeta }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    // Flatten the row wrapper: the API returns voucher fields + display
    // names in ONE object (entity never leaks as a nested document).
    const items = rows.map((row) => ({
      ...row.transaction,
      storeName: row.storeName,
      supplierName: row.supplierName,
      orderNo: row.orderNo,
      purchaseOrderNo: row.purchaseOrderNo,
    }));
    return { items, meta: { page: page.page, pageSize: page.pageSize, total } };
  }

  async getDetail(id: string): Promise<FinanceTransactionEntity> {
    const transaction = await this.repository.findById(id);
    if (transaction === null) {
      throw new FinanceTransactionNotFoundError(id);
    }
    return transaction;
  }

  /** Unpaid balance of a PO in scaled bigint (0 when no priced lines). */
  async unpaidBalanceOf(purchaseOrderId: string): Promise<bigint> {
    const facts = await this.purchaseOrderService.listPayableFacts();
    const po = facts.find((fact) => fact.id === purchaseOrderId);
    if (po === undefined) {
      throw new FinanceRelationNotFoundError('采购单', purchaseOrderId);
    }
    const paidMap = await this.repository.sumPaidByPurchaseOrderIds([purchaseOrderId]);
    const paid = amountFromDb(paidMap.get(purchaseOrderId)?.paid ?? '0') ?? 0n;
    return (amountFromDb(po.payableAmount) ?? 0n) - paid;
  }

  /** Relation/direction validations shared by manual + payout creation. */
  private async validate(input: CreateTransactionInput): Promise<void> {
    const expectedDirection = FINANCE_CATEGORY_DIRECTIONS[input.category];
    if (expectedDirection === undefined) {
      throw new FinanceRelationNotFoundError('类别', input.category);
    }
    if (input.direction !== expectedDirection) {
      throw new FinanceCategoryDirectionMismatchError(
        input.category,
        input.direction,
        expectedDirection,
      );
    }
    if (parseAmount(input.amount) <= 0n) {
      throw new FinanceOverpaymentError({ message: '金额必须大于 0' });
    }

    if (input.category === 'PURCHASE_PAYMENT') {
      const missing: string[] = [];
      if (input.supplierId === undefined) {
        missing.push('供应商');
      }
      if (input.purchaseOrderId === undefined) {
        missing.push('采购单');
      }
      if (missing.length > 0) {
        throw new FinanceRelationRequiredError(missing);
      }
    }
    if (input.category === 'SALE_INCOME' || input.category === 'SALE_REFUND') {
      if (input.orderId === undefined) {
        throw new FinanceRelationRequiredError(['订单']);
      }
    }

    if (input.storeId !== undefined) {
      if ((await this.storeService.getEntityById(input.storeId)) === null) {
        throw new FinanceRelationNotFoundError('店铺', input.storeId);
      }
    }
    if (input.supplierId !== undefined) {
      if ((await this.supplierService.getEntityById(input.supplierId)) === null) {
        throw new FinanceRelationNotFoundError('供应商', input.supplierId);
      }
    }
    if (input.orderId !== undefined) {
      try {
        await this.orderService.getOrderOrThrow(input.orderId);
      } catch (error: unknown) {
        if (error instanceof OrderNotFoundError) {
          throw new FinanceRelationNotFoundError('订单', input.orderId);
        }
        throw error;
      }
    }
    if (input.purchaseOrderId !== undefined) {
      const facts = await this.purchaseOrderService.listPayableFacts();
      const po = facts.find((fact) => fact.id === input.purchaseOrderId);
      if (po === undefined) {
        throw new FinanceRelationNotFoundError('采购单', input.purchaseOrderId);
      }
      if (po.status === 'CANCELLED') {
        throw new FinanceOverpaymentError({
          message: '已取消的采购单不能登记付款',
          purchaseOrderId: input.purchaseOrderId,
        });
      }
      if (input.category === 'PURCHASE_PAYMENT') {
        const paidMap = await this.repository.sumPaidByPurchaseOrderIds([input.purchaseOrderId]);
        const paid = amountFromDb(paidMap.get(input.purchaseOrderId)?.paid ?? '0') ?? 0n;
        const payable = amountFromDb(po.payableAmount) ?? 0n;
        if (paid + parseAmount(input.amount) > payable) {
          throw new FinanceOverpaymentError({
            payableAmount: po.payableAmount,
            paidAmount: formatAmount(paid),
            attemptAmount: input.amount,
            hasUnpricedLines: po.hasUnpricedLines,
          });
        }
      }
    }
  }
}
