import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import {
  ErpOrderStatus,
  OrderGoodsStateFilter,
  OrderListSortField,
  OrderStageFilter,
} from '../enums/order.constants';
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
  /** 排序字段（白名单，2026-10-14）；缺省 = 下单时间。 */
  sortBy?: OrderListSortField;
  sortOrder?: 'asc' | 'desc';
}

export interface OrderListRow {
  order: OrderEntity;
  storeName: string;
  storeCurrency: string | null;
  platformCode: string;
  itemsCount: number;
  reservedCount: number;
  backorderedCount: number;
  pickedCount: number;
  mappingFailedCount: number;
  openExceptionsCount: number;
  /** 该单 SKU 编码的字典序最小值（SKU 列展示 + SKU 排序键）；全行未映射为 null。 */
  firstSkuCode: string | null;
  /** 该单不同 SKU 编码的种类数。 */
  skuKindCount: number;
}

/** 该单的排序/展示键：所有行 SKU 编码的字典序最小值（未映射行无编码）。 */
const MIN_SKU_CODE_SQL =
  '(SELECT MIN(sk.sku_code) FROM order_items i LEFT JOIN skus sk ON sk.id = i.sku_id WHERE i.order_id = o.id)';

/**
 * SKU 排序键的 SELECT 别名（listWithAggregates 用 `addSelect(MIN_SKU_CODE_SQL,
 * SKU_CODE_SORT_ALIAS)`）。
 *
 * ORDER BY 必须用这个**别名**而不是 MIN_SKU_CODE_SQL 本身：分页走
 * skip/take + joins 时 TypeORM 会用两条查询（先取 id 再取实体），并对每个
 * ORDER BY 表达式按 `alias.property` 解析——子查询里含点（`sk.sku_code`）
 * 会被当成别名而抛 `"(SELECT MIN(sk" alias was not found`（2026-10-17 用户
 * 报告：点 SKU 排序列表 500 / 空列表）。改用 SELECT 别名既避开设解析，又
 * 复用同一个子查询（显示列与排序键永不矛盾）。
 */
const SKU_CODE_SORT_ALIAS = 'first_sku_code';

/**
 * 排序白名单映射（纯函数，可单测）。未列出的 sortBy 回落默认（下单时间
 * 新→旧）；表达式全部来自本文件常量，永不拼接用户输入（防注入）。
 * NULL 统一压最后（发货时限为空 / 全行未映射的订单不打断浏览）。
 *
 * 加急恒定置顶（用户指示 2026-10-16，ADR 0022）：无论用户选哪种排序，
 * 首级键都是 is_urgent DESC——加急订单永远排在非加急之前，组内再按用户
 * 所选键排。这是「优先展示」的语义，不是可选项。
 */
export function orderSortOf(
  sortBy: OrderListSortField | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
): Array<{ expression: string; direction: 'ASC' | 'DESC'; nulls?: 'NULLS LAST' }> {
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
  // 加急置顶（恒定首级键）。PG 布尔 DESC：true 在前。
  const urgentKey = { expression: 'o.isUrgent', direction: 'DESC' as const };
  switch (sortBy) {
    case 'skuCode':
      // SKU 编码 A→Z / Z→A；同键按下单时间新→旧保持分页稳定。
      return [
        urgentKey,
        { expression: SKU_CODE_SORT_ALIAS, direction, nulls: 'NULLS LAST' },
        { expression: 'o.orderedAt', direction: 'DESC' },
      ];
    case 'shipmentDeadline':
      // 发货时限：升序 = 最紧急/最超时在前（近→远）；无时限的固定最后。
      return [
        urgentKey,
        { expression: 'o.shipmentDeadline', direction, nulls: 'NULLS LAST' },
        { expression: 'o.orderedAt', direction: 'DESC' },
      ];
    default:
      // 下单时间（默认）；id 作最终次序键，避免同刻订单翻页抖动。
      return [
        urgentKey,
        { expression: 'o.orderedAt', direction },
        { expression: 'o.id', direction: 'ASC' },
      ];
  }
}

/**
 * 列表排序的**纯 SQL** 形式（2026-10-19 批量打印面单按列表顺序装订）。
 *
 * 与 `orderSortOf` 同一口径，但用于无分页 / 无 TypeORM 别名解析的原始查询：
 * `orderSortOf` 的 SKU 键用的是 SELECT 别名（只在 listWithAggregates 里存在），
 * 这里必须用子查询原文并写成 snake_case 列名。
 */
export function orderBySqlOf(
  sortBy: OrderListSortField | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
): string {
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const urgent = 'o.is_urgent DESC';
  switch (sortBy) {
    case 'skuCode':
      return `${urgent}, ${MIN_SKU_CODE_SQL} ${direction} NULLS LAST, o.ordered_at DESC, o.id ASC`;
    case 'shipmentDeadline':
      return `${urgent}, o.shipment_deadline ${direction} NULLS LAST, o.ordered_at DESC, o.id ASC`;
    default:
      return `${urgent}, o.ordered_at ${direction}, o.id ASC`;
  }
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
   * 这批订单在**订单列表当前排序**下的顺序（2026-10-19 批量打印面单：
   * PDF 装订顺序必须与列表一致）。只返回存在的订单；查不到的 id 由调用方
   * 自行补上，以便逐笔报错。
   */
  async findIdsInListOrder(
    ids: readonly string[],
    sortBy: OrderListSortField | undefined,
    sortOrder: 'asc' | 'desc' | undefined,
  ): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT o.id FROM orders o
        WHERE o.id = ANY($1::uuid[])
        ORDER BY ${orderBySqlOf(sortBy, sortOrder)}`,
      [[...ids]],
    );
    return rows.map((row) => row.id);
  }

  /** Orders owning a MAPPED 缺货 line whose id is in the given set（已采购筛选）. */
  async findOrderIdsWithBackorderedLinesIn(orderItemIds: readonly string[]): Promise<string[]> {
    if (orderItemIds.length === 0) {
      return [];
    }
    const rows = await this.dataSource.query<Array<{ order_id: string }>>(
      `SELECT DISTINCT i.order_id
         FROM order_items i
        WHERE i.id = ANY($1::uuid[])
          AND i.mapping_status = 'MAPPED'
          AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')`,
      [[...orderItemIds]],
    );
    return rows.map((row) => row.order_id);
  }

  /**
   * 标记面单已打印（用户指示 2026-10-19）：只对**尚未打印**的订单置位
   * （幂等；重复打印不刷新时间、不重复审计）。返回新置位的订单。
   *
   * 裸 SQL + RETURNING 在 TypeORM 下返回 [rows, rowCount] 二元组，这里显式
   * 拆包（与迁移脚本同一处理）。
   */
  async markLabelPrinted(
    ids: readonly string[],
    printedAt: Date,
  ): Promise<Array<{ id: string; orderNo: string }>> {
    if (ids.length === 0) {
      return [];
    }
    const result: unknown = await this.dataSource.query(
      `UPDATE orders
          SET label_printed_at = $2, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND label_printed_at IS NULL
        RETURNING id, order_no`,
      [[...ids], printedAt],
    );
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<{
      id: string;
      order_no: string;
    }>;
    return rows.map((row) => ({ id: String(row.id), orderNo: String(row.order_no) }));
  }

  /**
   * 只写运单号（2026-10-22）：WB 的运单号（`parcelId`）只出现在面单响应里，
   * 没有可回读的平台接口，因此由取单链路直接落库。`IS NULL` 保证已有值不被
   * 覆盖，也保证重复取单是 no-op（与 applySyncedPlatformFacts 的 null-keeps
   * 语义一致）。
   */
  async setPlatformTrackingNoIfMissing(id: string, trackingNumber: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE orders
          SET platform_tracking_no = $2, updated_at = now()
        WHERE id = $1::uuid AND platform_tracking_no IS NULL
        RETURNING id`,
      [id, trackingNumber],
    );
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as
      Array<{ id: string }> | undefined;
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * 加急标记写入（用户指示 2026-10-16，ADR 0022）。只改 is_urgent /
   * urgent_marked_at，从不碰 erp_status（AGENTS.md §38）。取消加急时
   * 传入原有的 urgentMarkedAt 保留最后标记时间。
   */
  async setUrgent(orderId: string, isUrgent: boolean, urgentMarkedAt: Date | null): Promise<void> {
    await this.dataSource
      .getRepository(OrderEntity)
      .update({ id: orderId }, { isUrgent, urgentMarkedAt, updatedAt: new Date() });
  }

  /**
   * 按 raw_data 字段批量反查订单（2026-10-23 WB 双源去重用）。
   *
   * `field` 由适配器给出（当前只有 `rid`），这里做白名单校验防止拼接注入；
   * 返回值是「字段值 → 订单 id」。
   */
  /**
   * 按「平台标识」批量反查已有订单（2026-10-24）：`platform_order_id` 与
   * `raw_data->>'rid'` 任一命中即同一张单。用于跨数据源去重——WB 的统计行
   * `srid` 等于装配任务的 `rid`，而两者的 platform_order_id 不同。
   */
  async findIdsByPlatformIdentifiers(
    storeId: string,
    identifiers: readonly string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (identifiers.length === 0) {
      return result;
    }
    const rows = await this.dataSource.query<
      Array<{ id: string; platform_order_id: string; rid: string | null }>
    >(
      `SELECT id, platform_order_id, raw_data->>'rid' AS rid
         FROM orders
        WHERE store_id = $1::uuid
          AND (platform_order_id = ANY($2::text[]) OR raw_data->>'rid' = ANY($2::text[]))`,
      [storeId, [...identifiers]],
    );
    for (const row of rows) {
      // platform_order_id 优先：以它为「真实身份」，rid 只是别名。
      if (!result.has(row.platform_order_id)) {
        result.set(row.platform_order_id, row.id);
      }
      if (row.rid !== null && !result.has(row.rid)) {
        result.set(row.rid, row.id);
      }
    }
    return result;
  }

  async findIdsByRawField(
    storeId: string,
    field: string,
    values: readonly string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (values.length === 0 || !/^[a-zA-Z0-9_]+$/.test(field)) {
      return result;
    }
    const rows = await this.dataSource.query<Array<{ key: string; id: string }>>(
      `SELECT raw_data->>$3 AS key, id
         FROM orders
        WHERE store_id = $1::uuid AND raw_data->>$3 = ANY($2::text[])`,
      [storeId, [...values], field],
    );
    for (const row of rows) {
      if (row.key !== null && !result.has(row.key)) {
        result.set(row.key, row.id);
      }
    }
    return result;
  }

  /** 外部履约标记写入/清除（2026-10-23）：只动这两个字段，不碰 erp_status。 */
  async setExternalFulfillmentMark(
    orderId: string,
    markedAt: Date | null,
    reason: string | null,
  ): Promise<void> {
    await this.dataSource
      .getRepository(OrderEntity)
      .update(
        { id: orderId },
        { externalFulfilledAt: markedAt, externalFulfillmentReason: reason, updatedAt: new Date() },
      );
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
      /** 省略 = 保持原值（报表型数据源不得覆盖作业单的原始数据）。 */
      rawData?: Record<string, unknown> | null;
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
      ...(patch.rawData === undefined ? {} : { rawData: patch.rawData }),
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

  /**
   * 已释放行仍挂着 OPEN 行级异常的订单（2026-10-20 修复的自愈候选）：
   * RELEASED / EXTERNAL_FULFILLED 的行不再需要内部履约，映射/缺货异常
   * 已无待办可执行，必须关闭；若订单 ERP 状态仍是被旧规则翻回的
   * EXCEPTION，调用方随后重算 rollup 恢复真实持有态（多为 SHIPPED）。
   * 最旧优先、有界；异常关闭后该订单自然离开候选集。
   */
  async findOrdersWithReleasedLineExceptions(
    storeId: string,
    limit: number,
  ): Promise<Array<{ id: string; erpStatus: string }>> {
    const rows = await this.dataSource.query<Array<{ id: string; erp_status: string }>>(
      `SELECT o.id, o.erp_status
         FROM orders o
        WHERE o.store_id = $1::uuid
          AND EXISTS (
                SELECT 1
                  FROM order_items i
                  JOIN system_exceptions e
                    ON e.reference_type = 'ORDER_ITEM'
                   AND e.reference_id = i.id
                   AND e.status = 'OPEN'
                   AND e.exception_type IN ('ORDER_SKU_MAPPING_FAILED', 'ORDER_OUT_OF_STOCK')
                 WHERE i.order_id = o.id
                   AND i.fulfillment_status IN ('RELEASED', 'EXTERNAL_FULFILLED')
              )
        ORDER BY o.updated_at ASC
        LIMIT $2`,
      [storeId, limit],
    );
    return rows.map((row) => ({ id: String(row.id), erpStatus: String(row.erp_status) }));
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
      .addSelect('s.default_currency', 'store_currency')
      .addSelect('p.code', 'platform_code')
      .addSelect(`(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id)`, 'items_count')
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'RESERVED')`,
        'reserved_count',
      )
      // 缺货行计数与缺货筛选/rollup 同口径（orders.md §5「缺货口径」）：
      // MAPPED 且 fulfillment_status IN ('BACKORDERED','PENDING')。只数
      // BACKORDERED 会让 MAPPED+PENDING 的卡行在商品列徽标/右栏风险段/
      // 行内「重新尝试分配」处整条链路隐身——而订单头 ERP 状态已显示缺货。
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id
            AND i.mapping_status = 'MAPPED'
            AND i.fulfillment_status IN ('BACKORDERED', 'PENDING'))`,
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
      )
      // SKU 列展示 + SKU 排序键（2026-10-14）：排序与显示用同一个子查询，
      // 两列永不可能矛盾。排序走这个别名（见 SKU_CODE_SORT_ALIAS 注释）。
      .addSelect(MIN_SKU_CODE_SQL, SKU_CODE_SORT_ALIAS)
      .addSelect(
        `(SELECT COUNT(DISTINCT sk.sku_code) FROM order_items i
            LEFT JOIN skus sk ON sk.id = i.sku_id WHERE i.order_id = o.id)`,
        'sku_kind_count',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      // 单框混搜（用户指示 2026-09-28：订单号/平台单号与商品标识合并）：
      // 订单号 / 平台订单号 / 内部 SKU 编码或名称 / offer_id / seller_sku /
      // platform_sku_id 任一命中即入选（EXISTS 仿 goodsStatePredicate）。
      // SKU 名称（中/俄）2026-10-23 补上：运营常只记得名称，搜编码记不住。
      qb.andWhere(
        `(o.order_no ILIKE :kw OR o.platform_order_id ILIKE :kw OR EXISTS (
           SELECT 1 FROM order_items i
           LEFT JOIN skus sk ON sk.id = i.sku_id
           WHERE i.order_id = o.id
             AND (i.offer_id ILIKE :kw
                  OR i.seller_sku ILIKE :kw
                  OR i.platform_sku_id ILIKE :kw
                  OR sk.sku_code ILIKE :kw
                  OR sk.name_zh ILIKE :kw
                  OR sk.name_ru ILIKE :kw)
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
    // 排序白名单（2026-10-14）：默认下单时间新→旧；id 兜底保证分页稳定。
    for (const sort of orderSortOf(filters.sortBy, filters.sortOrder)) {
      qb.addOrderBy(sort.expression, sort.direction, sort.nulls);
    }
    qb.skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((order, index) => {
        const raw: Record<string, unknown> = rawList[index] ?? {};
        const firstSkuValue = raw[SKU_CODE_SORT_ALIAS];
        return {
          order,
          storeName: rawStr(raw['store_name']),
          storeCurrency: rawStr(raw['store_currency']) || null,
          platformCode: rawStr(raw['platform_code']),
          itemsCount: Number(raw['items_count'] ?? 0),
          reservedCount: Number(raw['reserved_count'] ?? 0),
          backorderedCount: Number(raw['backordered_count'] ?? 0),
          pickedCount: Number(raw['picked_count'] ?? 0),
          mappingFailedCount: Number(raw['mapping_failed_count'] ?? 0),
          openExceptionsCount: Number(raw['open_exceptions_count'] ?? 0),
          firstSkuCode:
            firstSkuValue === null || firstSkuValue === undefined ? null : rawStr(firstSkuValue),
          skuKindCount: Number(raw['sku_kind_count'] ?? 0),
        };
      }),
      total,
    };
  }

  /** 缺货行 ids（dual-axis §2.3 采购计数：服务层经采购端口逐行取
   *  ORDERED/ARRIVED 再按订单汇总）。口径与缺货筛选/rollup 一致
   *  （orders.md §5）：MAPPED 且 fulfillment_status IN ('BACKORDERED','PENDING')
   *  ——否则 MAPPED+PENDING 卡行不计入「已采购/已到货」，与订单头缺货状态矛盾。 */
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
       WHERE i.mapping_status = 'MAPPED'
         AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')
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
      // 外部履约单不混入「待处理」（用户指示 2026-10-16）：它们 ERP 无内部
      // 动作，独立归入 EXTERNAL Tab；其余未发货/未取消订单照旧。
      return `(o.erp_status NOT IN ('SHIPPED', 'CANCELLED') AND NOT ${externalFulfillmentPredicate()})`;
    case 'EXTERNAL':
      return externalFulfillmentPredicate();
    case 'IN_TRANSIT':
      return `o.erp_status = 'SHIPPED' AND (o.platform_stage IS NULL OR o.platform_stage <> 'DELIVERED')`;
    case 'COMPLETED':
      return `o.erp_status = 'SHIPPED' AND o.platform_stage = 'DELIVERED'`;
    case 'CANCELLED':
      return `o.erp_status = 'CANCELLED'`;
  }
}

/**
 * 外部履约单判定（用户指示 2026-10-16）：履约模式为平台托管/半托管
 * （FBO/FBP/FBW/FBY，含完整常量与短码），ERP 无可履约行（全部行
 * `EXTERNAL_FULFILLED` / `RELEASED`）且无未映射阻塞，且尚未发货/取消。
 *
 * 结果：这类订单在 ERP 侧没有作业可做（平台仓库持货发货），单列
 * 「外部履约」阶段 Tab，不再占据「待处理」。**未映射阻塞（存在 FAILED 行）
 * 的外部履约单不归此处**——它仍需人工补映射，留在「待处理/异常」。
 *
 * 模式用正则匹配，等价于后端 `isExternalFulfillmentMode` 的 token 判定
 * （`FBO|FBP|FBW|FBY` 作为整段或 `_` 后缀）；`FBS`/`RFBS` 不匹配。
 */
function externalFulfillmentPredicate(): string {
  return `(o.erp_status NOT IN ('SHIPPED', 'CANCELLED')
    AND o.fulfillment_mode ~ '(^|_)(FBO|FBP|FBW|FBY)$'
    AND NOT EXISTS (SELECT 1 FROM order_items i
          WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')
    AND NOT EXISTS (SELECT 1 FROM order_items i
          WHERE i.order_id = o.id
            AND i.fulfillment_status NOT IN ('EXTERNAL_FULFILLED', 'RELEASED')))`;
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
    case 'LABEL_PRINTED':
      // 已打印面单且**未发货**（用户指示 2026-10-19）：已发货/已取消不算。
      return `(o.label_printed_at IS NOT NULL AND o.erp_status NOT IN ('SHIPPED', 'CANCELLED'))`;
    case 'PURCHASED':
      // 由 OrderService 通过采购端口取「采购状态=ORDERED」的行 id，再以
      // orderIds 过滤（跨模块不写 SQL，AGENTS §9）；这里不应被直接调用。
      throw new Error('PURCHASED is resolved in OrderService via the procurement port');
    case 'BACKORDERED':
      return backorderedPredicate();
    case 'MAPPING_FAILED':
      return `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')`;
    case 'SHIPMENT_OVERDUE':
      return shipmentOverduePredicate();
    case 'ABNORMAL':
      return `(${backorderedPredicate()}
        OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')
        OR ${shipmentOverduePredicate()}
        OR EXISTS (SELECT 1 FROM system_exceptions e
              WHERE e.status = 'OPEN' AND e.exception_type = 'ORDER_TRACKING_STALLED'
                AND e.reference_type = 'ORDER' AND e.reference_id = o.id)
      )`;
  }
}

/**
 * 发货超时口径（用户指示 2026-10-14）：平台阶段已 `IN_TRANSIT` /
 * `DELIVERED` 即货物在平台侧已经发走——时限不再构成内部作业压力，
 * **已事实发货的订单不属于发货超时**（含被未映射异常卡在 EXCEPTION 的：
 * 映射要补，但「超时」这个判定与事实矛盾）。`PARTIALLY_SHIPPED` 剩余行
 * 未出且已过时限仍算（erp_status 未达 SHIPPED）。阶段为 NULL（尚未同步
 * 到阶段事实）的订单保持原口径。
 */
function shipmentOverduePredicate(): string {
  return `(o.shipment_deadline IS NOT NULL AND o.shipment_deadline < now()
    AND o.erp_status NOT IN ('SHIPPED', 'CANCELLED')
    AND (o.platform_stage IS NULL OR o.platform_stage NOT IN ('IN_TRANSIT', 'DELIVERED')))`;
}

/** 与 rollup 同口径的缺货行判定（见 goodsStatePredicate 注释）。 */
function backorderedPredicate(): string {
  return `EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id
      AND i.mapping_status = 'MAPPED'
      AND i.fulfillment_status IN ('BACKORDERED', 'PENDING'))`;
}
