import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OrderService } from '../../order/services/order.service';
import { SkuService } from '../../product/services/sku.service';
import {
  amountFromDb,
  formatAmount,
  mulAmountByQty,
  parseAmount,
} from '../../../common/utils/money';
import { OrderSettlementEntity } from '../entities/order-settlement.entity';
import { OrderSettlementItemEntity } from '../entities/order-settlement-item.entity';
import {
  OrderSettlementFeeInvalidError,
  OrderSettlementNotEligibleError,
  OrderSettlementNotFoundError,
} from '../errors/finance.errors';
import { COST_CURRENCY } from '../enums/finance.constants';
import {
  OrderSettlementFilters,
  OrderSettlementRepository,
} from '../repositories/order-settlement.repository';

const ENTITY_TYPE = 'ORDER_SETTLEMENT';
/** finance.md §5.1: only shipped orders carry a settlement. */
const SETTLABLE_STATUSES = ['SHIPPED', 'PARTIALLY_SHIPPED'] as const;

/**
 * Per-order revenue/cost/profit snapshots (finance.md §5). Generation is
 * idempotent per order (UNIQUE(order_id)); costs are frozen at generation
 * time so later moving-average drift never rewrites history.
 */
@Injectable()
export class OrderSettlementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: OrderSettlementRepository,
    private readonly orderService: OrderService,
    private readonly skuService: SkuService,
    private readonly operationLog: OperationLogService,
  ) {}

  /** Generate (or idempotently return) the settlement of one order. */
  async generateForOrder(
    orderId: string,
    operator: OperatorContext,
  ): Promise<OrderSettlementEntity> {
    const existing = await this.repository.findByOrderId(orderId);
    if (existing !== null) {
      return existing;
    }
    const order = await this.orderService.getDetail(orderId);
    if (!SETTLABLE_STATUSES.includes(order.erpStatus as (typeof SETTLABLE_STATUSES)[number])) {
      throw new OrderSettlementNotEligibleError({
        orderId,
        orderNo: order.orderNo,
        erpStatus: order.erpStatus,
      });
    }

    let revenueTotal = 0n;
    let costTotal = 0n;
    let hasMissingPrice = false;
    let hasMissingCost = false;
    const items: Array<Omit<OrderSettlementItemEntity, 'id' | 'settlement' | 'settlementId'>> = [];
    for (const item of order.items) {
      const unitPrice = amountFromDb(item.unitPrice);
      const revenue = unitPrice === null ? 0n : mulAmountByQty(unitPrice, item.quantity);
      if (unitPrice === null) {
        hasMissingPrice = true;
      }
      revenueTotal += revenue;

      const sku = item.skuId === null ? null : await this.skuService.getEntityById(item.skuId);
      const unitCost = sku === null ? null : amountFromDb(sku.movingAverageCost);
      const cost = unitCost === null ? 0n : mulAmountByQty(unitCost, item.quantity);
      if (unitCost === null) {
        hasMissingCost = true;
      }
      costTotal += cost;

      items.push({
        orderItemId: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        revenue: formatAmount(revenue),
        unitCost: unitCost === null ? null : formatAmount(unitCost),
        cost: formatAmount(cost),
      });
    }

    // Profit only when revenue and cost share the currency (finance.md
    // §5.3 rule 3) - cross-currency subtraction is forbidden.
    const profit =
      order.currency === null || order.currency.toUpperCase() === COST_CURRENCY
        ? formatAmount(revenueTotal - costTotal)
        : null;

    const settlement = await this.dataSource.transaction(async (manager) => {
      const created = await this.repository.insertWithItems(
        manager,
        {
          orderId,
          currency: order.currency,
          revenueTotal: formatAmount(revenueTotal),
          productCostTotal: formatAmount(costTotal),
          shippingFee: '0.0000',
          otherFee: '0.0000',
          profit,
          hasMissingPrice,
          hasMissingCost,
          generatedBy: operator.userId,
        },
        items,
      );
      return created;
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: settlement.id,
      entityCode: order.orderNo,
      action: 'CREATE',
      changes: {
        revenueTotal: { from: null, to: settlement.revenueTotal },
        productCostTotal: { from: null, to: settlement.productCostTotal },
        profit: { from: null, to: settlement.profit ?? '—' },
      },
      operator,
    });
    return settlement;
  }

  /** Bulk: settle every shipped order that has no settlement yet. */
  async generateMissing(
    operator: OperatorContext,
  ): Promise<{ generated: number; skipped: number; settlementIds: string[] }> {
    const settled = await this.repository.listSettledOrderIds();
    const candidates: Array<{ id: string }> = [];
    for (const erpStatus of SETTLABLE_STATUSES) {
      let page = 1;
      for (;;) {
        const result = await this.orderService.list({ erpStatus }, { page, pageSize: 100 });
        candidates.push(...result.items.map((item) => ({ id: item.id })));
        if (page * 100 >= result.meta.total) {
          break;
        }
        page += 1;
      }
    }
    const pending = candidates.filter((candidate) => !settled.has(candidate.id));
    const settlementIds: string[] = [];
    let skipped = 0;
    for (const candidate of pending) {
      try {
        const settlement = await this.generateForOrder(candidate.id, operator);
        settlementIds.push(settlement.id);
      } catch {
        // Order left SHIPPED between listing and generation - skip, next
        // bulk run picks it up again (finance.md §5.1 remains authoritative).
        skipped += 1;
      }
    }
    return { generated: settlementIds.length, skipped, settlementIds };
  }

  async updateFees(
    id: string,
    input: { shippingFee?: string; otherFee?: string },
  ): Promise<OrderSettlementEntity> {
    const settlement = await this.getSettlementOrThrow(id);
    const shipping =
      input.shippingFee === undefined
        ? (amountFromDb(settlement.shippingFee) ?? 0n)
        : parseAmount(input.shippingFee);
    const other =
      input.otherFee === undefined
        ? (amountFromDb(settlement.otherFee) ?? 0n)
        : parseAmount(input.otherFee);
    if (shipping < 0n || other < 0n) {
      throw new OrderSettlementFeeInvalidError('费用不能为负数');
    }
    const revenue = amountFromDb(settlement.revenueTotal) ?? 0n;
    const cost = amountFromDb(settlement.productCostTotal) ?? 0n;
    const profit =
      settlement.currency !== null && settlement.currency.toUpperCase() !== COST_CURRENCY
        ? null
        : formatAmount(revenue - cost - shipping - other);

    await this.dataSource.transaction(async (manager) => {
      await this.repository.updateFees(manager, settlement.id, {
        shippingFee: formatAmount(shipping),
        otherFee: formatAmount(other),
        profit,
      });
    });
    return (await this.repository.findById(settlement.id)) as OrderSettlementEntity;
  }

  async list(
    filters: OrderSettlementFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: Array<Record<string, unknown>>; meta: PageMeta }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    const items = rows.map((row) => ({
      ...row.settlement,
      orderNo: row.orderNo,
      platformOrderId: row.platformOrderId,
      storeId: row.storeId,
      storeName: row.storeName,
      orderedAt: row.orderedAt,
    }));
    return { items, meta: { page: page.page, pageSize: page.pageSize, total } };
  }

  async getDetail(
    id: string,
  ): Promise<{ settlement: OrderSettlementEntity; items: OrderSettlementItemEntity[] }> {
    const settlement = await this.getSettlementOrThrow(id);
    const items = await this.repository.listItems(settlement.id);
    return { settlement, items };
  }

  private async getSettlementOrThrow(id: string): Promise<OrderSettlementEntity> {
    const settlement = await this.repository.findById(id);
    if (settlement === null) {
      throw new OrderSettlementNotFoundError(id);
    }
    return settlement;
  }
}
