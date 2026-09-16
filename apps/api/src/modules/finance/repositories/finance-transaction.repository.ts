import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FinanceTransactionEntity } from '../entities/finance-transaction.entity';

/** List filters accepted by the transaction ledger (finance.md §3). */
export interface FinanceTransactionFilters {
  keyword?: string;
  direction?: string;
  category?: string;
  storeId?: string;
  supplierId?: string;
  orderId?: string;
  purchaseOrderId?: string;
  payoutId?: string;
  from?: Date;
  to?: Date;
}

export interface FinanceTransactionListRow {
  transaction: FinanceTransactionEntity;
  storeName: string | null;
  supplierName: string | null;
  orderNo: string | null;
  purchaseOrderNo: string | null;
}

/** Data access for the append-only finance ledger. */
@Injectable()
export class FinanceTransactionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    data: Partial<FinanceTransactionEntity>,
  ): Promise<FinanceTransactionEntity> {
    const repository = manager.getRepository(FinanceTransactionEntity);
    return repository.save(repository.create(data));
  }

  async findById(id: string): Promise<FinanceTransactionEntity | null> {
    return this.dataSource.getRepository(FinanceTransactionEntity).findOneBy({ id });
  }

  async findByVoucherNo(voucherNo: string): Promise<FinanceTransactionEntity | null> {
    return this.dataSource.getRepository(FinanceTransactionEntity).findOneBy({ voucherNo });
  }

  async findByPayoutId(payoutId: string): Promise<FinanceTransactionEntity | null> {
    return this.dataSource.getRepository(FinanceTransactionEntity).findOneBy({ payoutId });
  }

  async list(
    filters: FinanceTransactionFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: FinanceTransactionListRow[]; total: number }> {
    const qb = this.dataSource
      .getRepository(FinanceTransactionEntity)
      .createQueryBuilder('t')
      .leftJoin('stores', 's', 's.id = t.store_id')
      .leftJoin('suppliers', 'sup', 'sup.id = t.supplier_id')
      .leftJoin('orders', 'o', 'o.id = t.order_id')
      .leftJoin('purchase_orders', 'po', 'po.id = t.purchase_order_id')
      .addSelect('s.name', 'store_name')
      .addSelect('sup.name', 'supplier_name')
      .addSelect('o.order_no', 'order_no')
      .addSelect('po.po_no', 'purchase_order_no');
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere(`(t.voucher_no ILIKE :kw OR o.order_no ILIKE :kw OR po.po_no ILIKE :kw)`, {
        kw: `%${filters.keyword}%`,
      });
    }
    if (filters.direction !== undefined && filters.direction !== '') {
      qb.andWhere('t.direction = :direction', { direction: filters.direction });
    }
    if (filters.category !== undefined && filters.category !== '') {
      qb.andWhere('t.category = :category', { category: filters.category });
    }
    if (filters.storeId !== undefined && filters.storeId !== '') {
      qb.andWhere('t.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.supplierId !== undefined && filters.supplierId !== '') {
      qb.andWhere('t.supplier_id = :supplierId', { supplierId: filters.supplierId });
    }
    if (filters.orderId !== undefined && filters.orderId !== '') {
      qb.andWhere('t.order_id = :orderId', { orderId: filters.orderId });
    }
    if (filters.purchaseOrderId !== undefined && filters.purchaseOrderId !== '') {
      qb.andWhere('t.purchase_order_id = :purchaseOrderId', {
        purchaseOrderId: filters.purchaseOrderId,
      });
    }
    if (filters.payoutId !== undefined && filters.payoutId !== '') {
      qb.andWhere('t.payout_id = :payoutId', { payoutId: filters.payoutId });
    }
    if (filters.from !== undefined) {
      qb.andWhere('t.occurred_at >= :from', { from: filters.from });
    }
    if (filters.to !== undefined) {
      qb.andWhere('t.occurred_at < :to', { to: filters.to });
    }

    qb.orderBy('t.occurred_at', 'DESC').addOrderBy('t.voucher_no', 'DESC');
    const [raw, total] = await Promise.all([
      qb.limit(limit).offset(offset).getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawRows = raw.raw as Array<Record<string, unknown>>;
    const rows: FinanceTransactionListRow[] = raw.entities.map((transaction, index) => ({
      transaction,
      storeName: (rawRows[index]?.store_name as string | null) ?? null,
      supplierName: (rawRows[index]?.supplier_name as string | null) ?? null,
      orderNo: (rawRows[index]?.order_no as string | null) ?? null,
      purchaseOrderNo: (rawRows[index]?.purchase_order_no as string | null) ?? null,
    }));
    return { rows, total };
  }

  /**
   * Net income/expense over a period, EXCLUDING reversal pairs (both twins
   * carry reversed_by_voucher_no, finance.md §3.4/§7).
   */
  async sumNetByDirection(filters: {
    from?: Date;
    to?: Date;
  }): Promise<{ income: string; expense: string }> {
    const result = await this.dataSource.query<
      Array<{ income: string | null; expense: string | null }>
    >(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE direction = 'INCOME'), 0) AS income,
         COALESCE(SUM(amount) FILTER (WHERE direction = 'EXPENSE'), 0) AS expense
       FROM finance_transactions
       WHERE reversed_by_voucher_no IS NULL
         AND ($1::timestamptz IS NULL OR occurred_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz)`,
      [filters.from ?? null, filters.to ?? null],
    );
    return {
      income: result[0]?.income ?? '0',
      expense: result[0]?.expense ?? '0',
    };
  }

  /** Paid total per purchase order (PURCHASE_PAYMENT rows). */
  async sumPaidByPurchaseOrderIds(
    purchaseOrderIds: string[],
  ): Promise<Map<string, { paid: string; count: number }>> {
    const map = new Map<string, { paid: string; count: number }>();
    if (purchaseOrderIds.length === 0) {
      return map;
    }
    const result = await this.dataSource.query<Array<{ po_id: string; paid: string; cnt: string }>>(
      `SELECT purchase_order_id AS po_id,
              COALESCE(SUM(amount), 0) AS paid,
              COUNT(*) AS cnt
       FROM finance_transactions
       WHERE category = 'PURCHASE_PAYMENT'
         AND reversed_by_voucher_no IS NULL
         AND purchase_order_id = ANY($1::uuid[])
       GROUP BY purchase_order_id`,
      [purchaseOrderIds],
    );
    for (const row of result) {
      map.set(row.po_id, { paid: row.paid, count: Number(row.cnt) });
    }
    return map;
  }

  /** Total confirmed payouts (for the summary card, finance.md §7). */
  async sumConfirmedPayouts(filters: { from?: Date; to?: Date }): Promise<string> {
    const result = await this.dataSource.query<Array<{ total: string | null }>>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM finance_payouts
       WHERE status = 'CONFIRMED'
         AND ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)`,
      [filters.from ?? null, filters.to ?? null],
    );
    return result[0]?.total ?? '0';
  }
}
