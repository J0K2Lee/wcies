import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * pg 驱动 quirk：`UPDATE/DELETE ... RETURNING` 经 TypeORM `query()` 返回
 * `[rows, rowCount]` 二元组（INSERT 不同）。计数必须归一化（见
 * docs/integrations/ozon.md §10 坑 2）。
 */
function returningRows(result: unknown): unknown[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as unknown[];
  }
  return (result as unknown[]) ?? [];
}

/**
 * 悬空订单占用修复（2026-10-15 用户 bug 报告）。
 *
 * 背景：库存占用页的生命周期端点（`POST /inventory/reservations/:id/{release,
 * pick,unpick,ship}`）只改库存（余额/流水/预约头），从不回流订单模块。对
 * `reference_type='ORDER'` 的预约执行 release 后，订单行的
 * `fulfillment_status` 仍停在 `RESERVED` 且 `reservation_id` 指向已 RELEASED
 * 的预约——订单页显示「已占用」，实体占用早已解除（真实样本 ORD00000142 /
 * RSV00000010）。该行既不会被订单 rollup 纠正（rollup 只看行状态），也不会
 * 被在途的自动重分配接管（候选要求行状态为 BACKORDERED/PENDING），永久悬空。
 *
 * 代码侧已修（提交同批）：订单来源预约的裸生命周期被拒（
 * `OrderOwnedReservationError`），订单取消链路显式传 `orderDomain=true` 且
 * 幂等地容忍已终态预约。本迁移修复**既有**悬空数据（代码修复无法回溯纠正
 * 历史行）。
 *
 * 修复口径（复用 orders.md §5/§7 冻结口径，非新规则）：
 *   1. 悬空行 = `mapping_status='MAPPED'` 且 `fulfillment_status='RESERVED'`
 *      且其 `reservation_id` 为空或指向非 ACTIVE 的预约（行声称占用、实际
 *      无占用）。按 §5「MAPPED 且未持有库存 = 缺货」归位为 BACKORDERED。
 *   2. 清理这些订单挂着的**零进度**拣货行（picked_qty=0，且其预约非 ACTIVE
 *      ——扫码必然失败）；删空的任务置 CANCELLED（同
 *      `cancelZeroProgressTasksForOrder` 语义）。已产生拣货进度的行不动。
 *   3. 受影响订单按 §7 rollup 优先级重算 `erp_status`（不写历史表：数据修复
 *      不改写历史事实）。
 *
 * 保守性：只动上述精确形状；不产生/删除库存，不触碰 SHIPPED/PICKED/RELEASED
 * 行与订单级异常；匹配不到即 no-op（生产安全）。
 */
export class FixDanglingOrderReservations1793300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 受影响订单（先取快照，后续 UPDATE 会改行状态）。
    const affected: Array<{ order_id: string }> = await queryRunner.query(
      `SELECT DISTINCT i.order_id
         FROM order_items i
         LEFT JOIN inventory_reservations r ON r.id = i.reservation_id
        WHERE i.fulfillment_status = 'RESERVED'
          AND i.mapping_status = 'MAPPED'
          AND (i.reservation_id IS NULL OR r.status <> 'ACTIVE')`,
    );
    const orderIds = affected.map((row) => row.order_id);
    if (orderIds.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[migration] fix_dangling_order_reservations: 无悬空占用，跳过');
      return;
    }

    // 2. 清理悬空订单挂着的零进度拣货行（其预约已非 ACTIVE，扫码必失败）。
    const removedItems: unknown[] = await queryRunner.query(
      `DELETE FROM picking_task_items ti
         USING inventory_reservations r
        WHERE ti.reservation_id = r.id
          AND r.status <> 'ACTIVE'
          AND ti.picked_qty = 0
          AND ti.order_id = ANY($1::uuid[])
        RETURNING ti.id`,
      [orderIds],
    );

    // 3. 删空的任务置 CANCELLED（仍有行的任务保留）。
    await queryRunner.query(
      `UPDATE picking_tasks t
          SET status = 'CANCELLED', updated_at = now()
        WHERE t.status IN ('CREATED', 'IN_PROGRESS')
          AND NOT EXISTS (SELECT 1 FROM picking_task_items ti WHERE ti.picking_task_id = t.id)`,
    );

    // 4. 行归位：RESERVED 且无有效占用 → BACKORDERED（MAPPED 未持有库存 = 缺货）。
    //    悬空判定用子查询而非 JOIN 目标表（PG 不允许在 UPDATE 的 FROM 里 JOIN
    //    被更新的目标表）。
    const fixed: unknown[] = await queryRunner.query(
      `UPDATE order_items i
          SET fulfillment_status = 'BACKORDERED', updated_at = now()
         FROM orders o
        WHERE o.id = i.order_id
          AND i.fulfillment_status = 'RESERVED'
          AND i.mapping_status = 'MAPPED'
          AND i.order_id = ANY($1::uuid[])
          AND (
            i.reservation_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM inventory_reservations r
               WHERE r.id = i.reservation_id AND r.status = 'ACTIVE'
            )
          )
          AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
        RETURNING i.id`,
      [orderIds],
    );

    // 5. 受影响订单按 §7 rollup 重算 erp_status（口径与 order-status.service
    //    一致：可履约行排除 FAILED/RELEASED/EXTERNAL_FULFILLED；优先级
    //    PICKING > SHIPPED > PARTIALLY_SHIPPED > PICKED > 缺货 > READY_TO_PICK）。
    await queryRunner.query(
      `WITH facts AS (
         SELECT o.id AS order_id,
                COUNT(*) FILTER (
                  WHERE i.mapping_status <> 'FAILED'
                    AND i.fulfillment_status NOT IN ('RELEASED', 'EXTERNAL_FULFILLED')
                ) AS fulfillable,
                COUNT(*) FILTER (
                  WHERE i.mapping_status <> 'FAILED'
                    AND i.fulfillment_status NOT IN ('RELEASED', 'EXTERNAL_FULFILLED')
                    AND i.fulfillment_status = 'SHIPPED'
                ) AS shipped,
                COUNT(*) FILTER (
                  WHERE i.mapping_status <> 'FAILED'
                    AND i.fulfillment_status NOT IN ('RELEASED', 'EXTERNAL_FULFILLED')
                    AND i.fulfillment_status = 'PICKED'
                ) AS picked,
                COUNT(*) FILTER (
                  WHERE i.mapping_status <> 'FAILED'
                    AND i.fulfillment_status NOT IN ('RELEASED', 'EXTERNAL_FULFILLED')
                    AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')
                ) AS waiting
           FROM orders o
           JOIN order_items i ON i.order_id = o.id
          WHERE o.id = ANY($1::uuid[])
          GROUP BY o.id
       ),
       active_picking AS (
         SELECT ti.order_id, TRUE AS has_active
           FROM picking_task_items ti
           JOIN picking_tasks t ON t.id = ti.picking_task_id
          WHERE t.status IN ('CREATED', 'IN_PROGRESS')
            AND ti.status = 'PENDING'
            AND ti.order_id = ANY($1::uuid[])
       ),
       target AS (
         SELECT f.order_id,
                CASE
                  WHEN f.fulfillable = 0 THEN o.erp_status
                  WHEN p.has_active THEN 'PICKING'
                  WHEN f.shipped = f.fulfillable THEN 'SHIPPED'
                  WHEN f.shipped > 0 THEN 'PARTIALLY_SHIPPED'
                  WHEN f.picked = f.fulfillable THEN 'PICKED'
                  WHEN f.waiting > 0 AND f.waiting = f.fulfillable THEN 'BACKORDERED'
                  WHEN f.waiting > 0 THEN 'PARTIALLY_BACKORDERED'
                  ELSE 'READY_TO_PICK'
                END AS next_status
           FROM facts f
           JOIN orders o ON o.id = f.order_id
           LEFT JOIN active_picking p ON p.order_id = f.order_id
       )
       UPDATE orders o
          SET erp_status = t.next_status, updated_at = now()
         FROM target t
        WHERE o.id = t.order_id
          AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
          AND o.erp_status <> t.next_status`,
      [orderIds],
    );

    // eslint-disable-next-line no-console
    console.log(
      `[migration] fix_dangling_order_reservations: 订单 ${orderIds.length} 单 / ` +
        `归位行 ${returningRows(fixed).length} / 清理零进度拣货行 ${returningRows(removedItems).length}`,
    );
  }

  public async down(): Promise<void> {
    // 数据修复不回滚：悬空行本就是异常中间态（保持修复后的事实）。
  }
}
