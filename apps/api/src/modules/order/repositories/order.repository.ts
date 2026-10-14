import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { ErpOrderStatus, OrderGoodsStateFilter, OrderStageFilter } from '../enums/order.constants';
import { rawStr } from '../../../common/utils/raw';

export interface OrderListFilters {
  keyword?: string;
  /** 平台代码精确过滤（p.code，用户反馈 2026-09-28：平台筛选必须真正过滤列表）。 */
  platform?: string;
  erpStatus?: string;
  /** Axis-1 logistics stage filter (dual-axis §2.1). */
  stage?: OrderStageFilter;
  /** Axis-2 line-level goods-state filter (dual-axis §2.2). */
  goodsState?: OrderGoodsStateFilter;
  /** 平台侧履约方式精确匹配（用户指示 2026-09-17：订单行履约方式列+筛选）。 */
  fulfillmentMode?: string;
  storeId?: string;
  /** Hard restriction to these order ids (待采购 filter pipeline, T3). */
  orderIds?: string[];
}

export interface OrderListRow {
  order: OrderEntity;
  storeName: string;
  platformCode: string;
  itemsCount: number;
  reservedCount: number;
  backorderedCount: number;
  pickedCount: number;
  mappingFailedCount: number;
  openExceptionsCount: number;
}

/** Data access for order headers (queries + inserts + status patches only). */
@Injectable()
export class OrderRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Business number from the dedicated PG sequence: ORD00000001... */
  async nextOrderNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('order_no_seq') AS no`,
    );
    return `ORD${result[0]!.no.padStart(8, '0')}`;
  }

  async findByStoreAndPlatformOrder(
    storeId: string,
    platformOrderId: string,
  ): Promise<OrderEntity | null> {
    return this.dataSource.getRepository(OrderEntity).findOneBy({ storeId, platformOrderId });
  }

  async findById(id: string): Promise<OrderEntity | null> {
    return this.dataSource.getRepository(OrderEntity).findOneBy({ id });
  }

  /**
   * Orders owning a MAPPED BACKORDERED line that no live purchase order
   * covers (待采购 view, purchase.md §3.5). `coveredOrderItemIds` comes from
   * the purchase module's port; this repo owns the order-line facts.
   */
  async findOrderIdsWithUncoveredBackorderedLines(
    coveredOrderItemIds: readonly string[],
  ): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ order_id: string }>>(
      `SELECT DISTINCT i.order_id
       FROM order_items i
       WHERE i.fulfillment_status = 'BACKORDERED'
         AND i.mapping_status = 'MAPPED'
         AND i.sku_id IS NOT NULL
         ${coveredOrderItemIds.length > 0 ? 'AND i.id != ALL($1::uuid[])' : ''}`,
      coveredOrderItemIds.length > 0 ? [[...coveredOrderItemIds]] : [],
    );
    return rows.map((row) => row.order_id);
  }

  /**
   * Creates the order + its PENDING items on the caller's transaction.
   * PG 23505 on uq_orders_store_platform must be handled by the caller
   * (concurrent duplicate ingest replays the winner, task §84).
   */
  async insertWithItems(
    manager: EntityManager,
    header: {
      orderNo: string;
      storeId: string;
      platformOrderId: string;
      platformStatus: string | null;
      platformStage: string | null;
      platformStageChangedAt: Date | null;
      erpStatus: ErpOrderStatus;
      fulfillmentMode: string | null;
      currency: string | null;
      orderedAt: Date;
      shipmentDeadline: Date | null;
      platformTrackingNo: string | null;
      rawData: Record<string, unknown> | null;
      remark: string | null;
      syncSource: string | null;
    },
    items: Array<{
      lineNo: number;
      platformProductId: string | null;
      platformSkuId: string | null;
      sellerSku: string | null;
      offerId: string | null;
      quantity: string;
      unitPrice: string | null;
      totalPrice: string | null;
      rawData: Record<string, unknown> | null;
    }>,
  ): Promise<OrderEntity> {
    const repository = manager.getRepository(OrderEntity);
    const created = await repository.save(repository.create({ ...header }));
    const itemRepository = manager.getRepository(OrderItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          orderId: created.id,
          lineNo: item.lineNo,
          platformProductId: item.platformProductId,
          platformSkuId: item.platformSkuId,
          sellerSku: item.sellerSku,
          offerId: item.offerId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          fulfillmentStatus: 'PENDING',
          mappingStatus: 'PENDING',
          rawData: item.rawData,
        })) as never,
      );
    }
    return created;
  }

  async updateErpStatus(
    manager: EntityManager,
    id: string,
    erpStatus: ErpOrderStatus,
  ): Promise<void> {
    await manager.getRepository(OrderEntity).update({ id }, { erpStatus, updatedAt: new Date() });
  }

  /**
   * Platform FACT patch (Sprint 9 T1 + dual-axis T1): platform_status /
   * shipment_deadline / raw_data / platform_stage fields only - never
   * erp_status (AGENTS.md §38). Callers keep the stored value for fields the
   * platform did not deliver (null input), so a NULL historical
   * platform_status is never wiped by an empty fact set. The stage columns
   * are only rewritten on an actual stage transition; stageChangedAt = null
   * falls back to the observation time (docs §2.4 anchor rule).
   */
  async updatePlatformFacts(
    manager: EntityManager,
    id: string,
    patch: {
      platformStatus: string | null;
      shipmentDeadline: Date | null;
      rawData: Record<string, unknown> | null;
      platformStage?: string | null;
      platformStageChangedAt?: Date | null;
      fulfillmentMode?: string | null;
      /**
       * Platform waybill number (2026-09-18). Null/undefined keeps the stored
       * value so a fact set that omits it never wipes a known number.
       */
      platformTrackingNo?: string | null;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = {
      platformStatus: patch.platformStatus,
      shipmentDeadline: patch.shipmentDeadline,
      rawData: patch.rawData,
      updatedAt: new Date(),
    };
    if (patch.fulfillmentMode !== undefined && patch.fulfillmentMode !== null) {
      update.fulfillmentMode = patch.fulfillmentMode;
    }
    if (patch.platformTrackingNo !== undefined && patch.platformTrackingNo !== null) {
      update.platformTrackingNo = patch.platformTrackingNo;
    }
    if (patch.platformStage !== undefined) {
      update.platformStage = patch.platformStage;
      update.platformStageChangedAt = patch.platformStageChangedAt ?? new Date();
    }
    await manager.getRepository(OrderEntity).update({ id }, update);
  }

  /**
   * Fallback re-read rotation cursor (dual-axis T2): stamped after every
   * confirmed re-read, whether or not any fact changed. Written in its own
   * tiny UPDATE so an unchanged order still advances its rotation slot
   * without touching updatedAt churn beyond this column.
   */
  async markPlatformFactsChecked(manager: EntityManager, id: string): Promise<void> {
    await manager.getRepository(OrderEntity).update({ id }, { platformFactsCheckedAt: new Date() });
  }

  /**
   * Fallback re-read rotation candidates (dual-axis T2, replacing the Sprint 9
   * "every non-ERP-terminal order" sweep):
   *
   * - selection is by PLATFORM stage - NULL or AWAITING_SHIPMENT/IN_TRANSIT.
   *   ERP terminal states no longer exclude anyone: an erp_status='SHIPPED'
   *   order stays a candidate until the platform itself reports DELIVERED or
   *   CANCELLED (fix A3 - delivered facts were previously unlearnable);
   *   platform-terminal orders leave the rotation on their own.
   * - divergent DELIVERED orders stay candidates too (用户指示 2026-10-14):
   *   platform_stage='DELIVERED' while erp_status is not SHIPPED/CANCELLED
   *   means the goods left while WCIES still holds a pre-shipment state
   *   (缺货行 / 缺货异常). Re-reading converges them through
   *   OrderPlatformShippedService; once SHIPPED they leave the rotation.
   *   Without this, an order first synced as delivered would never be
   *   re-observed (no webhook left to fire) and stay blocked forever.
   * - a candidate must be due: its last CONFIRMED facts check
   *   (platform_facts_checked_at) is NULL or older than the fallback window.
   * - ordering checked-at ASC NULLS FIRST rotates fairly - unchanged orders
   *   stop monopolizing the budget because their checked-at advances every
   *   pass, while stalled orders keep being observed until platform terminal
   *   (that is how their exceptions can auto-resolve without webhooks).
   */
  async listPlatformRefreshCandidates(
    storeId: string,
    options: { limit: number; fallbackHours: number },
  ): Promise<Array<{ id: string; platformOrderId: string }>> {
    const entities = await this.dataSource
      .getRepository(OrderEntity)
      .createQueryBuilder('o')
      .select(['o.id', 'o.platformOrderId'])
      .where('o.store_id = :storeId', { storeId })
      .andWhere(
        `(o.platform_stage IS NULL
          OR o.platform_stage IN ('AWAITING_SHIPMENT', 'IN_TRANSIT')
          OR (o.platform_stage = 'DELIVERED' AND o.erp_status NOT IN ('SHIPPED', 'CANCELLED')))`,
      )
      .andWhere(
        `(o.platform_facts_checked_at IS NULL OR o.platform_facts_checked_at < now() - (:fallbackHours || ' hours')::interval)`,
        { fallbackHours: String(options.fallbackHours) },
      )
      .orderBy('o.platform_facts_checked_at', 'ASC', 'NULLS FIRST')
      .take(options.limit)
      .getMany();
    return entities.map((order) => ({ id: order.id, platformOrderId: order.platformOrderId }));
  }

  /** Paged list with aggregated row counts + open exceptions (no N+1, task §61/§90). */
  async listWithAggregates(
    filters: OrderListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const qb = this.dataSource
      .getRepository(OrderEntity)
      .createQueryBuilder('o')
      .innerJoin('stores', 's', 's.id = o.store_id')
      .innerJoin('platforms', 'p', 'p.id = s.platform_id')
      .addSelect('s.name', 'store_name')
      .addSelect('p.code', 'platform_code')
      .addSelect(`(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id)`, 'items_count')
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'RESERVED')`,
        'reserved_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'BACKORDERED')`,
        'backordered_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'PICKED')`,
        'picked_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')`,
        'mapping_failed_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM system_exceptions e
            WHERE e.status = 'OPEN'
              AND e.reference_type = 'ORDER_ITEM'
              AND e.reference_id IN (SELECT i.id FROM order_items i WHERE i.order_id = o.id))`,
        'open_exceptions_count',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      // 单框混搜（用户指示 2026-09-28：订单号/平台单号与商品标识合并）：
      // 订单号 / 平台订单号 / 内部 SKU 编码 / offer_id / seller_sku /
      // platform_sku_id 任一命中即入选（EXISTS 仿 goodsStatePredicate）。
      qb.andWhere(
        `(o.order_no ILIKE :kw OR o.platform_order_id ILIKE :kw OR EXISTS (
           SELECT 1 FROM order_items i
           LEFT JOIN skus sk ON sk.id = i.sku_id
           WHERE i.order_id = o.id
             AND (i.offer_id ILIKE :kw
                  OR i.seller_sku ILIKE :kw
                  OR i.platform_sku_id ILIKE :kw
                  OR sk.sku_code ILIKE :kw)
         ))`,
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.platform !== undefined && filters.platform !== '') {
      qb.andWhere('p.code = :platform', { platform: filters.platform });
    }
    if (filters.erpStatus !== undefined) {
      qb.andWhere('o.erp_status = :erpStatus', { erpStatus: filters.erpStatus });
    }
    if (filters.stage !== undefined) {
      qb.andWhere(stagePredicate(filters.stage));
    }
    if (filters.goodsState !== undefined) {
      qb.andWhere(goodsStatePredicate(filters.goodsState));
    }
    if (filters.fulfillmentMode !== undefined) {
      qb.andWhere('o.fulfillment_mode = :fulfillmentMode', {
        fulfillmentMode: filters.fulfillmentMode,
      });
    }
    if (filters.storeId !== undefined) {
      qb.andWhere('o.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.orderIds !== undefined) {
      if (filters.orderIds.length === 0) {
        return { rows: [], total: 0 };
      }
      qb.andWhere('o.id IN (:...orderIds)', { orderIds: filters.orderIds });
    }
    qb.orderBy('o.orderedAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((order, index) => ({
        order,
        storeName: rawStr(rawList[index]?.['store_name']),
        platformCode: rawStr(rawList[index]?.['platform_code']),
        itemsCount: Number(rawList[index]?.['items_count'] ?? 0),
        reservedCount: Number(rawList[index]?.['reserved_count'] ?? 0),
        backorderedCount: Number(rawList[index]?.['backordered_count'] ?? 0),
        pickedCount: Number(rawList[index]?.['picked_count'] ?? 0),
        mappingFailedCount: Number(rawList[index]?.['mapping_failed_count'] ?? 0),
        openExceptionsCount: Number(rawList[index]?.['open_exceptions_count'] ?? 0),
      })),
      total,
    };
  }

  /** BACKORDERED line ids of the given orders (dual-axis §2.3 procurement
   *  counters: the service derives ORDERED/ARRIVED per line through the
   *  purchase port and rolls the counts up per order). */
  async findBackorderedItemIdsByOrderIds(
    orderIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (orderIds.length === 0) {
      return result;
    }
    const rows = await this.dataSource.query<Array<{ order_id: string; id: string }>>(
      `SELECT i.order_id, i.id
       FROM order_items i
       WHERE i.fulfillment_status = 'BACKORDERED'
         AND i.order_id = ANY($1::uuid[])`,
      [[...orderIds]],
    );
    for (const row of rows) {
      const list = result.get(row.order_id) ?? [];
      list.push(row.id);
      result.set(row.order_id, list);
    }
    return result;
  }
}

/**
 * Axis-1 predicates (dual-axis §2.1). PENDING keeps divergent orders (platform
 * delivered, ERP not shipped) visible for human follow-up (mark external
 * fulfillment / cancel); IN_TRANSIT treats a NULL platform stage as
 * "not delivered yet" - the order simply has not been re-read since its
 * platform side moved on.
 */
function stagePredicate(stage: OrderStageFilter): string {
  switch (stage) {
    case 'PENDING':
      return `o.erp_status NOT IN ('SHIPPED', 'CANCELLED')`;
    case 'IN_TRANSIT':
      return `o.erp_status = 'SHIPPED' AND (o.platform_stage IS NULL OR o.platform_stage <> 'DELIVERED')`;
    case 'COMPLETED':
      return `o.erp_status = 'SHIPPED' AND o.platform_stage = 'DELIVERED'`;
  }
}

/**
 * Axis-2 predicates (dual-axis §2.2). Line-level chips use EXISTS over
 * order_items so orders whose rollup status hides a line problem stay
 * findable. PICKING keys on the rollup because it is DERIVED from open
 * picking tasks (order-status.service), not from line fulfillment states.
 * ABNORMAL is the union chip: BACKORDERED ∪ MAPPING_FAILED ∪ SHIPMENT_OVERDUE
 * ∪ an OPEN ORDER_TRACKING_STALLED exception on the order (T4; the type is a
 * data value here - the exception module owns the enum).
 *
 * BACKORDERED（缺货）修复（人工测试 2026-09-17）：订单 rollup 把「已映射但
 * 未持有库存」的行（含历史 PENDING 卡行）都算作缺货，行级筛选必须与 rollup
 * 同口径——MAPPED 且 fulfillment_status IN (BACKORDERED, PENDING)，否则
 * 订单头显示缺货而缺货筛选查不到任何单。
 */
function goodsStatePredicate(state: OrderGoodsStateFilter): string {
  switch (state) {
    case 'TO_PICK':
      return `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'RESERVED')`;
    case 'PICKING':
      return `o.erp_status = 'PICKING'`;
    case 'TO_SHIP':
      return `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'PICKED')`;
    case 'BACKORDERED':
      return backorderedPredicate();
    case 'MAPPING_FAILED':
      return `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')`;
    case 'SHIPMENT_OVERDUE':
      return `o.shipment_deadline IS NOT NULL AND o.shipment_deadline < now() AND o.erp_status NOT IN ('SHIPPED', 'CANCELLED')`;
    case 'ABNORMAL':
      return `(${backorderedPredicate()}
        OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')
        OR (o.shipment_deadline IS NOT NULL AND o.shipment_deadline < now() AND o.erp_status NOT IN ('SHIPPED', 'CANCELLED'))
        OR EXISTS (SELECT 1 FROM system_exceptions e
              WHERE e.status = 'OPEN' AND e.exception_type = 'ORDER_TRACKING_STALLED'
                AND e.reference_type = 'ORDER' AND e.reference_id = o.id)
      )`;
  }
}

/** 与 rollup 同口径的缺货行判定（见 goodsStatePredicate 注释）。 */
function backorderedPredicate(): string {
  return `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id
      AND i.mapping_status = 'MAPPED'
      AND i.fulfillment_status IN ('BACKORDERED', 'PENDING'))`;
}
