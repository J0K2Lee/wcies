import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Replenishment suggestion facts (Sprint 10 T4) - one raw query assembling,
 * per SKU: current stock aggregates, safety stock, shipped velocity over the
 * window, and open (not-yet-received) purchase quantities. The suggestion
 * arithmetic lives in the query service; this file only gathers facts.
 */
@Injectable()
export class ReplenishmentRepository {
  constructor(private readonly dataSource: DataSource) {}

  async gatherFacts(windowDays: number): Promise<
    Array<{
      skuId: string;
      skuCode: string;
      skuName: string;
      skuStatus: string;
      onHandQty: string;
      reservedQty: string;
      pickedQty: string;
      availableQty: string;
      safetyQty: string;
      shippedQty: string;
      openPoQty: string;
    }>
  > {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `WITH shipped AS (
         SELECT i.sku_id, SUM(i.quantity) AS shipped_qty
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
          WHERE i.fulfillment_status = 'SHIPPED'
            AND o.ordered_at >= now() - ($1::int || ' days')::interval
          GROUP BY i.sku_id
       ), stock AS (
         SELECT b.sku_id,
                SUM(b.on_hand_qty) AS on_hand,
                SUM(b.reserved_qty) AS reserved,
                SUM(b.picked_qty) AS picked
           FROM inventory_balances b
          GROUP BY b.sku_id
       ), safety AS (
         SELECT sku_id, SUM(safety_qty) AS safety_qty
           FROM inventory_safety_stocks
          GROUP BY sku_id
       ), open_po AS (
         -- 2026-11-03：在途 = 订购 − 已收 − 短装结案（结案的数量不会再到货）
         SELECT pi.sku_id, SUM(pi.quantity - pi.received_quantity - pi.closed_quantity) AS open_qty
           FROM purchase_order_items pi
           JOIN purchase_orders po ON po.id = pi.po_id
          WHERE po.status IN ('ORDERED', 'PARTIALLY_RECEIVED')
          GROUP BY pi.sku_id
       )
       SELECT s.id AS sku_id, s.sku_code, s.name_zh AS sku_name, s.status AS sku_status,
              COALESCE(stock.on_hand, 0) AS on_hand,
              COALESCE(stock.reserved, 0) AS reserved,
              COALESCE(stock.picked, 0) AS picked,
              COALESCE(stock.on_hand, 0) - COALESCE(stock.reserved, 0) - COALESCE(stock.picked, 0) AS available,
              COALESCE(safety.safety_qty, 0) AS safety_qty,
              COALESCE(shipped.shipped_qty, 0) AS shipped_qty,
              COALESCE(open_po.open_qty, 0) AS open_po_qty
         FROM skus s
         LEFT JOIN stock ON stock.sku_id = s.id
         LEFT JOIN safety ON safety.sku_id = s.id
         LEFT JOIN shipped ON shipped.sku_id = s.id
         LEFT JOIN open_po ON open_po.sku_id = s.id
        WHERE s.status <> 'INACTIVE'`,
      [windowDays],
    );
    return rows.map((row) => ({
      skuId: String(row['sku_id']),
      skuCode: asText(row['sku_code']),
      skuName: asText(row['sku_name']),
      skuStatus: asText(row['sku_status']),
      onHandQty: String(row['on_hand']),
      reservedQty: String(row['reserved']),
      pickedQty: String(row['picked']),
      availableQty: String(row['available']),
      safetyQty: String(row['safety_qty']),
      shippedQty: String(row['shipped_qty']),
      openPoQty: String(row['open_po_qty']),
    }));
  }
}

/** pg may hand back non-string primitives; only strings are meaningful. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
