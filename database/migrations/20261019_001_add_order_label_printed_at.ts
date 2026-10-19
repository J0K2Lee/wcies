import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 订单面单打印标记（用户指示 2026-10-19）。
 *
 * `orders.label_printed_at`：该订单的平台面单**已打印**的时间（人工确认，
 * 浏览器无法感知打印结果）。用于：
 * - 订单列表流水线胶囊「已打印」（显示在运单号前）；
 * - 二级筛选「已打单」= 已打印且未发货。
 *
 * 语义：一次打印确认即置位；重复打印刷新时间（保留最近一次）。与 ERP 状态
 * 无关（不是状态机的一部分）。
 */
export class AddOrderLabelPrintedAt1793500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'orders',
      new TableColumn({
        name: 'label_printed_at',
        type: 'timestamptz',
        isNullable: true,
      }),
    );
    // 「已打单」筛选按 已打印 ∧ 未发货 命中，部分索引只覆盖已打印行。
    await queryRunner.query(
      `CREATE INDEX idx_orders_label_printed ON orders (label_printed_at)
        WHERE label_printed_at IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_label_printed`);
    await queryRunner.dropColumn('orders', 'label_printed_at');
  }
}
