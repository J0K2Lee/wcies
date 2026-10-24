import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 放松 `purchase_orders.receiving_warehouse_id` 的 NOT NULL（2026-10-24）。
 *
 * 20261021_004 当初把它置为 NOT NULL 并在无法唯一确定历史目标仓时中止迁移。
 * 这在真实数据上站不住：历史采购单里确实存在既无收货记录、也无唯一绑定仓可推的
 * 行（测试库 908 张中 650 张），给它们塞默认仓等于编造业务事实（AGENTS §89）。
 *
 * 改为：**新单由 API/DTO 强制必填**（业务不变），历史单据允许 NULL，语义是
 * 「目标仓未登记」——不参与任何按仓的在途/缺口计算。
 *
 * 开发库上 004 已经跑过（当时成功），因此需要这条迁移把约束放松回来；
 * 新环境里 004 已不含 NOT NULL，这条是幂等空操作。
 */
export class PurchaseOrderTargetWarehouseNullable1792761000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE purchase_orders ALTER COLUMN receiving_warehouse_id DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 不回退：重新加 NOT NULL 会让历史上无法确定的行无法存在。
  }
}
