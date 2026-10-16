import { MigrationInterface, QueryRunner } from 'typeorm';

/** pg `UPDATE ... RETURNING` 经 TypeORM query() 返回 [rows, rowCount]。 */
function returningRows(result: unknown): unknown[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as unknown[];
  }
  return (result as unknown[]) ?? [];
}

/**
 * 陈旧 EXCEPTION 归位：无可履约行且无未映射行（2026-10-16 用户 bug 报告）。
 *
 * 背景：`order-status.service.deriveRollupStatus` 的「无可履约行」分支此前
 * 无条件返回 `current`。`EXCEPTION` 的成立前提是「存在 mapping FAILED 行」
 * （orders.md §7 规则 2）；前提消失后（映射修复把行转 MAPPED + 外部履约完成）
 * 陈旧 EXCEPTION 被保留——订单永久卡异常。真实样本 ORD00000207（FBP，
 * SKU000012013 摄入时未建档 → 行 FAILED + 订单 EXCEPTION；运营补齐映射后行转
 * EXTERNAL_FULFILLED、映射异常关闭，但订单仍 EXCEPTION）。
 *
 * 代码侧已修（`order-status.service`）：无可履约行时——仍有 FAILED 行 → EXCEPTION；
 * 否则陈旧 EXCEPTION 回落到持有态 NEW，其余当前态保持不变。但该单的映射修复
 * 早于修复落地且异常已 RESOLVED，不会再触发重算；外部履约单在
 * `AWAITING_SHIPMENT` 也不进回读重算路径。故用本迁移一次性归位。
 *
 * 归位口径（与修复后的 rollup 一致，非新规则）：`erp_status='EXCEPTION'`
 * 且**无** mapping FAILED 行、**无**任何非 EXTERNAL_FULFILLED/RELEASED 行
 * （即可履约行为空）的订单 → `NEW`（外部履约单等待平台事件的持有态）。
 * 保守：只匹配该精确形状，匹配不到即 no-op（生产安全）。
 */
export class FixStaleExceptionExternalOrders1793400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const fixed: unknown[] = await queryRunner.query(
      `UPDATE orders o
          SET erp_status = 'NEW', updated_at = now()
        WHERE o.erp_status = 'EXCEPTION'
          AND NOT EXISTS (
            SELECT 1 FROM order_items i
             WHERE i.order_id = o.id AND i.mapping_status = 'FAILED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_items i
             WHERE i.order_id = o.id
               AND i.fulfillment_status NOT IN ('EXTERNAL_FULFILLED', 'RELEASED')
          )
        RETURNING o.id`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[migration] fix_stale_exception_external_orders: 归位订单 ${returningRows(fixed).length} 单`,
    );
  }

  public async down(): Promise<void> {
    // 数据修复不回滚：陈旧 EXCEPTION 本就是状态机残留（保持修复后的事实）。
  }
}
