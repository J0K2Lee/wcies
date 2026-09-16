import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import { SupplierService } from '../../purchase/services/supplier.service';
import { PurchaseOrderService } from '../../purchase/services/purchase-order.service';
import { amountFromDb, formatAmount } from '../../../common/utils/money';
import { PurchasePaymentState } from '../enums/finance.constants';
import { FinanceTransactionRepository } from '../repositories/finance-transaction.repository';
import { OrderSettlementRepository } from '../repositories/order-settlement.repository';

export interface FinanceSummaryDto {
  range: { from: string | null; to: string | null };
  incomeTotal: string;
  expenseTotal: string;
  netTotal: string;
  settledRevenue: string;
  settledCost: string;
  settledProfit: string;
  unpaidPurchaseTotal: string;
  confirmedPayoutTotal: string;
}

export interface PayableRow {
  id: string;
  poNo: string;
  supplierId: string | null;
  supplierName: string | null;
  status: string;
  orderedAt: Date;
  payableAmount: string;
  paidAmount: string;
  unpaidAmount: string;
  paymentState: PurchasePaymentState;
  hasUnpricedLines: boolean;
}

/** Read-only derived reports (finance.md §6/§7 - nothing here is a fact). */
@Injectable()
export class FinanceReportService {
  constructor(
    private readonly transactionRepo: FinanceTransactionRepository,
    private readonly settlementRepo: OrderSettlementRepository,
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly supplierService: SupplierService,
  ) {}

  async summary(from?: Date, to?: Date): Promise<FinanceSummaryDto> {
    const [nets, profit, payouts, payables] = await Promise.all([
      this.transactionRepo.sumNetByDirection({ from, to }),
      this.settlementRepo.sumProfitTotals({ from, to }),
      this.transactionRepo.sumConfirmedPayouts({ from, to }),
      this.listPayables(),
    ]);
    const income = amountFromDb(nets.income) ?? 0n;
    const expense = amountFromDb(nets.expense) ?? 0n;
    const unpaid = payables.items
      .filter((row) => row.status !== 'CANCELLED')
      .reduce((sum, row) => sum + (amountFromDb(row.unpaidAmount) ?? 0n), 0n);
    return {
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      incomeTotal: formatAmount(income),
      expenseTotal: formatAmount(expense),
      netTotal: formatAmount(income - expense),
      settledRevenue: profit.revenue,
      settledCost: profit.cost,
      settledProfit: profit.profit,
      unpaidPurchaseTotal: formatAmount(unpaid),
      confirmedPayoutTotal: payouts,
    };
  }

  /**
   * Purchase payables list (finance.md §6): payable/paid/unpaid are all
   * DERIVED at read time - the payment state is never stored.
   */
  async listPayables(
    filters: {
      paymentState?: string;
      keyword?: string;
      page: number;
      pageSize: number;
    } = { page: 1, pageSize: 50 },
  ): Promise<{ items: PayableRow[]; meta: PageMeta }> {
    const facts = await this.purchaseOrderService.listPayableFacts();
    const paidMap = await this.transactionRepo.sumPaidByPurchaseOrderIds(
      facts.map((fact) => fact.id),
    );
    const supplierIds = [
      ...new Set(facts.map((fact) => fact.supplierId).filter((id): id is string => id !== null)),
    ];
    const supplierNames = new Map<string, string>();
    for (const supplierId of supplierIds) {
      const supplier = await this.supplierService.getEntityById(supplierId);
      supplierNames.set(supplierId, supplier?.name ?? '');
    }

    let rows: PayableRow[] = facts
      .filter((fact) => fact.status !== 'CANCELLED')
      .map((fact) => {
        const payable = amountFromDb(fact.payableAmount) ?? 0n;
        const paid = amountFromDb(paidMap.get(fact.id)?.paid ?? '0') ?? 0n;
        const unpaid = payable - paid;
        const paymentState = derivePaymentState(payable, paid);
        return {
          id: fact.id,
          poNo: fact.poNo,
          supplierId: fact.supplierId,
          supplierName:
            fact.supplierId === null ? null : (supplierNames.get(fact.supplierId) ?? ''),
          status: fact.status,
          orderedAt: fact.orderedAt,
          payableAmount: formatAmount(payable),
          paidAmount: formatAmount(paid),
          unpaidAmount: formatAmount(unpaid),
          paymentState,
          hasUnpricedLines: fact.hasUnpricedLines,
        };
      });

    if (filters.keyword !== undefined && filters.keyword !== '') {
      const keyword = filters.keyword.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.poNo.toLowerCase().includes(keyword) ||
          (row.supplierName ?? '').toLowerCase().includes(keyword),
      );
    }
    if (filters.paymentState !== undefined && filters.paymentState !== '') {
      rows = rows.filter((row) => row.paymentState === filters.paymentState);
    }

    const total = rows.length;
    const start = (filters.page - 1) * filters.pageSize;
    const items = rows.slice(start, start + filters.pageSize);
    return { items, meta: { page: filters.page, pageSize: filters.pageSize, total } };
  }
}

/** finance.md §6 state machine - pure derivation from payable/paid. */
function derivePaymentState(payable: bigint, paid: bigint): PurchasePaymentState {
  if (payable === 0n) {
    return 'NOTHING_TO_PAY';
  }
  if (paid === 0n) {
    return 'UNPAID';
  }
  if (paid < payable) {
    return 'PARTIAL';
  }
  if (paid === payable) {
    return 'PAID';
  }
  return 'OVERPAID';
}
