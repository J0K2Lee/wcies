import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** 行级采购覆盖结果（衍生，不落库）。 */
export type ProcurementCoverageState = 'COVERED' | 'SHORT';

export interface OrderItemProcurementCoverage {
  /** null = 行已分配/终态/未映射/店铺无绑定仓，采购覆盖不适用 */
  coverage: ProcurementCoverageState | null;
  /**
   * 该行所属店铺是否存在 ACTIVE 的仓库绑定（2026-10-24）。false = 店铺还没绑定
   * 仓库，分配/采购覆盖都无从计算——这类行必须显示「店铺未绑定仓库」，
   * 不能被算作缺货（用户指示）。
   */
  warehouseBound: boolean;
  /** 该 SKU + 目标仓的缺口（未覆盖行为的 SKU 级数字） */
  gapQty: string | null;
  /** 该 SKU + 目标仓的在途未收数量 */
  inTransitQty: string | null;
  /** 行归属仓（店铺默认绑定仓） */
  warehouseId: string | null;
}

export interface WarehouseProcurementGap {
  demandQty: string;
  inTransitQty: string;
  gapQty: string;
}

interface CoverageRow {
  item_id: string;
  warehouse_id: string;
  quantity: string;
  cum_qty: string;
  outstanding_qty: string;
  gap_qty: string;
  covered: boolean;
}

/**
 * 采购覆盖派生（2026-10-21，用户拍板）：
 *
 *   需求(SKU, 仓) = 该仓服务店铺下，该 SKU 未分配行数量之和
 *   在途(SKU, 仓) = 该 SKU + 该仓未取消采购单的未收数量之和
 *   缺口 = max(0, 需求 − 在途)
 *   覆盖 = 在途按分配优先级逐行覆盖（加急 > 平台 > 时限 > 行创建时间）
 *
 * 全部按 SQL 现算，不落库、不依赖采购单与订单行的历史链接。
 * 行归属仓与订单分配同一规则：店铺 ACTIVE 绑定中 priority 最小、非 FBO 优先。
 */
@Injectable()
export class ProcurementCoverageService {
  constructor(private readonly dataSource: DataSource) {}

  /** 单行（页面）覆盖：一次查询覆盖整页，避免逐行查询。 */
  async getCoverageByOrderItemIds(
    orderItemIds: readonly string[],
  ): Promise<Record<string, OrderItemProcurementCoverage>> {
    if (orderItemIds.length === 0) {
      return {};
    }
    const rows = await this.queryCoverage([...orderItemIds]);
    const result: Record<string, OrderItemProcurementCoverage> = {};
    for (const row of rows) {
      const warehouseBound = row.warehouse_id !== null;
      result[row.item_id] = {
        // 没有绑定仓就没有「该 SKU 在该仓」的需求/在途口径：覆盖结论为空。
        coverage: warehouseBound ? (row.covered ? 'COVERED' : 'SHORT') : null,
        warehouseBound,
        gapQty: warehouseBound ? row.gap_qty : null,
        inTransitQty: warehouseBound ? row.outstanding_qty : null,
        warehouseId: row.warehouse_id,
      };
    }
    return result;
  }

  /**
   * 被在途覆盖的订单行（「已采购」筛选）。
   * 店铺没有绑定仓的行既不覆盖也不缺货，两个筛选都不含它。
   */
  async listCoveredItemIds(): Promise<string[]> {
    const rows = await this.queryCoverage();
    return rows.filter((row) => row.warehouse_id !== null && row.covered).map((row) => row.item_id);
  }

  /** 未被覆盖的缺货行（「缺货 / 待采购」筛选）。 */
  async listShortItemIds(): Promise<string[]> {
    const rows = await this.queryCoverage();
    return rows
      .filter((row) => row.warehouse_id !== null && !row.covered)
      .map((row) => row.item_id);
  }

  /** 创建采购单前的缺口校验（REPLENISH）。传入 manager 时在调用方事务内执行。 */
  async getWarehouseGap(
    skuId: string,
    warehouseId: string,
    manager?: { query: DataSource['query'] },
  ): Promise<WarehouseProcurementGap> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query<
      Array<{ demand_qty: string; in_transit_qty: string; gap_qty: string }>
    >(
      `
      WITH demand AS (
        SELECT COALESCE(SUM(i.quantity), 0) AS qty
          FROM order_items i
          JOIN orders o ON o.id = i.order_id
          JOIN LATERAL (
            SELECT b.warehouse_id
              FROM warehouse_platform_bindings b
             WHERE b.store_id = o.store_id AND b.status = 'ACTIVE'
             ORDER BY b.priority ASC, (b.fulfillment_mode LIKE '%FBO%') ASC
             LIMIT 1
          ) w ON TRUE
         WHERE i.sku_id = $1::uuid
           AND w.warehouse_id = $2::uuid
           AND i.mapping_status = 'MAPPED'
           AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')
           AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
      ),
      supply AS (
        SELECT COALESCE(SUM(GREATEST(poi.quantity - poi.received_quantity, 0)), 0) AS qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
         WHERE poi.sku_id = $1::uuid
           AND po.receiving_warehouse_id = $2::uuid
           AND po.status <> 'CANCELLED'
      )
      SELECT demand.qty::text AS demand_qty,
             supply.qty::text AS in_transit_qty,
             GREATEST(demand.qty - supply.qty, 0)::text AS gap_qty
        FROM demand, supply
      `,
      [skuId, warehouseId],
    );
    const row = rows[0];
    if (row === undefined) {
      return { demandQty: '0', inTransitQty: '0', gapQty: '0' };
    }
    return {
      demandQty: row.demand_qty,
      inTransitQty: row.in_transit_qty,
      gapQty: row.gap_qty,
    };
  }

  /**
   * 核心 CTE：需求行按优先级累计，累计量 ≤ 在途即为被覆盖。
   * `itemIds` 只过滤最终输出，不影响窗口计算（覆盖顺序必须看全量需求）。
   */
  private async queryCoverage(itemIds?: readonly string[]): Promise<CoverageRow[]> {
    const params: unknown[] = [];
    const filter = itemIds === undefined ? '' : `WHERE d.item_id = ANY($1::uuid[])`;
    if (itemIds !== undefined) {
      params.push([...itemIds]);
    }
    return this.dataSource.query<CoverageRow[]>(
      `
      WITH demand AS (
        SELECT i.id AS item_id,
               i.sku_id,
               w.warehouse_id,
               i.quantity,
               SUM(i.quantity) OVER (
                 PARTITION BY i.sku_id, w.warehouse_id
                 ORDER BY o.is_urgent DESC,
                          p.priority ASC,
                          o.shipment_deadline ASC NULLS LAST,
                          i.created_at ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS cum_qty
          FROM order_items i
          JOIN orders o ON o.id = i.order_id
          JOIN stores s ON s.id = o.store_id
          JOIN platforms p ON p.id = s.platform_id
          LEFT JOIN LATERAL (
            SELECT b.warehouse_id
              FROM warehouse_platform_bindings b
             WHERE b.store_id = o.store_id AND b.status = 'ACTIVE'
             ORDER BY b.priority ASC, (b.fulfillment_mode LIKE '%FBO%') ASC
             LIMIT 1
          ) w ON TRUE
         WHERE i.mapping_status = 'MAPPED'
           AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')
           AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
      ),
      supply AS (
        SELECT poi.sku_id,
               po.receiving_warehouse_id AS warehouse_id,
               SUM(GREATEST(poi.quantity - poi.received_quantity, 0)) AS outstanding
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
         WHERE po.status <> 'CANCELLED'
         GROUP BY 1, 2
      ),
      totals AS (
        SELECT sku_id, warehouse_id, SUM(quantity) AS demand
          FROM demand
         GROUP BY 1, 2
      )
      SELECT d.item_id,
             d.warehouse_id,
             d.quantity::text AS quantity,
             d.cum_qty::text AS cum_qty,
             COALESCE(s.outstanding, 0)::numeric(18,3)::text AS outstanding_qty,
             GREATEST(COALESCE(t.demand, 0) - COALESCE(s.outstanding, 0), 0)::numeric(18,3)::text
               AS gap_qty,
             (d.cum_qty <= COALESCE(s.outstanding, 0)) AS covered
        FROM demand d
        -- 未绑定仓的行 warehouse_id 为 NULL：必须用 IS NOT DISTINCT FROM，
        -- 否则 NULL = NULL 不成立会把这类行整行丢掉（2026-10-24），
        -- 前端就拿不到「店铺未绑定仓库」的信号。
        LEFT JOIN totals t ON t.sku_id = d.sku_id AND t.warehouse_id IS NOT DISTINCT FROM d.warehouse_id
        LEFT JOIN supply s ON s.sku_id = d.sku_id AND s.warehouse_id IS NOT DISTINCT FROM d.warehouse_id
        ${filter}
      `,
      params,
    );
  }
}
