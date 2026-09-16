import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { StoreService } from '../../store/services/store.service';
import { formatAmount, parseAmount } from '../../../common/utils/money';
import { FinancePayoutEntity } from '../entities/finance-payout.entity';
import {
  FinancePayoutInvalidStateError,
  FinancePayoutNotFoundError,
  FinancePayoutPeriodInvalidError,
  FinanceRelationNotFoundError,
} from '../errors/finance.errors';
import {
  FinancePayoutFilters,
  FinancePayoutRepository,
} from '../repositories/finance-payout.repository';
import { FinanceTransactionRepository } from '../repositories/finance-transaction.repository';
import { OrderSettlementRepository } from '../repositories/order-settlement.repository';

const ENTITY_TYPE = 'FINANCE_PAYOUT';

export interface CreatePayoutInput {
  storeId: string;
  periodStart: Date;
  periodEnd: Date;
  amount: string;
  currency?: string;
  remark?: string | null;
}

/** Platform payout batches (finance.md §4). */
@Injectable()
export class FinancePayoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: FinancePayoutRepository,
    private readonly transactionRepo: FinanceTransactionRepository,
    private readonly settlementRepo: OrderSettlementRepository,
    private readonly businessCode: BusinessCodeService,
    private readonly storeService: StoreService,
    private readonly operationLog: OperationLogService,
  ) {}

  async create(input: CreatePayoutInput, operator: OperatorContext) {
    if (input.periodStart > input.periodEnd) {
      throw new FinancePayoutPeriodInvalidError();
    }
    if (parseAmount(input.amount) <= 0n) {
      throw new FinancePayoutInvalidStateError('回款金额必须大于 0');
    }
    if ((await this.storeService.getEntityById(input.storeId)) === null) {
      throw new FinanceRelationNotFoundError('店铺', input.storeId);
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const payoutNo = await this.businessCode.nextFinancePayoutNo(manager);
      return this.repository.insert(manager, {
        payoutNo,
        storeId: input.storeId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        amount: formatAmount(parseAmount(input.amount)),
        currency: input.currency ?? 'CNY',
        status: 'DRAFT',
        remark: input.remark ?? null,
        createdBy: operator.userId,
      });
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: created.payoutNo,
      action: 'CREATE',
      changes: { status: { from: null, to: 'DRAFT' } },
      operator,
    });
    return created;
  }

  /**
   * DRAFT -> CONFIRMED (finance.md §4.2): the linked SALE_INCOME voucher is
   * minted in the SAME transaction; the partial unique index on payout_id
   * plus this in-tx existence check make double-confirmation impossible.
   */
  async confirm(id: string, operator: OperatorContext): Promise<FinancePayoutEntity> {
    const payout = await this.getPayoutOrThrow(id);
    if (payout.status !== 'DRAFT') {
      throw new FinancePayoutInvalidStateError(
        `回款单 ${payout.payoutNo} 当前状态 ${payout.status}，不能确认（仅 DRAFT 可确认）`,
        { payoutNo: payout.payoutNo, status: payout.status },
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await this.repository.updateStatus(manager, payout.id, 'CONFIRMED');
      const existingVoucher = await this.transactionRepo.findByPayoutId(payout.id);
      if (existingVoucher === null) {
        const voucherNo = await this.businessCode.nextFinanceVoucherNo(manager);
        await this.transactionRepo.insert(manager, {
          voucherNo,
          direction: 'INCOME',
          category: 'SALE_INCOME',
          amount: payout.amount,
          currency: payout.currency,
          occurredAt: new Date(),
          storeId: payout.storeId,
          supplierId: null,
          orderId: null,
          purchaseOrderId: null,
          payoutId: payout.id,
          reversedByVoucherNo: null,
          remark: `平台回款 ${payout.payoutNo}（${payout.periodStart.toISOString().slice(0, 10)} ~ ${payout.periodEnd.toISOString().slice(0, 10)}）`,
          createdBy: operator.userId,
        });
      }
    });
    const fresh = (await this.repository.findById(payout.id)) as FinancePayoutEntity;

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: payout.id,
      entityCode: payout.payoutNo,
      action: 'CONFIRM',
      changes: { status: { from: payout.status, to: 'CONFIRMED' } },
      operator,
    });
    return fresh;
  }

  async cancel(id: string, operator: OperatorContext): Promise<FinancePayoutEntity> {
    const payout = await this.getPayoutOrThrow(id);
    if (payout.status !== 'DRAFT') {
      throw new FinancePayoutInvalidStateError(
        `回款单 ${payout.payoutNo} 已确认，不能取消；错账请在收支流水中冲正（finance.md §3.4）`,
        { payoutNo: payout.payoutNo, status: payout.status },
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await this.repository.updateStatus(manager, payout.id, 'CANCELLED');
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: payout.id,
      entityCode: payout.payoutNo,
      action: 'CANCEL',
      changes: { status: { from: payout.status, to: 'CANCELLED' } },
      operator,
    });
    return (await this.repository.findById(payout.id)) as FinancePayoutEntity;
  }

  async list(
    filters: FinancePayoutFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: Array<Record<string, unknown>>; meta: PageMeta }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    const items = rows.map((row) => ({ ...row.payout, storeName: row.storeName }));
    return { items, meta: { page: page.page, pageSize: page.pageSize, total } };
  }

  async getDetail(id: string): Promise<FinancePayoutEntity> {
    return this.getPayoutOrThrow(id);
  }

  /**
   * Reconciliation preview (finance.md §4.2): settled revenue of the store
   * over the payout period vs. the payout amount. Informational only - the
   * human decides, nothing is auto-blocked.
   */
  async preview(id: string): Promise<{
    payout: FinancePayoutEntity;
    settledRevenue: string;
    settledOrderCount: number;
    difference: string;
  }> {
    const payout = await this.getPayoutOrThrow(id);
    const settled = await this.settlementRepo.sumRevenueForStore(
      payout.storeId,
      payout.periodStart,
      payout.periodEnd,
    );
    const difference = formatAmount(
      parseAmount(payout.amount) - (parseAmount(settled.revenue) || 0n),
    );
    return {
      payout,
      settledRevenue: settled.revenue,
      settledOrderCount: settled.orderCount,
      difference,
    };
  }

  private async getPayoutOrThrow(id: string): Promise<FinancePayoutEntity> {
    const payout = await this.repository.findById(id);
    if (payout === null) {
      throw new FinancePayoutNotFoundError(id);
    }
    return payout;
  }
}
