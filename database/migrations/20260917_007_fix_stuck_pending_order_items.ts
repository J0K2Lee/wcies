import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 缺货口径修复（人工测试 2026-09-17）：历史摄入在「无法分配仓库」时把
 * 订单行留在 PENDING（映射已完成、从未持有库存），而订单 rollup 将其视
 * 为缺货——导致缺货筛选与采购/重分配管线都看不到这些行。
 *
 * 修复：把「MAPPED + PENDING + 无预约 + 订单未取消/未发货」的行归位为
 * BACKORDERED（AGENTS.md §40 口径：已映射但库存未就绪 = 缺货）。
 * 条件保守：不动任何已占用/已拣货/外部履约行。
 */
export class FixStuckPendingOrderItems1790000800007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const result: unknown[] = await queryRunner.query(
      `UPDATE order_items i
          SET fulfillment_status = 'BACKORDERED',
              updated_at = now()
         FROM orders o
        WHERE o.id = i.order_id
          AND i.mapping_status = 'MAPPED'
          AND i.fulfillment_status = 'PENDING'
          AND i.reservation_id IS NULL
          AND i.sku_id IS NOT NULL
          AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
        RETURNING i.id`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[migration] fix_stuck_pending_order_items: 归位 ${result.length} 行 MAPPED+PENDING → BACKORDERED`,
    );
  }

  public async down(): Promise<void> {
    // 数据修复不回滚：行的历史状态本就是异常中间态（保持事实）。
  }
}
