import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 数据修复（2026-10-27 用户指示）：加急标记只在「还没发出去」时有意义，
 * 发货后应由状态机自动移除（OrderStatusService.transition 已改）。
 *
 * 本迁移清掉历史上已经发出去、却还挂着加急的单——它们在订单列表里恒置顶、
 * 显示红色加急旗标，误导运营以为还需要优先处理（ORD00000775/779 等实证）。
 *
 * 只动 `is_urgent`；`urgent_marked_at` 保留（最后一次加急时间的审计线索）。
 * 不回滚：无法区分「本来就没有」与「被本迁移清掉」的行，恢复旧旗标只会
 * 把错误状态带回来。
 */
export class ClearUrgentOnShippedOrders1793091000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE orders
         SET is_urgent = false
       WHERE is_urgent = true
         AND erp_status = 'SHIPPED'
    `);
  }

  public async down(): Promise<void> {
    // 一次性数据修复，无回滚（见类注释）。
  }
}
