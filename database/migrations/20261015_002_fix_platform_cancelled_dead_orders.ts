import { MigrationInterface, QueryRunner } from 'typeorm';

/** pg `UPDATE/DELETE ... RETURNING` 经 TypeORM query() 返回 [rows, rowCount]。 */
function returningRows(result: unknown): unknown[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as unknown[];
  }
  return (result as unknown[]) ?? [];
}

/**
 * 平台已取消发货单归位（2026-10-15 用户 bug 报告，与 20261015_001 同批）。
 *
 * 背景：OZON 的 `cancelled_from_split_pending`（拆单取消）此前未被映射为取消
 * （`platformCancelled` 只认精确 `cancelled`，阶段表也未归类），于是
 * `POSTING_CANCELLED` webhook 定向回读后把**已取消**的发货单当活跃单摄入，
 * 走正常分配 → 无库存 → BACKORDERED，永久常驻缺货/待采购（真实样本
 * ORD00000041 / 73885080-0016-1：raw_data.status=cancelled_from_split_pending、
 * substatus=posting_canceled、无运单号）。
 *
 * 代码侧已修：`ozon.mapper` 把 `cancelled` 与 `cancelled_from_split_pending`
 * 归一为取消（共享谓词 `isOzonPostingCancelled`，与发货链路
 * `ozon-shipment.service` 同口径）。修好后该单会经回读轮转走真实取消链路收敛；
 * 但轮转受 24h 窗口约束、非立即。本迁移对**既有**这类死单做一次性确定性归位
 * （生产安全：字段驱动、精确匹配、匹配不到即 no-op）。
 *
 * 归位口径（与 `OrderService.cancel` 对「无库存锁定行」的语义一致）：
 *   1. 目标订单 = 平台原文 status ∈ {cancelled, cancelled_from_split_pending}
 *      （或 substatus = 'posting_canceled'）且 `erp_status` 非终态
 *      （CANCELLED/SHIPPED）。
 *   2. 其**未持有内部库存**的行（PENDING / BACKORDERED / 映射失败，无有效
 *      RESERVED/PICKED 占用）→ RELEASED（不触碰库存）。
 *   3. 订单 `erp_status` → CANCELLED；关闭其行的 OPEN `ORDER_OUT_OF_STOCK`
 *      （永不发货的订单不再占用缺货注意力，orders.md §8）。
 *
 * 保守性：持库存（RESERVED/PICKED）或已 SHIPPED 的行不动——那种取消要走
 * 拦截流程，不是数据修复能代劳的；若存在这类行则整单跳过（保持人工处理）。
 */
export class FixPlatformCancelledDeadOrders1793300001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 平台已取消、ERP 非终态的死单。
    const dead: Array<{ id: string }> = await queryRunner.query(
      `SELECT o.id
         FROM orders o
        WHERE o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
          AND (
            o.platform_status IN ('cancelled', 'cancelled_from_split_pending')
            OR o.raw_data->>'substatus' = 'posting_canceled'
          )`,
    );
    const orderIds = dead.map((row) => row.id);
    if (orderIds.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[migration] fix_platform_cancelled_dead_orders: 无死单，跳过');
      return;
    }

    // 2. 只处理「不含任何持库存/已出库行」的订单：持库存行的取消必须走拦截
    //    流程，交由人工，不在此静默归位。
    const safe: Array<{ id: string }> = await queryRunner.query(
      `SELECT o.id
         FROM orders o
        WHERE o.id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM order_items i
             WHERE i.order_id = o.id
               AND i.fulfillment_status IN ('RESERVED', 'PICKED', 'SHIPPED')
          )`,
      [orderIds],
    );
    const safeIds = safe.map((row) => row.id);
    if (safeIds.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[migration] fix_platform_cancelled_dead_orders: ${orderIds.length} 单均含持库存/已出库行，保持人工处理`,
      );
      return;
    }

    // 3. 未持有内部库存的行 → RELEASED（不产生库存动作）。
    const released: unknown[] = await queryRunner.query(
      `UPDATE order_items i
          SET fulfillment_status = 'RELEASED', updated_at = now()
         FROM orders o
        WHERE o.id = i.order_id
          AND o.id = ANY($1::uuid[])
          AND i.fulfillment_status NOT IN ('RESERVED', 'PICKED', 'SHIPPED', 'RELEASED')
        RETURNING i.id`,
      [safeIds],
    );

    // 4. 关闭死单行的 OPEN 缺货异常（永不发货的订单不得继续催货）。
    await queryRunner.query(
      `UPDATE system_exceptions e
          SET status = 'RESOLVED', resolved_at = now(), updated_at = now()
        WHERE e.status = 'OPEN'
          AND e.exception_type = 'ORDER_OUT_OF_STOCK'
          AND e.reference_type = 'ORDER_ITEM'
          AND e.reference_id IN (
            SELECT i.id FROM order_items i WHERE i.order_id = ANY($1::uuid[])
          )`,
      [safeIds],
    );

    // 5. 订单 → CANCELLED。
    const cancelled: unknown[] = await queryRunner.query(
      `UPDATE orders o
          SET erp_status = 'CANCELLED', updated_at = now()
        WHERE o.id = ANY($1::uuid[])
          AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
        RETURNING o.id`,
      [safeIds],
    );

    // eslint-disable-next-line no-console
    console.log(
      `[migration] fix_platform_cancelled_dead_orders: 取消订单 ${returningRows(cancelled).length} 单 / ` +
        `归位行 ${returningRows(released).length}` +
        (orderIds.length > safeIds.length ? ` / 跳过 ${orderIds.length - safeIds.length} 单（含持库存行）` : ''),
    );
  }

  public async down(): Promise<void> {
    // 数据修复不回滚：这些平台取消事实已确定（保持修复后的状态）。
  }
}
