import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderSettlementEntity } from '../entities/order-settlement.entity';
import { OrderSettlementItemEntity } from '../entities/order-settlement-item.entity';

export interface OrderSettlementFilters {
  keyword?: string;
  storeId?: string;
  from?: Date;
  to?: Date;
}

export interface OrderSettlementListRow {
  settlement: OrderSettlementEntity;
  orderNo: string;
  platformOrderId: string;
  storeId: string;
  storeName: string | null;
  orderedAt: Date;
}

/** Data access for order settlements (finance.md §5). */
@Injectable()
export class OrderSettlementRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insertWithItems(
    manager: EntityManager,
    settlement: Partial<OrderSettlementEntity>,
    items: Array<Omit<OrderSettlementItemEntity, 'id' | 'settlement' | 'settlementId'>>,
  ): Promise<OrderSettlementEntity> {
    const repository = manager.getRepository(OrderSettlementEntity);
    const created = await repository.save(repository.create(settlement));
    const itemRepository = manager.getRepository(OrderSettlementItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(items.map((item) => ({ ...item, settlementId: created.id })));
    }
    return created;
  }

  async findByOrderId(orderId: string): Promise<OrderSettlementEntity | null> {
    return this.dataSource.getRepository(OrderSettlementEntity).findOneBy({ orderId });
  }

  async findById(id: string): Promise<OrderSettlementEntity | null> {
    return this.dataSource.getRepository(OrderSettlementEntity).findOneBy({ id });
  }

  async listItems(settlementId: string): Promise<OrderSettlementItemEntity[]> {
    return this.dataSource
      .getRepository(OrderSettlementItemEntity)
      .createQueryBuilder('i')
      .where('i.settlement_id = :settlementId', { settlementId })
      .orderBy('i.order_item_id', 'ASC')
      .getMany();
  }

  async updateFees(
    manager: EntityManager,
    id: string,
    patch: { shippingFee: string; otherFee: string; profit: string | null },
  ): Promise<void> {
    await manager
      .getRepository(OrderSettlementEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  async list(
    filters: OrderSettlementFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: OrderSettlementListRow[]; total: number }> {
    const qb = this.dataSource
      .getRepository(OrderSettlementEntity)
      .createQueryBuilder('st')
      .innerJoin('orders', 'o', 'o.id = st.order_id')
      .leftJoin('stores', 's', 's.id = o.store_id')
      .addSelect('o.order_no', 'order_no')
      .addSelect('o.platform_order_id', 'platform_order_id')
      .addSelect('o.store_id', 'store_id')
      .addSelect('o.ordered_at', 'ordered_at')
      .addSelect('s.name', 'store_name');
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere(`(o.order_no ILIKE :kw OR o.platform_order_id ILIKE :kw)`, {
        kw: `%${filters.keyword}%`,
      });
    }
    if (filters.storeId !== undefined && filters.storeId !== '') {
      qb.andWhere('o.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.from !== undefined) {
      qb.andWhere('st.generated_at >= :from', { from: filters.from });
    }
    if (filters.to !== undefined) {
      qb.andWhere('st.generated_at < :to', { to: filters.to });
    }
    qb.orderBy('st.generated_at', 'DESC');
    const [raw, total] = await Promise.all([
      qb.limit(limit).offset(offset).getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawRows = raw.raw as Array<Record<string, unknown>>;
    const rows: OrderSettlementListRow[] = raw.entities.map((settlement, index) => ({
      settlement,
      orderNo: (rawRows[index]?.order_no as string) ?? '',
      platformOrderId: (rawRows[index]?.platform_order_id as string) ?? '',
      storeId: (rawRows[index]?.store_id as string) ?? '',
      storeName: (rawRows[index]?.store_name as string | null) ?? null,
      orderedAt: new Date(rawRows[index]?.ordered_at as string),
    }));
    return { rows, total };
  }

  async listSettledOrderIds(): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(OrderSettlementEntity)
      .createQueryBuilder('st')
      .select('st.order_id', 'order_id')
      .getRawMany<{ order_id: string }>();
    return new Set(rows.map((row) => row.order_id));
  }

  /** Settled revenue for one store within a period (payout reconciliation). */
  async sumRevenueForStore(
    storeId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ revenue: string; orderCount: number }> {
    const result = await this.dataSource.query<
      Array<{ revenue: string | null; order_count: string }>
    >(
      `SELECT COALESCE(SUM(st.revenue_total), 0) AS revenue, COUNT(*) AS order_count
       FROM order_settlements st
       INNER JOIN orders o ON o.id = st.order_id
       WHERE o.store_id = $1::uuid
         AND o.ordered_at >= $2::timestamptz
         AND o.ordered_at < $3::timestamptz`,
      [storeId, periodStart, periodEnd],
    );
    return {
      revenue: result[0]?.revenue ?? '0',
      orderCount: Number(result[0]?.order_count ?? 0),
    };
  }

  /** Profit totals over a period (summary card, finance.md §7). */
  async sumProfitTotals(filters: {
    from?: Date;
    to?: Date;
  }): Promise<{ revenue: string; cost: string; shipping: string; other: string; profit: string }> {
    const result = await this.dataSource.query<
      Array<{
        revenue: string | null;
        cost: string | null;
        shipping: string | null;
        other: string | null;
        profit: string | null;
      }>
    >(
      `SELECT COALESCE(SUM(revenue_total), 0) AS revenue,
              COALESCE(SUM(product_cost_total + shipping_fee + other_fee), 0) AS cost,
              COALESCE(SUM(shipping_fee), 0) AS shipping,
              COALESCE(SUM(other_fee), 0) AS other,
              COALESCE(SUM(profit), 0) AS profit
       FROM order_settlements
       WHERE ($1::timestamptz IS NULL OR generated_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR generated_at < $2::timestamptz)`,
      [filters.from ?? null, filters.to ?? null],
    );
    return {
      revenue: result[0]?.revenue ?? '0',
      cost: result[0]?.cost ?? '0',
      shipping: result[0]?.shipping ?? '0',
      other: result[0]?.other ?? '0',
      profit: result[0]?.profit ?? '0',
    };
  }
}
