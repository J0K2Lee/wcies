import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 面单清理（用户指示 2026-10-21）：订单完成/取消后清理面单图像。
 *
 * `shipping_labels.purged_at`：对象存储里的面单字节已被删除的时间。行本身
 * 永久保留——谁、何时、为哪单存过面单、对象键是什么，仍是审计事实；被清理
 * 的行不再出现在任何读取路径里，也不能再被打印。
 *
 * 清理由后台扫描驱动（完成/取消不是单一状态字段：COMPLETED 是
 * `erp_status='SHIPPED' AND platform_stage='DELIVERED'` 的派生口径），
 * 扫描按 `created_at` keyset 游标分批推进，因此索引按 created_at 建偏索引，
 * 已清理的行自动离开索引。
 */
export class ShippingLabelPurge1792540800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'shipping_labels',
      new TableColumn({
        name: 'purged_at',
        type: 'timestamptz',
        isNullable: true,
      }),
    );
    await queryRunner.query(
      `CREATE INDEX idx_shipping_labels_unpurged_created
        ON shipping_labels (created_at)
        WHERE purged_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_shipping_labels_unpurged_created`);
    await queryRunner.dropColumn('shipping_labels', 'purged_at');
  }
}
